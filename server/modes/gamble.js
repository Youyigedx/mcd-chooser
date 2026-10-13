/**
 * 愿赌服输选餐：完全随机，5 到 10 样，先签承诺书。
 *
 * 这是给主播整活用的模式。两个设计点：
 *   1. 随机用 node:crypto，不是 Math.random。观众会盯着有没有被算法操控。
 *   2. 承诺书是进入门槛，签完生成一张带哈希的凭证，摇出来的结果和凭证绑在一起。
 *      哈希只覆盖门店、数量、餐品 code 和时间，不含个人信息。
 */
import { createHash } from 'node:crypto'
import { getMenu } from '../catalog.js'
import { drawAny } from '../random.js'
import { priceOf } from './month.js'

const MIN = 5
const MAX = 10

export const PROMISE_TEXT = '本人自愿参与本次随机点餐。无论摇出什么，全部吃完，绝不浪费。'

const yuan = (c) => (c == null ? null : Math.round(c) / 100)

/** 生成承诺书凭证。哈希把「这一单」钉死，防止摇完再换。 */
export function promiseReceipt({ storeCode, count, items, at = new Date() }) {
  const raw = `${storeCode}|${count}|${items.map((i) => i.code).join(',')}|${at.toISOString()}`
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12).toUpperCase()
  const day = at.toISOString().slice(0, 10).replace(/-/g, '')
  return {
    id: `MCD-${day}-${hash}`,
    text: PROMISE_TEXT,
    signedAt: at.toISOString(),
    hash,
  }
}

/**
 * 摇一把。
 * @param {object} opts
 * @param {number} opts.count 几样，5 到 10
 * @param {boolean} opts.acceptPromise 必须为 true，表示签了承诺书
 */
export async function pickGamble({
  storeCode,
  count = 7,
  acceptPromise = false,
  orderType = 1,
  beType = 1,
  withPrice = true,
}) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < MIN || n > MAX) {
    throw Object.assign(new Error(`数量要在 ${MIN} 到 ${MAX} 之间，收到 ${count}`), { status: 400 })
  }
  if (!acceptPromise) {
    throw Object.assign(new Error(`要先签承诺书：${PROMISE_TEXT}`), { status: 400, needPromise: true })
  }

  const menu = await getMenu(storeCode, { orderType, beType })
  if (menu.length < n) {
    throw Object.assign(new Error(`门店只有 ${menu.length} 个餐品，凑不齐 ${n} 样`), { status: 400 })
  }

  const picked = drawAny(menu, n)
  const items = picked.map((p) => ({
    code: p.code,
    name: p.name,
    group: p.group,
    price: p.price,
    image: p.image,
  }))

  const receipt = promiseReceipt({ storeCode, count: n, items })

  const summary = {
    storeCode,
    count: n,
    promise: receipt,
    items,
    total: items.reduce((s, i) => s + (i.price || 0), 0),
  }

  if (!withPrice) return { ...summary, priced: null }

  try {
    const r = await priceOf(
      storeCode,
      items.map((i) => ({ productCode: i.code, quantity: 1 })),
      { orderType, beType },
    )
    summary.priced = {
      price: yuan(r.price),
      originalPrice: yuan(r.originalPrice),
      discount: yuan(r.discount),
      // 明细用实时计价的分项，别用菜单价，否则明细加起来对不上总价
      lines: (r.productList || []).map((p) => ({
        productName: p.productName,
        quantity: p.quantity,
        subtotal: p.subtotal,
      })),
    }
  } catch (e) {
    summary.priced = { error: e.message.slice(0, 100) }
  }

  return summary
}
