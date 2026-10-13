/**
 * 盲盒选餐：摇老虎机。
 *
 * 每个滚轮对应一个分类（主食 / 小吃 / 饮品），滚轮数量和每个轮出几项
 * 都由用户定，但至少保留一个轮、每轮至少一项。
 *
 * 抽取只从当前门店的真实菜单里出，所以摇出来的东西一定买得到。
 * 摇完顺带算一次真实价格，用户能直接看到「这顿多少钱」。
 */
import { getMenu } from '../catalog.js'
import { groupItems, singlesOnly } from '../grouping.js'
import { spin, validateReels } from '../random.js'
import { priceOf } from './month.js'

const yuan = (cents) => (cents == null ? null : Math.round(cents) / 100)

/**
 * 摇一次。
 * @param {object} opts
 * @param {string} opts.storeCode 门店
 * @param {Array<{group:string,count:number}>} opts.reels 滚轮设置
 * @param {boolean} opts.withPrice 是否顺带计价，默认 true
 */
export async function pickBlind({ storeCode, reels, orderType = 1, beType = 1, withPrice = true }) {
  const validReels = validateReels(reels)
  const menu = await getMenu(storeCode, { orderType, beType })
  const grouped = groupItems(menu)

  // 盲盒只抽单品。套餐、拼盘、随心配这些组合剔掉，
  // 不然摇出一份四件套，既没有开盲盒的感觉，价格也顶好几个单品。
  const groups = {}
  let excludedCombos = 0
  for (const [g, items] of Object.entries(grouped)) {
    const singles = singlesOnly(items)
    excludedCombos += items.length - singles.length
    groups[g] = singles
  }

  // 要摇的分类必须有货。count 为 0 的分类不参与，不用检查
  const empty = validReels.filter((r) => r.count > 0 && !(groups[r.group] || []).length)
  if (empty.length) {
    throw Object.assign(new Error(`这些分类当前门店没有可选的单品：${empty.map((r) => r.group).join('、')}`), {
      status: 400,
    })
  }

  const { results, reels: detail } = spin(groups, validReels)

  const summary = {
    storeCode,
    excludedCombos,
    reels: detail.map((d) => ({ group: d.group, count: d.count, poolSize: d.poolSize })),
    items: results.map((r) => ({
      code: r.code,
      name: r.name,
      group: r.group,
      price: r.price,
      image: r.image,
    })),
    total: results.reduce((sum, r) => sum + (r.price || 0), 0),
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
      // 明细保留「分」，由前端统一换算。用实时计价的分项而不是菜单价，
      // 两者经常对不上（四件套菜单标 ¥29、实算 ¥57 这种）。
      lines: (priced.productList || []).map((p) => ({
        productName: p.productName,
        quantity: p.quantity,
        subtotal: p.subtotal,
      })),
    }
  } catch (e) {
    // 计价失败不该让整个盲盒失败，摇出来的东西还是有效的
    summary.priced = { error: e.message.slice(0, 120) }
  }

  return summary
}
