/**
 * 月底选餐：按人数枚举候选，逐个真实计价，给出最省的几套。
 *
 * 四类候选：
 *   单品  菜单里单个商品直接买
 *   套餐  菜单里的套餐类商品（名字含套餐/件套/随心配/拼盘）
 *   组合  自己搭：主食 + 小吃 + 饮品
 *   凑单  用券商品的专属 code 配主食/小吃凑成一餐
 *
 * 三条铁律（都是实测踩出来的）：
 *   1. 菜单价不等于成交价。四件套菜单标 ¥29，裸计价返回 ¥57。
 *      所以每个候选都必须走 calculate-price，不能拿菜单价加减。
 *   2. 券靠 couponId 激活。只传券商品的 productCode 会被静默忽略
 *      （计价 ¥0），必须同时带 couponId 和 couponCode。
 *      一单只能用一张券（错误码 600022），所以每个候选最多挂一张。
 *   3. 便宜不等于一餐。¥3 的蘸酱和 ¥5 的圆筒比任何套餐都便宜，
 *      但它们不构成一顿饭。所以候选要标 hasStaple，含主食的排前面，
 *      不含主食的降级成加购推荐。这一条是第一次跑测试时踩出来的。
 */
import { callData } from '../mcp.js'
import { getMenu } from '../catalog.js'
import { groupItems, groupOf } from '../grouping.js'
import { pointsSummary, pointsAdvice } from '../points.js'

const COMBO_PATTERN = /套餐|件套|随心配|1\+1|拼盘|组合/

/** 取门店可用券。卡包里的券未必这家店能用，必须查这个接口。 */
export async function storeCoupons(storeCode, { orderType = 1, beType = 1 } = {}) {
  try {
    const r = await callData('query-store-coupons', { storeCode, orderType, beType })
    const list = Array.isArray(r) ? r : r?.coupons || r?.list || []
    return list.filter((c) => c?.products?.[0]?.productCode)
  } catch {
    return []
  }
}

/** 真实计价。返回的价格单位是分。 */
export async function priceOf(storeCode, items, { orderType = 1, beType = 1 } = {}) {
  return callData('calculate-price', { storeCode, orderType, beType, items })
}

const yuan = (cents) => (cents == null ? null : Math.round(cents) / 100)

/**
 * 生成候选清单。不动网络，纯拼装。
 * @returns {Array<{kind:string, title:string, items:object[], note?:string, hasStaple:boolean}>}
 */
export function buildCandidates(menu, coupons, { people = 1, perKindLimit = 8 } = {}) {
  const groups = groupItems(menu)
  const candidates = []
  const byPrice = (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9)

  // --- 单品：主食类标 hasStaple，其他作为加购候选 ---
  const singles = menu.filter((m) => m.price != null).sort(byPrice)
  for (const m of singles.slice(0, perKindLimit * 2)) {
    candidates.push({
      kind: '单品',
      title: m.name,
      items: [{ productCode: m.code, quantity: people }],
      note: `单价 ¥${m.price}`,
      hasStaple: groupOf(m.category, m.name) === '主食',
    })
  }

  // --- 套餐：成套商品，默认含主食 ---
  const combos = menu.filter((m) => COMBO_PATTERN.test(m.name)).sort(byPrice)
  for (const m of combos.slice(0, perKindLimit)) {
    candidates.push({
      kind: '套餐',
      title: m.name,
      items: [{ productCode: m.code, quantity: people }],
      note: `菜单标价 ¥${m.price}`,
      hasStaple: true,
    })
  }

  // --- 组合：主食 + 小吃 + 饮品 ---
  const staple = [...(groups.主食 || [])].sort(byPrice)
  const snack = [...(groups.小吃 || [])].sort(byPrice)
  const drink = [...(groups.饮品 || [])].sort(byPrice)
  const seen = new Set()
  for (let i = 0; i < Math.min(3, staple.length); i++) {
    for (let j = 0; j < Math.min(2, snack.length); j++) {
      for (let k = 0; k < Math.min(2, drink.length); k++) {
        const three = [staple[i], snack[j], drink[k]]
        const key = three.map((x) => x.code).join('+')
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          kind: '组合',
          title: `${staple[i].name} + ${snack[j].name} + ${drink[k].name}`,
          items: three.map((x) => ({ productCode: x.code, quantity: people })),
          note: '自选搭配',
          hasStaple: true,
        })
      }
    }
  }

  // --- 凑单：券商品单独用，或配主食凑成一餐 ---
  const cheapestStaple = staple[0]
  const cheapestSnack = snack[0]
  for (const c of coupons.slice(0, 4)) {
    const couponItem = {
      productCode: c.products[0].productCode,
      quantity: 1,
      couponId: c.couponId,
      couponCode: c.couponCode,
    }
    candidates.push({
      kind: '凑单',
      title: `仅用券：${c.title}`,
      items: [{ ...couponItem }],
      note: '只买券商品',
      hasStaple: false,
    })
    if (cheapestStaple) {
      candidates.push({
        kind: '凑单',
        title: `券 + ${cheapestStaple.name}：${c.title}`,
        items: [{ ...couponItem }, { productCode: cheapestStaple.code, quantity: people }],
        note: `配 ${cheapestStaple.name}`,
        hasStaple: true,
      })
    }
    if (cheapestStaple && cheapestSnack) {
      candidates.push({
        kind: '凑单',
        title: `券 + ${cheapestStaple.name} + ${cheapestSnack.name}：${c.title}`,
        items: [
          { ...couponItem },
          { productCode: cheapestStaple.code, quantity: people },
          { productCode: cheapestSnack.code, quantity: people },
        ],
        note: '凑成一餐',
        hasStaple: true,
      })
    }
  }

  return candidates
}

/** 同一价格只留一套，避免结果里一堆等价项。 */
function dedupByPrice(list, limit) {
  const out = []
  const seen = new Set()
  for (const q of list) {
    const key = q.price.toFixed(2)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= limit) break
  }
  return out
}

/**
 * 主流程：枚举候选 -> 逐个计价 -> 分成正餐和加购两组返回。
 * @param {object} opts
 * @param {string} opts.storeCode 门店
 * @param {number} opts.people 几个人吃
 * @param {number} opts.top 每组返回几套
 */
export async function pickMonth({ storeCode, people = 1, top = 6, orderType = 1, beType = 1 }) {
  const [menu, coupons] = await Promise.all([
    getMenu(storeCode, { orderType, beType }),
    storeCoupons(storeCode, { orderType, beType }),
  ])

  const candidates = buildCandidates(menu, coupons, { people })
  const quoted = []

  for (const cand of candidates) {
    try {
      const r = await priceOf(storeCode, cand.items, { orderType, beType })
      quoted.push({
        kind: cand.kind,
        title: cand.title,
        note: cand.note,
        hasStaple: cand.hasStaple,
        items: r.productList || [],
        price: yuan(r.price),
        originalPrice: yuan(r.originalPrice),
        discount: yuan(r.discount),
        saved: r.originalPrice != null && r.price != null ? yuan(r.originalPrice - r.price) : 0,
        hasCoupon: cand.items.some((i) => i.couponId),
      })
    } catch (e) {
      quoted.push({
        kind: cand.kind,
        title: cand.title,
        note: cand.note,
        hasStaple: cand.hasStaple,
        failed: true,
        reason: e.businessCode ? `code=${e.businessCode} ${e.message.slice(0, 60)}` : e.message.slice(0, 80),
      })
    }
  }

  const ok = quoted.filter((q) => !q.failed && q.price != null)
  const failed = quoted.filter((q) => q.failed)
  const meals = dedupByPrice(
    ok.filter((q) => q.hasStaple).sort((a, b) => a.price - b.price),
    top,
  )
  const extras = dedupByPrice(
    ok.filter((q) => !q.hasStaple).sort((a, b) => a.price - b.price),
    Math.min(top, 4),
  )

  // 积分兑换走的是麦麦商城订单，和门店点餐是两条链路，不能混进同一单合计。
  // 但它确实是省钱手段，所以单独算一份建议一起给出去。
  let points = null
  try {
    const summary = await pointsSummary()
    points = { ...summary, advice: pointsAdvice(summary, meals[0]?.price ?? null) }
  } catch (e) {
    points = { error: e.message.slice(0, 100) }
  }

  return {
    storeCode,
    people,
    points,
    counts: {
      menu: menu.length,
      coupons: coupons.length,
      candidates: candidates.length,
      quoted: ok.length,
      failed: failed.length,
    },
    meals,
    extras,
    cheapest: meals[0] || null,
    biggestSave: [...ok].sort((a, b) => b.saved - a.saved)[0] || null,
    failedSamples: failed.slice(0, 3),
  }
}
