// Health 与愿赌服输的端到端测试。
import { pickHealth } from '../server/modes/health.js'
import { pickGamble } from '../server/modes/gamble.js'

const storeCode = process.argv[2] || '3450046'

console.log('=== Health 选餐（600 kcal 预算）===')
const h = await pickHealth({ storeCode, kcal: 600 })
console.log('样本统计:', JSON.stringify(h.stats))
console.log('枚举组合数:', h.combosTried)
if (h.note) console.log('说明:', h.note)
for (const p of h.plans) {
  console.log(`\n  利用率 ${p.fillPercent}%  ${p.kcal}/${p.budget} kcal  蛋白 ${p.protein}g  钠 ${p.sodium}mg`)
  for (const it of p.items) console.log(`     · [${it.group}] ${it.name}  ${it.nutrition.kcal} kcal`)
  console.log(p.priced?.price != null ? `     真实计价 ¥${p.priced.price}` : `     计价: ${JSON.stringify(p.priced)}`)
}

console.log('\n=== 愿赌服输 ===')
try {
  await pickGamble({ storeCode, count: 7, acceptPromise: false })
  console.log('FAIL  没签承诺书竟然放行了')
} catch (e) {
  console.log('PASS  未签承诺书被拦下')
}
try {
  await pickGamble({ storeCode, count: 3, acceptPromise: true })
  console.log('FAIL  数量 3 竟然放行了')
} catch (e) {
  console.log('PASS  数量越界被拦下:', e.message.slice(0, 30))
}

const g = await pickGamble({ storeCode, count: 7, acceptPromise: true })
console.log(`\n承诺书凭证: ${g.promise.id}`)
console.log(`承诺内容  : ${g.promise.text}`)
for (const it of g.items) console.log(`  · ${it.name}  ¥${it.price}`)
console.log(`菜单价合计 ¥${g.total.toFixed(2)}`)
if (g.priced?.price != null) console.log(`真实计价 ¥${g.priced.price}`)

const g2 = await pickGamble({ storeCode, count: 7, acceptPromise: true, withPrice: false })
const same = g.items.map((i) => i.code).join(',') === g2.items.map((i) => i.code).join(',')
console.log(`\n两次摇号结果是否不同: ${same ? 'FAIL（重复了）' : 'PASS（真随机）'}`)
