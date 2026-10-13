// 月底选餐的端到端测试：跑真实计价，看枚举出来的候选和最省解。
import { pickMonth } from '../server/modes/month.js'

const storeCode = process.argv[2] || '3450046'
const people = Number(process.argv[3] || 1)

console.log(`门店 ${storeCode}  ${people} 人\n`)
const t0 = Date.now()
const r = await pickMonth({ storeCode, people, top: 6 })
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('统计:', JSON.stringify(r.counts))

const show = (title, list) => {
  console.log(`\n【${title}】`)
  for (const b of list) {
    const tag = b.hasCoupon ? ' [含券]' : ''
    console.log(`\n  ${b.kind}｜${b.title}${tag}`)
    console.log(`    实付 ¥${b.price}   原价 ¥${b.originalPrice}   省 ¥${b.saved}`)
    for (const it of b.items) {
      console.log(`      · ${it.productName} x${it.quantity}  ¥${(it.subtotal / 100).toFixed(2)}`)
    }
  }
}
show('最省的正餐（含主食）', r.meals)
show('加购推荐（不含主食）', r.extras)
if (r.biggestSave) {
  console.log(`\n【省钱最多的一套】${r.biggestSave.title}  省 ¥${r.biggestSave.saved}（${r.biggestSave.kind}）`)
}

if (r.failedSamples?.length) {
  console.log('\n【计价失败样本】')
  for (const f of r.failedSamples) console.log(`  ${f.kind}｜${f.title} -> ${f.reason}`)
}
