/**
 * 餐品目录与营养数据。
 *
 * query-meals 一次返回两样东西，用同一个 code 键串起来：
 *   data.categories  分类 -> [{ code, tags }]
 *   data.meals       code -> { name, image, currentPrice, originalPrice }
 * 实测 107 个分类条目在字典里 107 个命中，所以一次请求就能拿全名字和价格，
 * 不用逐个去查 query-meal-detail。
 */
import { callData, cached } from './mcp.js'

const MENU_TTL_MS = 5 * 60 * 1000
const NUTRITION_TTL_MS = 30 * 60 * 1000

/**
 * 把 query-meals 的结果拍平成数组，并挂上分类名。
 *
 * 「人气热卖」是营销位，里面的商品在正式分类里也有一份。
 * 实测 114 条里有 107 个唯一 code，重复的 7 条都来自这里。
 * 所以按 code 去重，并优先采信非营销分类的归属。
 */
export function flattenMenu(data) {
  const dict = data?.meals || {}
  const byCode = new Map()
  for (const cat of data?.categories || []) {
    const catName = normalizeCategory(cat.name)
    const isMarketing = /人气热卖|热销|推荐/.test(catName)
    for (const m of cat.meals || []) {
      const info = dict[m.code]
      if (!info) continue
      const existing = byCode.get(m.code)
      if (existing && !existing._marketing) continue
      if (existing && existing._marketing && isMarketing) continue
      byCode.set(m.code, {
        code: m.code,
        name: info.name,
        image: info.image,
        price: toNumber(info.currentPrice),
        originalPrice: toNumber(info.originalPrice),
        category: catName,
        tags: m.tags || [],
        _marketing: isMarketing,
      })
    }
  }
  return [...byCode.values()].map(({ _marketing, ...rest }) => rest)
}

/** 分类名里有换行和斜杠，统一压成一行。 */
export function normalizeCategory(name) {
  return String(name || '').replace(/\s+/g, ' ').trim()
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 取门店菜单。默认缓存 5 分钟。 */
export async function getMenu(storeCode, { orderType = 1, beType = 1, ttlMs = MENU_TTL_MS, fresh = false } = {}) {
  const key = `menu:${storeCode}:${orderType}:${beType}`
  if (fresh) {
    const data = await callData('query-meals', { storeCode, orderType, beType })
    return flattenMenu(data)
  }
  const data = await cached(key, ttlMs, () => callData('query-meals', { storeCode, orderType, beType }))
  return flattenMenu(data)
}

/**
 * 解析 list-nutrition-foods 的紧凑表格。
 * data 是字符串，第一行给出列名，其后每行是一条记录：
 *   [160]{productName,nutritionDescription,energyKj,energyKcal,...}:
 *     猪柳麦满分,null,1288,308,16,16,24,781,213
 */
export function parseNutrition(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return { columns: [], rows: [] }

  const head = lines[0].match(/^\[(\d+)\]\{([^}]+)\}\s*:?$/)
  if (!head) return { columns: [], rows: [] }

  const columns = head[2].split(',').map((c) => c.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim())
    if (cells.length !== columns.length) continue
    const row = {}
    columns.forEach((col, idx) => {
      const raw = cells[idx]
      row[col] = raw === '' || raw === 'null' ? null : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw
    })
    rows.push(row)
  }
  return { columns, rows }
}

/** 营养表按名字索引，方便和菜单对上。 */
export async function getNutrition({ ttlMs = NUTRITION_TTL_MS, fresh = false } = {}) {
  const key = 'nutrition'
  const text = fresh
    ? await callData('list-nutrition-foods', {})
    : await cached(key, ttlMs, () => callData('list-nutrition-foods', {}))
  const { columns, rows } = parseNutrition(text)
  const byName = new Map()
  for (const r of rows) {
    if (r.productName) byName.set(normalizeName(r.productName), r)
  }
  return { columns, rows, byName }
}

/** 名字归一化：去空格、统一括号、去掉修饰。用于菜单名和营养表名的匹配。 */
export function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .replace(/[""'']/g, '')
    .toLowerCase()
}

/**
 * 把菜单条目和营养数据对上。
 * 先精确匹配，再去掉括号内容重试。
 */
export function matchNutrition(menuItem, nutritionIndex) {
  const { byName } = nutritionIndex
  const key = normalizeName(menuItem.name)
  if (byName.has(key)) return byName.get(key)
  const stripped = key.replace(/\([^)]*\)/g, '')
  if (byName.has(stripped)) return byName.get(stripped)
  for (const [k, v] of byName) {
    if (k.startsWith(stripped) || stripped.startsWith(k)) return v
  }
  return null
}

/** 按城市和关键词找门店。searchType=2 是按位置搜索。 */
export async function findStores({ city, keyword, beType = 1 }) {
  if (!city || !keyword) throw new Error('找门店需要同时给 city 和 keyword')
  return callData('query-nearby-stores', { beType, searchType: 2, city, keyword })
}

/** 取收藏的门店。没有收藏会抛业务错误。 */
export async function favoriteStores({ beType = 1 } = {}) {
  return callData('query-nearby-stores', { beType, searchType: 1 })
}

/** 门店按到店距离排序，近的在前。 */
export function sortByDistance(stores) {
  return [...(stores || [])].sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
}

/** 门店当前是否在营业。跨夜门店靠 businessStartTime > businessEndTime 判断。 */
export function isOpenNow(store, now = new Date()) {
  if (store.businessStatus === false) return false
  const start = store.businessStartTime
  const end = store.businessEndTime
  if (!start || !end) return store.businessStatus !== false
  const cur = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  if (s === e) return true
  // 跨夜，例如 18:00 - 06:00
  if (s > e) return cur >= s || cur < e
  return cur >= s && cur < e
}
