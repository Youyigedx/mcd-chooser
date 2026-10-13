// 盲盒与上上签的端到端测试。
import { pickBlind } from '../server/modes/blind.js'
import { pickFortune } from '../server/modes/fortune.js'
import { almanac } from '../server/almanac.js'

const storeCode = process.argv[2] || '3450046'
const reels = [
  { group: '主食', count: 1 },
  { group: '小吃', count: 2 },
  { group: '饮品', count: 1 },
]

console.log('=== 盲盒（老虎机）===')
const b = await pickBlind({ storeCode, reels })
console.log('滚轮: ' + b.reels.map((r) => `${r.group}×${r.count}(池${r.poolSize})`).join('  '))
for (const it of b.items) console.log(`  [${it.group}] ${it.name}  ¥${it.price ?? '-'}`)
console.log(`菜单价合计 ¥${b.total.toFixed(2)}`)
if (b.priced?.price != null) console.log(`真实计价 ¥${b.priced.price}（原价 ¥${b.priced.originalPrice} 优惠 ¥${b.priced.discount}）`)
if (b.priced?.error) console.log(`计价失败: ${b.priced.error}`)

console.log('\n=== 上上签 ===')
const f = await pickFortune({ storeCode, reels })
const a = f.almanac
console.log(`${a.date} 周${a.weekday}   ${a.ganzhi.year}年 ${a.ganzhi.month}月 ${a.ganzhi.day}日   ${a.jianchu}执位   生肖${a.ganzhi.zodiac}`)
console.log(`今日宜：${a.guide.yi.join('　')}`)
console.log(`今日忌：${a.guide.ji.join('　')}`)
console.log('各分类过滤后:', JSON.stringify(f.guidance.filterStats))
console.log('滚轮:', f.reels.map((r) => `${r.group}×${r.count}(池${r.poolSize}/宜命中${r.preferred})`).join('  '))
for (const it of f.items) console.log(`  [${it.group}] ${it.name}${it.lucky ? '  ★命中今日宜' : ''}`)
if (f.priced?.price != null) console.log(`真实计价 ¥${f.priced.price}`)

console.log('\n=== 换一天（验证宜忌随之变化）===')
const other = new Date()
other.setDate(other.getDate() + 3)
const f2 = await pickFortune({ storeCode, reels, date: other, withPrice: false })
console.log(`${f2.almanac.date} ${f2.almanac.ganzhi.day}日 ${f2.almanac.jianchu}执位`)
console.log(`宜：${f2.almanac.guide.yi.join('、')}   忌：${f2.almanac.guide.ji.join('、')}`)
console.log('抽中: ' + f2.items.map((i) => i.name).join(' / '))
