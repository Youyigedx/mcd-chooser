// 冒烟测试：验证客户端层和数据层能跑通真实 MCP。
// 用法：node tools/smoke.mjs
import { hasToken, clearCache } from '../server/mcp.js'
import { findStores, getMenu, getNutrition, matchNutrition, isOpenNow } from '../server/catalog.js'

const log = (...a) => console.log(...a)
const rule = (t) => log('\n' + '='.repeat(64) + (t ? '\n' + t : ''))

rule('0. Token')
log(hasToken() ? '  已加载' : '  !! 缺失，检查环境变量或 .env')
if (!hasToken()) process.exit(1)
clearCache()

rule('1. 找门店（重庆 / 沙坪坝）')
const stores = await findStores({ city: '重庆', keyword: '沙坪坝' })
log(`  返回 ${stores.length} 家`)
const store = stores[0]
log(`  选中：${store.storeName}  storeCode=${store.storeCode}  距离 ${store.distance}m`)
log(`  营业 ${store.businessStartTime}-${store.businessEndTime}  当前在营业：${isOpenNow(store)}`)

rule('2. 取菜单并拍平')
const t0 = Date.now()
const menu = await getMenu(store.storeCode)
const t1 = Date.now()
log(`  餐品 ${menu.length} 条，耗时 ${t1 - t0}ms`)
const cats = [...new Set(menu.map((m) => m.category))]
log(`  分类 ${cats.length} 个：${cats.join(' / ')}`)
const priced = menu.filter((m) => m.price != null)
const prices = priced.map((m) => m.price)
log(`  有价格 ${priced.length} 条，价格区间 ¥${Math.min(...prices)} - ¥${Math.max(...prices)}`)
log(`  样例：${JSON.stringify(menu.find((m) => m.name === '巨无霸') || menu[0])}`)

rule('3. 缓存是否生效')
const t2 = Date.now()
await getMenu(store.storeCode)
log(`  第二次取菜单耗时 ${Date.now() - t2}ms（应远小于首次）`)

rule('4. 营养表解析')
const nut = await getNutrition()
log(`  列名：${nut.columns.join(', ')}`)
log(`  记录 ${nut.rows.length} 条`)
log(`  样例：${JSON.stringify(nut.rows[0])}`)

rule('5. 菜单与营养的匹配率')
let hit = 0
const misses = []
for (const m of menu) {
  if (matchNutrition(m, nut)) hit++
  else misses.push(m.name)
}
log(`  命中 ${hit}/${menu.length}（${((hit / menu.length) * 100).toFixed(1)}%）`)
if (misses.length) log(`  未命中 ${misses.length} 条，前 8 个：${misses.slice(0, 8).join(' / ')}`)

rule('完成')
