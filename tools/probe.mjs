// 工具：探测 mcd MCP 各工具的响应格式，为解析层提供依据。
// 用法：node tools/probe.mjs
import { readFileSync } from 'node:fs'

const ENDPOINT = 'https://mcp.mcd.cn'

function loadToken() {
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN
  const cfg = JSON.parse(readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8'))
  return cfg.mcpServers['mcd-mcp'].headers.Authorization
}

const TOKEN = loadToken()

async function callTool(name, args = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: TOKEN,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const raw = await res.text()
  return { status: res.status, ctype: res.headers.get('content-type') || '', raw }
}

// 从原始响应里取出 MCP 的 text 载荷。响应可能是 JSON，也可能是 SSE。
function extractPayload(raw, ctype) {
  let body = raw
  if (ctype.includes('text/event-stream')) {
    body = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
  }
  const msg = JSON.parse(body)
  if (msg.error) return { error: msg.error }
  if (msg.result?.isError) return { error: msg.result }
  const text = (msg.result?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  return { text, structured: msg.result?.structuredContent }
}

const probes = [
  ['query-nearby-stores', { beType: 1, searchType: 2, city: '重庆', keyword: '沙坪坝' }],
  ['now-time-info', {}],
  ['list-nutrition-foods', {}],
  ['available-coupons', {}],
  ['query-my-account', {}],
  ['campaign-calendar', {}],
  ['query-meals', { storeCode: '3450046', orderType: 1, beType: 1 }],
]

for (const [name, args] of probes) {
  const { status, ctype, raw } = await callTool(name, args)
  console.log('='.repeat(72))
  console.log(`${name}  status=${status}  ctype=${ctype}  rawLen=${raw.length}`)

  let payload
  try {
    payload = extractPayload(raw, ctype)
  } catch (e) {
    console.log(`  !! 载荷解析失败: ${e.message}`)
    console.log(`  raw 开头: ${raw.slice(0, 160)}`)
    continue
  }
  if (payload.error) {
    console.log(`  !! 工具返回错误: ${JSON.stringify(payload.error).slice(0, 200)}`)
    continue
  }

  const text = payload.text || ''
  console.log(`  text 长度: ${text.length}`)
  console.log(`  含 structuredContent: ${payload.structured ? 'yes' : 'no'}`)
  if (payload.structured) {
    const s = payload.structured
    const kind = Array.isArray(s) ? `array[${s.length}]` : typeof s
    console.log(`  structuredContent 类型: ${kind}`)
    if (!Array.isArray(s) && s && typeof s === 'object') {
      console.log(`  structuredContent 顶层键: ${Object.keys(s).join(', ')}`)
    }
    console.log(`  structuredContent 预览: ${JSON.stringify(s).slice(0, 300)}`)
  }
  console.log(`  含 '## Original Response': ${text.includes('## Original Response')}`)
  console.log(`  text 首行: ${text.split('\n')[0].slice(0, 100)}`)

  // 尝试从 Original Response 之后取 JSON
  const marker = '## Original Response'
  const idx = text.indexOf(marker)
  const candidate = idx >= 0 ? text.slice(idx + marker.length).trim() : text.trim()
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  let parsed = null
  if (first >= 0 && last > first) {
    try {
      parsed = JSON.parse(candidate.slice(first, last + 1))
      console.log(`  ✅ Original Response 后可 JSON.parse，顶层键: ${Object.keys(parsed).join(', ')}`)
    } catch (e) {
      console.log(`  ⚠️  JSON.parse 失败: ${e.message}`)
    }
  }
  if (!parsed) {
    console.log(`  样本(前 200 字): ${candidate.slice(0, 200).replace(/\n/g, '\\n')}`)
  }
}
