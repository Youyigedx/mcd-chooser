/**
 * Health 选餐：按卡路里预算配一餐。
 *
 * 三条实测约束决定了这个模式的边界：
 *   1. 营养表 160 条全是单品，套餐没有营养数据。
 *   2. 菜单 107 条里只有 50 条能和营养表匹配上，其余（套餐、新品）拿不到热量。
 *   3. 有餐品的营养值是 0（数据缺失），直接当「0 卡」用会算出荒唐结果。
 * 所以这里只在「有营养数据且热量大于 0 的单品」里选，并在返回里如实报样本量。
 */
import { getMenu, getNutrition, matchNutrition } from '../catalog.js'
import { groupItems } from '../grouping.js'
import { priceOf } from './month.js'

const yuan = (c) => (c == null ? null : Math.round(c) / 100)

/** 每条组合最多试算多少个，防止笛卡尔积爆掉。 */
const POOL_PER_SLOT = 8

/**
 * 给菜单条目挂上营养数据，只保留真正可用的。
 * @returns {{items: object[], stats: object}}
 */
export async function enrichWithNutrition(storeCode, { orderType = 1, beType = 1 } = {}) {
  const [menu, nut] = await Promise.all([
    getMenu(storeCode, { orderType, beType }),
    getNutrition(),
  ])

  const items = []
  let noMatch = 0
  let zeroKcal = 0
  for (const m of menu) {
    const n = matchNutrition(m, nut)
    if (!n) {
      noMatch++
      continue
    }
    if (!(Number(n.energyKcal) > 0)) {
      zeroKcal++
      continue
    }
    items.push({
      ...m,
      nutrition: {
        kcal: Number(n.energyKcal),
        protein: Number(n.protein) || 0,
        fat: Number(n.fat) || 0,
        carb: Number(n.carbohydrate) || 0,
        sodium: Number(n.sodium) || 0,
        calcium: Number(n.calcium) || 0,
      },
    })
  }

  return {
    items,
    stats: {
      menu: menu.length,
      usable: items.length,
      noMatch,
      zeroKcal,
      nutritionRows: nut.rows.length,
    },
  }
}

/**
 * 按预算配餐。
 * @param {object} opts
 * @param {number} opts.kcal 卡路里上限
 * @param {object} opts.structure 各类要几份，例如 { 主食: 1, 小吃: 1, 饮品: 1 }
 */
export async function pickHealth({
  storeCode,
  kcal = 600,
  structure = { 主食: 1, 小吃: 1, 饮品: 1 },
  top = 5,
  orderType = 1,
  beType = 1,
}) {
  const budget = Math.max(100, Math.floor(Number(kcal) || 600))
  const { items, stats } = await enrichWithNutrition(storeCode, { orderType, beType })
  const groups = groupItems(items)

  // need 大于 1 时展开成多个槽位，允许重复选同一件
  const slots = []
  for (const [group, need] of Object.entries(structure)) {
    const n = Math.floor(Number(need) || 0)
    if (n <= 0) continue
    const pool = (groups[group] || [])
      .slice()
      .sort((a, b) => a.nutrition.kcal - b.nutrition.kcal)
      .slice(0, POOL_PER_SLOT)
    if (!pool.length) continue
    for (let i = 0; i < n; i++) slots.push({ group, pool })
  }

  if (!slots.length) {
    throw Object.assign(new Error('所选结构在当前门店没有可用的营养数据'), { status: 400 })
  }

  // 枚举所有不超过预算的组合
  const combos = []
  const walk = (idx, acc, sum) => {
    if (sum > budget) return
    if (idx === slots.length) {
      combos.push({ picks: [...acc], kcal: sum })
      return
    }
    for (const it of slots[idx].pool) {
      acc.push(it)
      walk(idx + 1, acc, sum + it.nutrition.kcal)
      acc.pop()
    }
  }
  walk(0, [], 0)

  // 打分：预算用得越充分越好，蛋白高加分，钠低加分
  const scored = combos.map((c) => {
    const protein = c.picks.reduce((s, x) => s + x.nutrition.protein, 0)
    const sodium = c.picks.reduce((s, x) => s + x.nutrition.sodium, 0)
    const fill = c.kcal / budget
    const score = fill * 0.6 + Math.min(protein / 40, 1) * 0.2 + (1 - Math.min(sodium / 2000, 1)) * 0.2
    return { ...c, protein, sodium, fill, score }
  })
  // 打分相同（营养一样）时，菜单价低的排前面
  const menuPrice = (picks) => picks.reduce((s, p) => s + (p.price || 0), 0)
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score
    return menuPrice(a.picks) - menuPrice(b.picks)
  })

  // 「麦香鸡套餐」和「麦香鸡」的热量完全一样（都是 369 kcal），
  // 只是差 ¥11。按营养指纹去重，同样营养只留便宜的那套。
  const picked = []
  const seen = new Set()
  for (const s of scored) {
    const key = s.picks
      .map((p) => p.nutrition.kcal)
      .sort((x, y) => x - y)
      .join('+')
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(s)
    if (picked.length >= top) break
  }

  // 对入选的组合做真实计价
  const results = []
  for (const s of picked) {
    const base = {
      items: s.picks.map((p) => ({ code: p.code, name: p.name, group: p.group, price: p.price, nutrition: p.nutrition })),
      kcal: s.kcal,
      budget,
      fillPercent: Math.round(s.fill * 100),
      protein: s.protein,
      sodium: s.sodium,
      score: Number(s.score.toFixed(3)),
    }
    try {
      const r = await priceOf(
        storeCode,
        s.picks.map((p) => ({ productCode: p.code, quantity: 1 })),
        { orderType, beType },
      )
      base.priced = {
        price: yuan(r.price),
        originalPrice: yuan(r.originalPrice),
        discount: yuan(r.discount),
        // 明细用实时计价，否则套餐那几项的菜单价对不上总价
        lines: (r.productList || []).map((p) => ({
          productName: p.productName,
          quantity: p.quantity,
          subtotal: p.subtotal,
        })),
      }
    } catch (e) {
      base.priced = { error: e.message.slice(0, 100) }
    }
    results.push(base)
  }

  return {
    storeCode,
    budget,
    structure,
    combosTried: combos.length,
    stats,
    plans: results,
    note:
      stats.usable < stats.menu
        ? `门店 ${stats.menu} 个餐品里有营养数据的只有 ${stats.usable} 个，套餐和部分新品不在其中。`
        : null,
  }
}
