// 分析菜单与营养表的覆盖情况，决定 health 模式能用哪些餐品。
import { findStores, getMenu, getNutrition, matchNutrition } from '../server/catalog.js'

const stores = await findStores({ city: '重庆', keyword: '沙坪坝' })
const menu = await getMenu(stores[0].storeCode)
const nut = await getNutrition()

const matched = []
const unmatched = []
for (const m of menu) (matchNutrition(m, nut) ? matched : unmatched).push(m)

console.log(`菜单 ${menu.length} 条  ->  匹配上 ${matched.length}，未匹配 ${unmatched.length}`)

const group = (arr) => {
  const g = {}
  for (const m of arr) g[m.category] = (g[m.category] || 0) + 1
  return Object.entries(g).sort((a, b) => b[1] - a[1])
}

console.log('\n【匹配上的按分类】')
for (const [k, v] of group(matched)) console.log(`  ${String(v).padStart(3)}  ${k}`)

console.log('\n【未匹配的按分类】')
for (const [k, v] of group(unmatched)) console.log(`  ${String(v).padStart(3)}  ${k}`)

const kcals = matched.map((m) => matchNutrition(m, nut).energyKcal).filter((v) => typeof v === 'number')
const sodium = matched.map((m) => matchNutrition(m, nut).sodium).filter((v) => typeof v === 'number')
console.log(`\n有营养的餐品热量范围：${Math.min(...kcals)} - ${Math.max(...kcals)} kcal（${kcals.length} 条有数据）`)
console.log(`钠含量范围：${Math.min(...sodium)} - ${Math.max(...sodium)} mg`)

console.log('\n【未匹配样本 12 条】')
for (const m of unmatched.slice(0, 12)) console.log(`  ${m.name}  [${m.category}]  ¥${m.price}`)
