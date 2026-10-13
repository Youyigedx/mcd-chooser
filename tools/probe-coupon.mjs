// 领券后验证：门店可用券 -> 带券计价 -> 凑单降档字段
import { callData } from '../server/mcp.js'
import { findStores, getMenu } from '../server/catalog.js'

const line = (t) => console.log('\n' + '='.repeat(70) + '\n' + t)

const stores = await findStores({ city: '重庆', keyword: '沙坪坝' })
const store = stores[0]
const menu = await getMenu(store.storeCode, { fresh: true })
const bigmac = menu.find((m) => m.name === '巨无霸')
const fries = menu.find((m) => m.name === '薯条')
console.log(`门店 ${store.storeName}  菜单 ${menu.length} 条`)

line('1. 卡包（query-my-coupons）')
try {
  const bag = await callData('query-my-coupons', {})
  const list = Array.isArray(bag) ? bag : bag?.coupons || []
  console.log(`卡包 ${list.length} 张`)
  if (list.length) console.log('第一张字段:', Object.keys(list[0]).join(', '))
  for (const c of list.slice(0, 6)) {
    console.log(`  - ${c.title || c.couponName || c.name}  enable=${c.enable}  ${c.discountInfo?.discountDesc || ''}`)
  }
} catch (e) {
  console.log('!! 失败:', e.message)
}

line('2. 门店可用券（query-store-coupons）')
let usable = []
try {
  const r = await callData('query-store-coupons', { storeCode: store.storeCode, orderType: 1, beType: 1 })
  usable = Array.isArray(r) ? r : r?.coupons || r?.list || []
  console.log(`门店可用 ${usable.length} 张`)
  if (usable.length) {
    console.log('完整字段:', JSON.stringify(usable[0]))
    for (const c of usable.slice(0, 8)) {
      console.log(`  - ${JSON.stringify(c).slice(0, 220)}`)
    }
  }
} catch (e) {
  console.log('!! 失败:', e.message)
}

line('3. 不带券的基准价')
const base = await callData('calculate-price', {
  storeCode: store.storeCode, orderType: 1, beType: 1,
  items: [{ productCode: bigmac.code, quantity: 1 }],
})
console.log(`巨无霸 单价 ${base.price} 分 = ¥${(base.price / 100).toFixed(2)}`)
console.log(`enjoyable: ${JSON.stringify(base.enjoyable)}`)
console.log(`enjoyed  : ${JSON.stringify(base.enjoyed)}`)

line('4. 带券计价（逐张券试）')
if (!usable.length) {
  console.log('门店没有可用券，跳过')
} else {
  for (const c of usable.slice(0, 5)) {
    const cid = c.couponId || c.id
    const ccode = c.couponCode || c.code
    try {
      const r = await callData('calculate-price', {
        storeCode: store.storeCode, orderType: 1, beType: 1,
        items: [{ productCode: bigmac.code, quantity: 1, couponId: cid, couponCode: ccode }],
      })
      console.log(`  券 ${String(cid).slice(0, 14)} -> price=${r.price} 分  discount=${r.discount}  ¥${(r.price / 100).toFixed(2)}`)
      if (r.enjoyable) console.log(`     enjoyable: ${JSON.stringify(r.enjoyable)}`)
    } catch (e) {
      console.log(`  券 ${String(cid).slice(0, 14)} -> 失败: ${e.message.slice(0, 120)}`)
    }
  }
}

line('5. 凑单降档探测（少量商品，看 balance 字段）')
try {
  const r = await callData('calculate-price', {
    storeCode: store.storeCode, orderType: 1, beType: 1,
    items: [{ productCode: fries.code, quantity: 1 }],
  })
  console.log(`薯条单点 ${r.price} 分，enjoyable=${JSON.stringify(r.enjoyable)}`)
} catch (e) {
  console.log('!! 失败:', e.message)
}
