/**
 * 下单与订单查询。
 *
 * 这是全项目唯一会产生真实副作用的操作：调 create-order 会在账号里
 * 生成一笔待支付订单。所以拆成两步，强制走确认：
 *
 *   previewOrder  只算价、取可选取餐方式，不创建任何东西
 *   createOrder   真正下单，必须显式传 confirm: true
 *
 * 一个实测坑：create-order 的响应里 amount / goods / orderStatus 都是空的，
 * 真数据在 query-order 里。所以下单成功后要补一次查询，否则界面上金额是「¥」。
 */
import { callData } from './mcp.js'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * 下单前预览：算价并取出可选取餐方式。
 * 不创建任何订单，可以随便调。
 */
export async function previewOrder({ storeCode, items, orderType = 1, beType = 1, takeWayCode }) {
  const priced = await callData('calculate-price', { storeCode, orderType, beType, items })
  const takeWayList = priced.takeWayList || []
  const chosen = (takeWayCode && takeWayList.find((t) => t.code === takeWayCode)) || takeWayList[0] || null

  return {
    storeCode,
    orderType,
    beType,
    items,
    takeWayList,
    takeWayCode: chosen?.code || null,
    takeWayText: chosen ? `${chosen.title}（${chosen.subtitle}）` : null,
    price: num(priced.price) / 100,
    originalPrice: num(priced.originalPrice) / 100,
    discount: num(priced.discount) / 100,
    lines: (priced.productList || []).map((p) => ({
      productName: p.productName,
      quantity: p.quantity,
      subtotal: p.subtotal,
    })),
  }
}

/** 查订单详情。金额、商品、状态、支付截止时间都从这里来。 */
export async function fetchOrderDetail(orderId) {
  const d = await callData('query-order', { orderId })
  return {
    orderId: d.orderId,
    orderStatus: d.orderStatus,
    statusCode: d.status,
    storeName: d.storeName,
    storeAddress: d.storeAddress,
    takeWay: d.takeWay,
    totalAmount: num(d.totalAmount),
    realTotalAmount: num(d.realTotalAmount),
    discount: num(d.totalDiscountAmount),
    productPrice: num(d.productPrice),
    deliveryPrice: num(d.realDeliveryPrice),
    packingFee: num(d.realPackingFeeTotalPrice),
    tablewarePrice: num(d.tablewarePrice),
    goods: (d.orderProductList || []).map((p) => ({
      name: p.productName,
      quantity: p.quantity,
      price: num(p.price),
      image: p.productImage,
      combo: (p.comboItemList || []).map((c) => ({ name: c.itemName, quantity: c.itemQuantity })),
    })),
    coupons: (d.couponList || []).map((c) => ({ name: c.couponName, discount: num(c.discountAmount) })),
    createTime: d.createTime,
    expirePayTime: d.expirePayTime,
    payId: d.payId,
    pickupCode: d.pickupCode,
    remark: d.remark,
  }
}

/**
 * 真正下单。会创建一笔待支付订单。
 * @param {object} opts
 * @param {boolean} opts.confirm 必须为 true，否则拒绝
 */
export async function createOrder({
  storeCode,
  items,
  orderType = 1,
  beType = 1,
  takeWayCode,
  addressId,
  reservationDate,
  remark,
  confirm,
}) {
  if (confirm !== true) {
    throw Object.assign(new Error('下单会真实创建订单，需要显式确认'), { status: 400, needConfirm: true })
  }
  if (!Array.isArray(items) || !items.length) {
    throw Object.assign(new Error('没有要下单的商品'), { status: 400 })
  }
  if (!storeCode) {
    throw Object.assign(new Error('缺少门店'), { status: 400 })
  }

  const args = { storeCode, orderType, beType, items }

  if (orderType === 1) {
    // 到店场景必传取餐方式，取值来自 calculate-price 的 takeWayList
    if (!takeWayCode) {
      throw Object.assign(new Error('到店订单要先选取餐方式（堂食还是外带）'), { status: 400 })
    }
    args.takeWayCode = takeWayCode
  } else {
    if (!addressId) {
      throw Object.assign(new Error('外送订单要先选配送地址'), { status: 400 })
    }
    args.addressId = addressId
  }
  if (reservationDate) args.reservationDate = reservationDate
  if (remark) args.remark = remark

  const r = await callData('create-order', args)

  // create-order 只给订单号和支付链接，金额和商品要再查一次
  let detail = null
  try {
    detail = await fetchOrderDetail(r.orderId)
  } catch {
    // 查详情失败不影响下单事实，界面退化成只显示订单号和支付链接
  }

  return {
    orderId: r.orderId,
    payId: r.payId || detail?.payId || null,
    payH5Url: r.payH5Url || null,
    orderStatus: detail?.orderStatus || '待支付',
    amount: detail?.realTotalAmount ?? null,
    totalAmount: detail?.totalAmount ?? null,
    discount: detail?.discount ?? null,
    takeWay: detail?.takeWay || null,
    storeName: detail?.storeName || null,
    goods: detail?.goods || [],
    coupons: detail?.coupons || [],
    createTime: detail?.createTime || null,
    expirePayTime: detail?.expirePayTime || null,
    next: detail?.expirePayTime
      ? `请在 ${detail.expirePayTime} 前完成支付，逾期订单会取消。`
      : '请通过支付链接扫码，或打开麦当劳 APP 完成支付。',
  }
}
