/**
 * 麦当劳 MCP 客户端。
 *
 * 走 Streamable HTTP，零第三方依赖。
 * 返回体只取 result.structuredContent，它的形状统一为：
 *   { success, code, message, datetime, traceId, data }
 * 不要解析 text 字段里的 Markdown，那是给人看的展示层。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = process.env.MCD_MCP_ENDPOINT || 'https://mcp.mcd.cn'

/** 官方限流 600 次/分钟。留足余量，两次调用之间至少隔 150 毫秒。 */
const MIN_INTERVAL_MS = 150
/** 429 时的退避基数。 */
const RETRY_BASE_MS = 800
const MAX_RETRY = 3

function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

let tokenCache = ''

/** Token 来源：进程环境变量优先，其次项目根的 .env。 */
export function getToken() {
  if (tokenCache) return tokenCache
  if (process.env.MCD_MCP_TOKEN) {
    tokenCache = process.env.MCD_MCP_TOKEN.trim()
    return tokenCache
  }
  const envPath = join(ROOT, '.env')
  if (existsSync(envPath)) {
    const env = parseEnvFile(readFileSync(envPath, 'utf8'))
    if (env.MCD_MCP_TOKEN) {
      tokenCache = env.MCD_MCP_TOKEN.trim()
      return tokenCache
    }
  }
  return ''
}

export function hasToken() {
  return getToken().length > 0
}

/** 把 Token 写成请求头需要的形态。 */
function authHeader(token) {
  return /^Bearer\s/i.test(token) ? token : `Bearer ${token}`
}

let lastCallAt = 0
let chain = Promise.resolve()

/** 串行化 + 限速。所有出网调用都从这里过。 */
function schedule() {
  chain = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCallAt = Date.now()
  })
  return chain
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 调一个 MCP 工具。
 * @returns {Promise<object>} 完整的 structuredContent
 * @throws {Error} 网络失败、MCP 层错误、或业务 code 非 200
 */
export async function callTool(name, args = {}) {
  const token = getToken()
  if (!token) {
    throw new Error('缺少 Token。请设置环境变量 MCD_MCP_TOKEN，或在项目根放 .env 文件。')
  }

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    await schedule()
    let res
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: authHeader(token),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
    } catch (e) {
      lastError = new Error(`请求 ${name} 失败：${e.message}`)
      await sleep(RETRY_BASE_MS * (attempt + 1))
      continue
    }

    if (res.status === 429) {
      lastError = new Error(`触发限流（429），已重试 ${attempt + 1} 次`)
      await sleep(RETRY_BASE_MS * (attempt + 1) * 2)
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      lastError = new Error(`${name} 返回 HTTP ${res.status}：${body.slice(0, 200)}`)
      if (res.status === 401) break // Token 无效，重试没意义
      await sleep(RETRY_BASE_MS * (attempt + 1))
      continue
    }

    const text = await res.text()
    let msg
    try {
      msg = parseResponse(text, res.headers.get('content-type') || '')
    } catch (e) {
      lastError = new Error(`${name} 响应无法解析：${e.message}`)
      continue
    }

    if (msg.error) throw new Error(`${name} 协议错误：${JSON.stringify(msg.error).slice(0, 200)}`)

    const result = msg.result || {}
    if (result.isError) {
      throw new Error(`${name} 执行失败：${extractText(result).slice(0, 200)}`)
    }

    const structured = result.structuredContent
    if (!structured) {
      // 极少数工具可能只给 text。抛出而不是静默返回空，避免下游拿到假数据。
      throw new Error(`${name} 没有返回 structuredContent`)
    }
    if (structured.success === false || (typeof structured.code === 'number' && structured.code !== 200)) {
      const err = new Error(`${name} 业务失败 code=${structured.code}：${structured.message || ''}`)
      err.businessCode = structured.code
      err.traceId = structured.traceId
      throw err
    }
    return structured
  }
  throw lastError || new Error(`${name} 调用失败`)
}

/** 只取业务数据。大多数场景用这个。 */
export async function callData(name, args = {}) {
  const structured = await callTool(name, args)
  return structured.data
}

/** 响应可能是 JSON，也可能是 SSE。两种都要能解。 */
function parseResponse(text, ctype) {
  if (ctype.includes('text/event-stream')) {
    const payload = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
    return JSON.parse(payload)
  }
  return JSON.parse(text)
}

function extractText(result) {
  return (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

/** 带 TTL 的内存缓存。菜单这类数据没必要每次都拉。 */
const cache = new Map()

export async function cached(key, ttlMs, producer) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  const value = await producer()
  cache.set(key, { at: Date.now(), value })
  return value
}

export function clearCache() {
  cache.clear()
}
