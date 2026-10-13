// 工具：细看 query-meals 与 list-nutrition-foods 的数据形状，决定解析层怎么写。
import { readFileSync } from 'node:fs'

const ENDPOINT = 'https://mcp.mcd.cn'

function loadToken() {
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN
  const cfg = JSON.parse(readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8'))
  return cfg.mcpServers['mcd-mcp'].headers.Authorization
}

const TOKEN = loadToken()

async function callData(name, args = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: TOKEN,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  })
  const msg = await res.json()
  if (msg.error) throw new Error(JSON.stringify(msg.error))
  return msg.result.structuredContent
}

const line = (t) => console.log('\n' + '='.repeat(70) + '\n' + t)

line('query-meals 结构')
const m = await callData('query-meals', { storeCode: '3450046', orderType: 1, beType: 1 })
const md = m.data
console.log('data 顶层键:', Object.keys(md).join(', '))
console.log('categories 数量:', md.categories?.length)
const c0 = md.categories?.[0]
console.log('categories[0] 键:', Object.keys(c0).join(', '))
console.log('categories[0].name:', c0.name, '| meals 数:', c0.meals?.length)
console.log('categories[0].meals[0]:', JSON.stringify(c0.meals?.[0]))
console.log('categories[0].meals[1]:', JSON.stringify(c0.meals?.[1]))

const keys = new Set()
let total = 0
for (const c of md.categories || []) {
  for (const x of c.meals || []) {
    total++
    Object.keys(x).forEach((k) => keys.add(k))
  }
}
console.log('餐品总数:', total, '| meal 字段并集:', [...keys].join(', '))
console.log('data.meals 类型:', Array.isArray(md.meals) ? `array[${md.meals.length}]` : typeof md.meals)
if (Array.isArray(md.meals)) {
  console.log('data.meals[0]:', JSON.stringify(md.meals[0]))
  console.log('data.meals[1]:', JSON.stringify(md.meals[1]))
  const mk = new Set()
  md.meals.forEach((x) => Object.keys(x).forEach((k) => mk.add(k)))
  console.log('data.meals 字段并集:', [...mk].join(', '))
} else if (md.meals && typeof md.meals === 'object') {
  const kk = Object.keys(md.meals).slice(0, 3)
  console.log('data.meals 前 3 个键:', kk.join(', '))
  console.log('对应值:', JSON.stringify(md.meals[kk[0]]))
}

line('两套 code 能不能对上')
const catCodes = new Set()
for (const c of md.categories || []) for (const x of c.meals || []) catCodes.add(x.code)
const dictKeys = Object.keys(md.meals || {})
console.log('分类里的 code 数:', catCodes.size, '| meals 字典键数:', dictKeys.length)
console.log('分类 code 样本:', [...catCodes].slice(0, 5).join(', '))
console.log('字典键样本    :', dictKeys.slice(0, 5).join(', '))
const hit = [...catCodes].filter((c) => md.meals[c]).length
console.log('分类 code 能在字典里找到的:', hit, '/', catCodes.size)
if (hit === 0) {
  const byName = new Map(Object.entries(md.meals).map(([k, v]) => [v.name, k]))
  console.log('字典里叫“巨无霸”的键:', byName.get('巨无霸'))
  let nameHit = 0
  for (const c of catCodes) {
    const det = await callData('query-meal-detail', { storeCode: '3450046', orderType: 1, beType: 1, code: c })
    if (byName.has(det.data.name)) nameHit++
    if (nameHit >= 3) break
  }
  console.log('抽样按名字匹配成功的数量:', nameHit)
}
console.log('分类名列表:', (md.categories || []).map((c) => `${c.name}(${c.meals?.length ?? 0})`).join(' / '))

line('query-meal-detail 结构（单品的名字与价格在哪）')
const d = await callData('query-meal-detail', { storeCode: '3450046', orderType: 1, beType: 1, code: md.categories[0].meals[0].code })
console.log('data 键:', Object.keys(d.data).join(', '))
console.log('预览:', JSON.stringify(d.data).slice(0, 400))

line('list-nutrition-foods 结构')
const n = await callData('list-nutrition-foods', {})
console.log('data 类型:', typeof n.data)
const s = String(n.data)
const lines = s.split('\n')
console.log('总行数:', lines.length)
console.log('行0:', lines[0])
console.log('行1:', lines[1])
console.log('行2:', lines[2])
console.log('行末:', lines[lines.length - 1])
