/**
 * 麦享会积分与积分商城。
 *
 * 两个字段上的坑，都是实测踩出来的：
 *   1. 商城的 price 字段恒为 "0"，商品面值藏在 spuName 里
 *      （「10.9元指定小食任选」= 面值 ¥10.9）。要靠正则从名字里抠。
 *   2. 接口会返回大量已过期的 SPU（downTime 在上个月甚至去年）。
 *      必须按 downTime 过滤，否则会把换不了的东西推给用户。
 *
 * 积分兑换走的是麦麦商城订单（mall-create-order），和门店点餐的
 * calculate-price 是两条独立链路，所以兑换方案的价格固定是 ¥0 + 积分消耗，
 * 不参与门店订单的合计。
 */
import { callData, cached } from './mcp.js'

const POINTS_TTL_MS = 3 * 60 * 1000

/** 积分账户。 */
export async function getAccount({ fresh = false } = {}) {
  if (fresh) return callData('query-my-account', {})
  return cached('points:account', POINTS_TTL_MS, () => callData('query-my-account', {}))
}

/** 把 "2026-12-30 23:59:59" 解析成 Date。直接喂给 new Date 在部分环境会失败。 */
function parseTime(s) {
  if (!s) return null
  const d = new Date(String(s).replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 从商品名里抠出面值和份数。
 * 「18.8元2份麦辣鸡翅」-> { faceValue: 18.8, qty: 2 }
 * 名字里的金额是这一单的总面值，不是单价。
 */
export function parseFaceValue(name) {
  const text = String(name || '')
  const amount = text.match(/(\d+(?:\.\d+)?)\s*元/)
  const qty = text.match(/(\d+)\s*份/)
  return {
    faceValue: amount ? Number(amount[1]) : null,
    qty: qty ? Number(qty[1]) : 1,
  }
}

/** 归一化一个 SPU，并判断当前是否还能兑换。 */
export function normalizeSpu(spu, now = new Date()) {
  const { faceValue, qty } = parseFaceValue(spu.spuName)
  const start = parseTime(spu.upTime)
  const end = parseTime(spu.downTime)
  const onShelf = spu.status === 2
  return {
    spuId: spu.spuId,
    name: spu.spuName,
    point: Number(spu.point) || 0,
    faceValue,
    qty,
    selling: spu.selling,
    image: spu.spuImage,
    category: spu.catName,
    shopId: spu.shopId,
    startAt: spu.upTime || null,
    endAt: spu.downTime || null,
    onShelf,
    expired: end ? end < now : false,
    notStarted: start ? start > now : false,
  }
}

/**
 * 可兑换的餐饮券。
 * @param {string} catRuleIds 类目规则，默认 1>4（商品券，非预付优惠券）
 */
export async function getRedeemables({ catRuleIds = '1>4', fresh = false } = {}) {
  const key = `points:mall:${catRuleIds}`
  const raw = fresh
    ? await callData('mall-points-products', { catRuleIds })
    : await cached(key, POINTS_TTL_MS, () => callData('mall-points-products', { catRuleIds }))

  const list = (Array.isArray(raw) ? raw : []).map((s) => normalizeSpu(s))
  return {
    all: list,
    // 现在真的能换的：在架上、没过期、已开始、有积分价
    usable: list.filter((s) => s.onShelf && !s.expired && !s.notStarted && s.point > 0),
    expiredCount: list.filter((s) => s.expired).length,
  }
}

/**
 * 积分总览：余额 + 能换什么 + 差多少分。
 * 「差多少分」是这里最有用的输出，用户会因为想换东西而去攒积分。
 */
export async function pointsSummary({ fresh = false } = {}) {
  const [account, mall] = await Promise.all([
    getAccount({ fresh }),
    getRedeemables({ fresh }),
  ])

  const balance = Number(account?.availablePoint ?? 0)
  const usable = mall.usable.slice().sort((a, b) => a.point - b.point)

  const affordable = usable.filter((s) => s.point <= balance)
  const short = usable
    .filter((s) => s.point > balance)
    .map((s) => ({ ...s, need: s.point - balance, progress: balance / s.point }))

  return {
    balance,
    currency: account?.currency || '麦享会积分',
    expiring: Number(account?.currentMouthExpirePoint ?? 0),
    expired: Number(account?.expiredPoint ?? 0),
    used: Number(account?.usedPoint ?? 0),
    accumulated: Number(account?.accumulativePoint ?? 0),
    counts: {
      onShelf: mall.usable.length,
      expired: mall.expiredCount,
    },
    affordable,
    short: short.slice(0, 6),
  }
}

/**
 * 把积分兑换折算成「相当于省了多少钱」，供月底选餐排序参考。
 * 面值就是这张券能顶的金额，兑换本身不花钱。
 */
export function redemptionValue(spu) {
  return spu.faceValue != null ? spu.faceValue : 0
}

/**
 * 在现金方案之外，给出积分兑换建议。
 * @param {object} summary pointsSummary() 的结果
 * @param {number} cashBest 现金最省方案的价格
 */
export function pointsAdvice(summary, cashBest = null) {
  const tips = []
  if (!summary.counts.onShelf) {
    tips.push('当前没有在有效期内的可兑换餐品。')
    return tips
  }
  if (!summary.balance) {
    // short 已按所需积分升序排过，第一个就是最容易换到的那个
    const easiest = summary.short[0]
    tips.push(
      easiest
        ? `积分余额为 0。最容易换的是「${easiest.name}」，只要 ${easiest.point} 分，点餐可以攒积分。`
        : '积分余额为 0。点餐可以攒积分。',
    )
    return tips
  }
  for (const s of summary.affordable.slice(0, 3)) {
    const value = redemptionValue(s)
    const compare =
      cashBest != null && value > 0
        ? `，相当于省 ¥${value.toFixed(2)}${value >= cashBest ? '，比现金方案还划算' : ''}`
        : ''
    tips.push(`已有 ${summary.balance} 分，可用 ${s.point} 分兑换「${s.name}」${compare}。`)
  }
  if (summary.short.length) {
    const near = summary.short[0]
    tips.push(`再攒 ${near.need} 分就能换「${near.name}」（还差 ${Math.round((1 - near.progress) * 100)}%）。`)
  }
  return tips
}
