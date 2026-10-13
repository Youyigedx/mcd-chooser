/**
 * 上上签选餐：先看黄历，再按宜忌抽签。
 *
 * 和盲盒的区别在于「宜忌真的管事」：
 *   忌  -> 从候选池里剔除
 *   宜  -> 抽签时优先出命中宜的餐品（命中数不够才去普通池补）
 * 所以同一天、同一门店，抽出来的东西是有说法、可解释的。
 */
import { getMenu } from '../catalog.js'
import { groupItems } from '../grouping.js'
import { spin, validateReels } from '../random.js'
import { priceOf } from './month.js'
import { almanac, applyGuidance, guidanceEffects, DINING_ITEMS } from '../almanac.js'

const yuan = (cents) => (cents == null ? null : Math.round(cents) / 100)

/** 命中「今日宜」的判定，交给 spin 做优先抽取。 */
function makePriority(guide) {
  const filters = guide.yi.map((k) => DINING_ITEMS[k]?.filter).filter(Boolean)
  if (!filters.length) return null
  return (item) => filters.some((f) => f(item))
}

/**
 * 抽一次今日签。
 * @param {object} opts
 * @param {string} opts.storeCode 门店
 * @param {Array<{group:string,count:number}>} opts.reels 滚轮设置
 * @param {Date} [opts.date] 指定日期，默认今天
 */
export async function pickFortune({
  storeCode,
  reels,
  date = new Date(),
  orderType = 1,
  beType = 1,
  withPrice = true,
}) {
  const al = almanac(date)
  const menu = await getMenu(storeCode, { orderType, beType })
  const raw = groupItems(menu)

  // 忌做过滤，宜交给 priority
  const guidedGroups = {}
  const filterStats = {}
  for (const [g, items] of Object.entries(raw)) {
    const r = applyGuidance(items, al.guide)
    guidedGroups[g] = r.items
    filterStats[g] = { before: items.length, after: r.items.length, removed: r.removed }
  }

  const validReels = validateReels(reels)
  const priority = makePriority(al.guide)
  const { results, reels: detail } = spin(guidedGroups, validReels, { priority })

  const items = results.map((r) => ({
    code: r.code,
    name: r.name,
    group: r.group,
    price: r.price,
    image: r.image,
    lucky: priority ? priority(r) : false,
  }))

  const summary = {
    almanac: al,
    guidance: {
      yi: al.guide.yi,
      ji: al.guide.ji,
      effects: guidanceEffects(al.guide),
      filterStats,
    },
    reels: detail.map((d) => ({
      group: d.group,
      count: d.count,
      poolSize: d.poolSize,
      preferred: d.preferred,
    })),
    items,
    total: items.reduce((s, i) => s + (i.price || 0), 0),
  }

  if (!withPrice) return { ...summary, priced: null }

  try {
    const priced = await priceOf(
      storeCode,
      results.map((r) => ({ productCode: r.code, quantity: 1 })),
      { orderType, beType },
    )
    summary.priced = {
      price: yuan(priced.price),
      originalPrice: yuan(priced.originalPrice),
      discount: yuan(priced.discount),
    }
  } catch (e) {
    summary.priced = { error: e.message.slice(0, 120) }
  }

  return summary
}
