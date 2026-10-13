// 验证券商品的正确计价方式：券绑定专属 productCode，要买那个 code 才享优惠。
import { callData } from '../server/mcp.js'
import { findStores, getMenu } from '../server/catalog.js'

const line = (t) => console.log('\n' + '='.repeat(70) + '\n' + t)
const yuan = (n) => (n == null ? '-' : '¥' + (n / 100).toFixed(2))

const stores = await findStores({ city: '重庆', keyword: '沙坪坝' })
const store = stores[0]
const menu = await getMenu(store.storeCode)
const S = store.storeCode
const base = { storeCode: S, orderType: 1, beType: 1 }

async function price(items, label) {
  try {
    const r = await callData('calculate-price', { ...base, items })
    console.log(`  ${label}`)
    console.log(`    原价 ${yuan(r.originalPrice)}  现价 ${yuan(r.price)}  优惠 ${yuan(r.discount)}`)
    if (r.enjoyable) console.log(`    enjoyable: ${JSON.stringify(r.enjoyable)}`)
    if (r.productList) {
      for (const p of r.productList) console.log(`      · ${p.productName} x${p.quantity}  小计 ${yuan(p.subtotal)}`)
    }
    return r
  } catch (e) {
    console.log(`  ${label}  -> 失败 ${e.businessCode || ''} ${e.message.slice(0, 90)}`)
    return null
  }
}

line('1. 券的专属商品 code 直接计价')
const coupons = await callData('query-store-coupons', { ...base })
const usable = Array.isArray(coupons) ? coupons : []
for (const c of usable) {
  const code = c.products?.[0]?.productCode
  console.log(`\n券「${c.title}」→ 商品 code ${code}（${c.products?.[0]?.productName}）`)
  await price([{ productCode: code, quantity: 1 }], '数量 1')
  await price([{ productCode: code, quantity: 2 }], '数量 2（测买一送一）')
}

line('2. 券商品 code 是否在普通菜单里')
const menuCodes = new Set(menu.map((m) => m.code))
for (const c of usable) {
  const code = c.products?.[0]?.productCode
  console.log(`  ${code} 在菜单中：${menuCodes.has(code)}`)
}

line('3. 套餐类商品（名字含套餐/件套/随心配）')
const combos = menu.filter((m) => /套餐|件套|随心配|1\+1|拼盘/.test(m.name))
console.log(`  共 ${combos.length} 个，取前 3 个计价：`)
for (const m of combos.slice(0, 3)) {
  console.log(`\n  [${m.name}] 菜单价 ¥${m.price} code=${m.code}`)
  await price([{ productCode: m.code, quantity: 1 }], '计价')
}

line('4. 组合：券商品 + 普通单品（能不能一单一起算）')
const couponCode = usable[0]?.products?.[0]?.productCode
if (couponCode) {
  const extra = menu.find((m) => m.name === '巨无霸')
  await price(
    [{ productCode: couponCode, quantity: 1 }, { productCode: extra.code, quantity: 1 }],
    `券商品 + ${extra.name}`,
  )
}

line('5. 同一张券用到别的商品（确认失败原因）')
if (usable[0]) {
  await price(
    [{ productCode: usable[0].products[0].productCode, quantity: 1, couponId: usable[0].couponId, couponCode: usable[0].couponCode }],
    '券商品 + couponId/couponCode',
  )
}
