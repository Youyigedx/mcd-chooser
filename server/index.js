/**
 * 本地服务：静态页面 + JSON API。
 *
 * 所有 MCP 调用都在服务端完成，Token 只留在本机进程里，前端拿不到。
 * 零依赖，只用 node 内置模块。
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasToken, clearCache } from './mcp.js'
import { findStores, getMenu, getNutrition, sortByDistance, isOpenNow } from './catalog.js'
import { groupItems } from './grouping.js'
import { pointsSummary } from './points.js'
import { pickMonth } from './modes/month.js'
import { pickBlind } from './modes/blind.js'
import { pickHealth } from './modes/health.js'
import { pickFortune } from './modes/fortune.js'
import { pickGamble } from './modes/gamble.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')
const PORT = Number(process.env.PORT || 8787)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function send(res, status, body) {
  const isText = typeof body === 'string'
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(isText ? body : JSON.stringify(body))
}

const ok = (res, data) => send(res, 200, { ok: true, data })
const fail = (res, status, message, extra = {}) => send(res, status, { ok: false, error: message, ...extra })

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function requireField(body, key) {
  const v = body?.[key]
  if (v === undefined || v === null || v === '') {
    throw Object.assign(new Error(`缺少参数 ${key}`), { status: 400 })
  }
  return v
}

/**
 * 数值兜底。注意 Number(null) === 0、Number('') === 0，
 * 所以必须先挡掉 null / undefined / 空串，否则「没传 beType」会变成 beType=0，
 * 而接口只认 1（到店）和 5（得来速），直接报 600046。
 */
const num = (v, dflt) => {
  if (v === null || v === undefined || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/** GET /api/stores?city=&keyword=&beType= */
async function apiStores(url) {
  const stores = sortByDistance(
    await findStores({
      city: url.searchParams.get('city') || '',
      keyword: url.searchParams.get('keyword') || '',
      beType: num(url.searchParams.get('beType'), 1),
    }),
  )
  return stores.map((s) => ({ ...s, openNow: isOpenNow(s) }))
}

/**
 * GET /api/menu?storeCode=
 *
 * getMenu 返回的是拍平后的菜单，不带 group 字段（分组是 groupItems 的活）。
 * 前端要按「主食 / 小吃 / 饮品」摆滚轮，所以这里补上分组再返回。
 */
async function apiMenu(url) {
  const storeCode = url.searchParams.get('storeCode')
  if (!storeCode) throw Object.assign(new Error('缺少 storeCode'), { status: 400 })
  const raw = await getMenu(storeCode, {
    orderType: num(url.searchParams.get('orderType'), 1),
    beType: num(url.searchParams.get('beType'), 1),
  })
  const grouped = groupItems(raw)
  const items = Object.values(grouped).flat()
  return {
    storeCode,
    count: items.length,
    categories: [...new Set(items.map((i) => i.category))],
    groups: Object.fromEntries(Object.entries(grouped).map(([g, list]) => [g, list.length])),
    items,
  }
}

/** GET /api/nutrition */
async function apiNutrition() {
  const nut = await getNutrition()
  return { columns: nut.columns, count: nut.rows.length }
}

const ROUTES = [
  ['GET', '/api/health', async () => ({ tokenLoaded: hasToken(), service: 'mcd-picker', time: new Date().toISOString() })],
  ['GET', '/api/stores', (url) => apiStores(url)],
  ['GET', '/api/menu', (url) => apiMenu(url)],
  ['GET', '/api/nutrition', () => apiNutrition()],
  ['GET', '/api/points', () => pointsSummary()],
  ['POST', '/api/cache/clear', async () => (clearCache(), { cleared: true })],

  // 五个点餐模式
  ['POST', '/api/pick/month', (url, body) =>
    pickMonth({ storeCode: requireField(body, 'storeCode'), people: num(body.people, 1), top: num(body.top, 6) })],
  ['POST', '/api/pick/blind', (url, body) =>
    pickBlind({ storeCode: requireField(body, 'storeCode'), reels: requireField(body, 'reels') })],
  ['POST', '/api/pick/health', (url, body) =>
    pickHealth({
      storeCode: requireField(body, 'storeCode'),
      kcal: num(body.kcal, 600),
      structure: body.structure,
    })],
  ['POST', '/api/pick/fortune', (url, body) =>
    pickFortune({
      storeCode: requireField(body, 'storeCode'),
      reels: requireField(body, 'reels'),
      date: body.date ? new Date(body.date) : new Date(),
    })],
  ['POST', '/api/pick/gamble', (url, body) =>
    pickGamble({
      storeCode: requireField(body, 'storeCode'),
      count: num(body.count, 7),
      acceptPromise: body.acceptPromise === true,
    })],
]

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '')
  const file = join(PUBLIC_DIR, safe)
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'forbidden')
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    fail(res, 404, `not found: ${pathname}`)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const { pathname } = url
  const method = req.method || 'GET'

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname)

  const route = ROUTES.find(([m, p]) => m === method && p === pathname)
  if (!route) return fail(res, 404, `no such api: ${method} ${pathname}`)

  let body = {}
  if (method === 'POST') body = await readBody(req)

  try {
    ok(res, await route[2](url, body))
  } catch (e) {
    const status = e.status || (e.businessCode ? 502 : 500)
    fail(res, status, e.message || String(e), {
      ...(e.businessCode ? { businessCode: e.businessCode } : {}),
      ...(e.needPromise ? { needPromise: true } : {}),
    })
  }
})

server.listen(PORT, () => {
  console.log(`mcd-picker running at http://localhost:${PORT}`)
  if (!hasToken()) {
    console.log('warning: no token found. set MCD_MCP_TOKEN or create a .env file.')
  }
})

// 收到中断信号时先关连接再退出，免得留下占着端口的僵尸进程
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nshutting down...')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 800).unref()
  })
}
