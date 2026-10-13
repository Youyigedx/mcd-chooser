// 探测券与计价接口的真实行为，为月底选餐的候选枚举提供依据。
import { callData } from '../server/mcp.js'
import { findStores, getMenu } from '../server/catalog.js'

const line = (t) => console.log('\n' + '='.repeat(70) + '\n' + t)

const stores = await findStores({ city: '重庆', keyword: '沙坪坝' })
const store = stores[0]
console.log(`门店：${store.storeName}  storeCode=${store.storeCode}`)

const menu = await getMenu(store.storeCode)
const bigmac = menu.find((m) => m.name === '巨无霸')
const fries = menu.find((m) => /中薯条|薯条/.test(m.name) && m.price < 15)
const drink = menu.find((m) => m.category === '饮品')
console.log(`样本餐品：巨无霸=${bigmac?.code} ¥${bigmac?.price} | 薯条=${fries?.code} ${fries?.name} ¥${fries?.price} | 饮品=${drink?.code} ${drink?.name} ¥${drink?.price}`)

line('1. query-store-coupons（门店可用券）')
try {
  const coupons = await callData('query-store-coupons', { storeCode: store.storeCode, orderType: 1, beType: 1 })
  console.log('顶层类型:', Array.isArray(coupons) ? `array[${coupons.length}]` : typeof coupons)
  console.log('预览:', JSON.stringify(coupons).slice(0, 900))
  if (Array.isArray(coupons) && coupons.length) {
    console.log('单张券的键:', Object.keys(coupons[0]).join(', '))
  } else if (coupons && typeof coupons === 'object') {
    console.log('对象的键:', Object.keys(coupons).join(', '))
  }
} catch (e) {
  console.log('!! 失败:', e.message)
}

line('2. calculate-price · 单品')
try {
  const r = await callData('calculate-price', {
    storeCode: store.storeCode, orderType: 1, beType: 1,
    items: [{ productCode: bigmac.code, quantity: 1 }],
  })
  console.log('键:', Object.keys(r).join(', '))
  console.log('价格相关:', JSON.stringify({
    price: r.price, originalPrice: r.originalPrice, discount: r.discount,
    productPrice: r.productPrice, packingPrice: r.packingPrice,
  }))
  console.log('productList:', JSON.stringify(r.productList))
  console.log('takeWayList:', JSON.stringify(r.takeWayList))
} catch (e) {
  console.log('!! 失败:', e.message)
}

line('3. calculate-price · 组合（3 样）')
try {
  const r = await callData('calculate-price', {
    storeCode: store.storeCode, orderType: 1, beType: 1,
    items: [
      { productCode: bigmac.code, quantity: 1 },
      { productCode: fries.code, quantity: 1 },
      { productCode: drink.code, quantity: 1 },
    ],
  })
  console.log('price(分):', r.price, ' original:', r.originalPrice, ' discount:', r.discount)
  console.log('折合元:', (r.price / 100).toFixed(2))
} catch (e) {
  console.log('!! 失败:', e.message)
}

line('4. calculate-price · 带券')
try {
  const coupons = await callData('query-store-coupons', { storeCode: store.storeCode, orderType: 1, beType: 1 })
  const list = Array.isArray(coupons) ? coupons : (coupons?.coupons || coupons?.list || [])
  console.log(`拿到 ${list.length} 张券`)
  if (list.length) {
    console.log('第一张券完整字段:', JSON.stringify(list[0]))
    const c = list[0]
    const r = await callData('calculate-price', {
      storeCode: store.storeCode, orderType: 1, beType: 1,
      items: [{ productCode: bigmac.code, quantity: 1, couponId: c.id || c.couponId, couponCode: c.code || c.couponCode }],
    })
    console.log('带券后 price(分):', r.price, ' 折合元:', (r.price / 100).toFixed(2))
  }
} catch (e) {
  console.log('!! 失败:', e.message)
}
