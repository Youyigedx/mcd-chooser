/**
 * 随机引擎。盲盒、上上签、愿赌服输三个模式共用。
 *
 * 用 node:crypto 的 randomInt 而不是 Math.random。
 * 「真随机」是这几个模式的卖点，主播整活时观众会盯着有没有被算法操控，
 * 用可预测的伪随机说不过去。
 */
import { randomInt } from 'node:crypto'

/** 默认随机源：返回 [0, max) 的整数。 */
function defaultRng(max) {
  return randomInt(max)
}

/**
 * 不放回地抽 n 个。
 * @param {any[]} arr 候选池
 * @param {number} n 要抽几个
 * @param {(max:number)=>number} rng 随机源，测试时可注入
 */
export function sample(arr, n, rng = defaultRng) {
  const pool = [...arr]
  const want = Math.max(0, Math.min(Math.floor(n), pool.length))
  const out = []
  for (let i = 0; i < want; i++) {
    const idx = rng(pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

/** 洗牌，Fisher-Yates。 */
export function shuffle(arr, rng = defaultRng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 摇一次老虎机。
 *
 * 每个滚轮对应一个分类，滚轮停下时吐出该分类的若干项。
 * @param {object} groups 分组后的餐品，形如 { 主食: [...], 小吃: [...], 饮品: [...] }
 * @param {Array<{group:string, count:number}>} reels 滚轮设置，count 为该轮要出几项
 * @param {object} [opts]
 * @param {(max:number)=>number} [opts.rng] 随机源，测试时可注入
 * @param {(item:any)=>boolean} [opts.priority] 优先判定。命中的元素优先被抽中，
 *   上上签用它落实「今日宜」。命中数不够时才去普通池补。
 * @returns {{ results: object[], reels: object[] }}
 */
export function spin(groups, reels, { rng = defaultRng, priority = null } = {}) {
  const results = []
  const detail = []
  for (const reel of reels || []) {
    // count 为 0 表示这一轮不要，直接跳过，不占结果也不进明细
    const count = Math.max(0, Math.floor(reel.count ?? 0))
    if (count === 0) continue

    const pool = groups[reel.group] || []
    let picked
    if (priority) {
      const pref = pool.filter((it) => priority(it))
      const rest = pool.filter((it) => !priority(it))
      picked =
        pref.length >= count
          ? sample(pref, count, rng)
          : [...sample(pref, pref.length, rng), ...sample(rest, count - pref.length, rng)]
    } else {
      picked = sample(pool, count, rng)
    }
    detail.push({
      group: reel.group,
      count,
      picked,
      poolSize: pool.length,
      preferred: priority ? pool.filter((it) => priority(it)).length : null,
    })
    results.push(...picked.map((it) => ({ ...it, group: reel.group })))
  }
  return { results, reels: detail }
}

/**
 * 完全随机：不分分类，从全部候选里抽 n 样。
 * 愿赌服输模式用这个。
 */
export function drawAny(items, n, rng = defaultRng) {
  return sample(items, n, rng).map((it) => ({ ...it, group: it.group || '随机' }))
}

/**
 * 校验滚轮设置。
 *
 * 数量为 0 表示这个分类不要，是允许的。约束只有一条：
 * 所有分类加起来至少要有一份。这是需求里「最少有一项」的意思，
 * 指的是总餐量，不是每个分类各来一份。
 */
export function validateReels(reels, { maxTotal = 30 } = {}) {
  const list = Array.isArray(reels) ? reels.filter((r) => r && r.group) : []
  if (!list.length) throw new Error('至少要有一个分类')

  const normalized = list.map((r) => ({
    group: r.group,
    count: Math.max(0, Math.floor(Number(r.count) || 0)),
  }))
  const total = normalized.reduce((s, r) => s + r.count, 0)

  if (total < 1) throw new Error('总餐量至少要有一份')
  if (total > maxTotal) throw new Error(`总数 ${total} 超过上限 ${maxTotal}`)
  return normalized
}
