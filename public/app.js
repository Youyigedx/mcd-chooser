/**
 * 选餐助手前端。原生 ES 模块，零依赖。
 * 所有数据都从本机服务端取，浏览器拿不到 Token。
 */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const state = { store: null, mode: null, menu: null }

/* ---------------- 网络 ---------------- */

async function api(path, options) {
  const res = await fetch(path, options)
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`服务端返回了非 JSON（HTTP ${res.status}）`)
  }
  if (!json.ok) throw new Error(json.error || `请求失败（HTTP ${res.status}）`)
  return json.data
}
const get = (path) => api(path)
const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/* ---------------- 基础渲染 ---------------- */

const panel = () => $('#panel')
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function render(html) {
  panel().innerHTML = html
}
function renderLoading(text = '正在向麦当劳 MCP 取数……') {
  render(`<div class="loading"><div class="spinner"></div>${esc(text)}</div>`)
}
function renderError(msg, extra = '') {
  render(`<div class="alert">${esc(msg)}</div>${extra}`)
}
const yuan = (n) => (n == null ? '—' : `¥${Number(n).toFixed(2)}`)

/** 与 server/grouping.js 的 COMBO_PATTERN 保持一致。盲盒只抽单品。 */
const COMBO_RE = /套餐|件套|随心配|随心拼|随心选|拼盘|四宫格|分享餐|双人餐|单人餐|多人餐|乐园餐/
const isComboName = (name) => COMBO_RE.test(String(name || ''))

/* ---------------- 门店 ---------------- */

async function findStores() {
  const city = $('#city').value.trim()
  const keyword = $('#keyword').value.trim()
  if (!city || !keyword) return renderError('城市和位置关键词都要填。')

  const list = $('#store-list')
  list.innerHTML = '<div class="muted" style="padding:8px 0">查询中……</div>'
  try {
    const stores = await get(`/api/stores?city=${encodeURIComponent(city)}&keyword=${encodeURIComponent(keyword)}`)
    if (!stores.length) {
      list.innerHTML = '<div class="muted" style="padding:8px 0">这一带没找到门店，换个关键词试试。</div>'
      return
    }
    list.innerHTML = stores
      .map(
        (s, i) => `
      <button class="store-item ${state.store?.storeCode === s.storeCode ? 'active' : ''}" data-idx="${i}">
        <span>
          <span class="name">${esc(s.storeName)}</span>
          <span class="meta"> · ${esc(s.address || '')}</span>
        </span>
        <span class="meta">
          ${s.distance != null ? s.distance + 'm · ' : ''}${esc(s.businessStartTime || '')}-${esc(s.businessEndTime || '')}
          <span class="pill ${s.openNow ? 'open' : 'closed'}">${s.openNow ? '营业中' : '已打烊'}</span>
        </span>
      </button>`,
      )
      .join('')
    $$('.store-item', list).forEach((btn) =>
      btn.addEventListener('click', () => selectStore(stores[Number(btn.dataset.idx)])),
    )
    selectStore(stores[0])
  } catch (e) {
    list.innerHTML = ''
    renderError(e.message)
  }
}

async function selectStore(store) {
  state.store = store
  state.menu = null
  $$('.store-item').forEach((b) => b.classList.remove('active'))
  const idx = $$('.store-item').findIndex((b) => b.querySelector('.name')?.textContent === store.storeName)
  if (idx >= 0) $$('.store-item')[idx].classList.add('active')

  if (!state.mode) {
    render(`<div class="empty">
      <p>已选门店：<strong>${esc(store.storeName)}</strong></p>
      <p class="muted">上面挑一个模式开始。</p>
    </div>`)
  } else {
    runMode(state.mode)
  }
}

/* ---------------- 老虎机 ---------------- */

/**
 * 渲染滚轮数量控件，并绑定加减。返回一个「读取当前设置」的函数。
 * 数量可以减到 0（表示这个分类不要），约束是总数至少一份。
 */
function mountReelControls(container, groups) {
  container.innerHTML = groups
    .map(
      (g) => `<div class="counter" data-group="${esc(g)}">
        <span>${esc(g)}</span><button data-step="-1">−</button><span class="cnt">1</span><button data-step="1">＋</button>
      </div>`,
    )
    .join('')

  $$('[data-step]', container).forEach((b) =>
    b.addEventListener('click', () => {
      const cnt = $('.cnt', b.closest('.counter'))
      cnt.textContent = Math.min(4, Math.max(0, Number(cnt.textContent) + Number(b.dataset.step)))
    }),
  )

  return () =>
    $$('.counter', container).map((box) => ({
      group: box.dataset.group,
      count: Number($('.cnt', box).textContent),
    }))
}

/** 从滚轮设置里挑出真正要摇的轮子，并校验总数。 */
function activeReels(picked) {
  const active = picked.filter((r) => r.count > 0)
  if (!active.length) throw new Error('总餐量至少要有一份。')
  return active
}

/**
 * 渲染滚轮容器。
 * @param {Array<{group:string,count:number}>} reels
 */
function slotHtml(reels) {
  return `<div class="slot">${reels
    .map(
      (r) => `
    <div class="reel-box" data-group="${esc(r.group)}">
      <div class="reel"><div class="reel-strip"><div class="reel-item">…</div></div></div>
      <div class="reel-label">${esc(r.group)} × ${r.count}</div>
    </div>`,
    )
    .join('')}</div>`
}

/** 单个滚轮从快速翻动减速停到目标文字。 */
function spinReel(itemEl, finalText, pool, duration) {
  return new Promise((resolve) => {
    const start = performance.now()
    const step = () => {
      const p = Math.min((performance.now() - start) / duration, 1)
      if (p < 1) {
        itemEl.textContent = pool[Math.floor(Math.random() * pool.length)] || '…'
        setTimeout(step, 45 + p * p * 240)
      } else {
        itemEl.textContent = finalText
        itemEl.classList.add('hit')
        resolve()
      }
    }
    step()
  })
}

/**
 * 摇所有滚轮。每个轮子的结果按 group 分组取。
 * @param {Array} results 服务端返回的 items（带 group）
 * @param {string[]} pool 翻动时用的候选文字
 */
async function spinAll(results, pool) {
  const boxes = $$('.reel-box')
  const jobs = boxes.map((box, i) => {
    const group = box.dataset.group
    const names = results.filter((r) => r.group === group).map((r) => r.name)
    const finalText = names.join(' + ') || '—'
    const itemEl = $('.reel-item', box)
    // 错开停止时间，右轮比左轮晚一点，更像真老虎机
    return new Promise((resolve) => {
      setTimeout(() => spinReel(itemEl, finalText, pool, 1500 + i * 320).then(resolve), i * 180)
    })
  })
  await Promise.all(jobs)
}

/* ---------------- 结果卡片 ---------------- */

function linesHtml(items) {
  if (!items?.length) return ''
  return `<ul class="lines">${items
    .map(
      (it) =>
        `<li><span>${esc(it.productName || it.name)}${it.quantity > 1 ? ` ×${it.quantity}` : ''}</span><span>${yuan(
          it.subtotal != null ? it.subtotal / 100 : it.price,
        )}</span></li>`,
    )
    .join('')}</ul>`
}

function cardHtml({ tag, tagClass = '', title, price, note, lines, extra = '', best = false }) {
  return `<div class="card ${best ? 'best' : ''}">
    <div class="card-head">
      <span class="card-title">${tag ? `<span class="tag ${tagClass}">${esc(tag)}</span>` : ''}${esc(title)}</span>
      <span class="card-price">${price}</span>
    </div>
    ${note ? `<div class="card-note">${note}</div>` : ''}
    ${lines || ''}
    ${extra}
  </div>`
}

/* ---------------- 各模式 ---------------- */

async function ensureMenu() {
  if (state.menu) return state.menu
  state.menu = await get(`/api/menu?storeCode=${encodeURIComponent(state.store.storeCode)}`)
  return state.menu
}

/** 月底选餐 */
async function runMonth() {
  render(`
    <div class="section-title">月底选餐</div>
    <div class="section-sub">枚举单品、套餐、组合、凑单四类候选，逐个走官方接口真实计价。</div>
    <div class="row">
      <div class="counter">
        <span class="muted">几个人吃</span>
        <button data-step="-1">−</button><span id="people">1</span><button data-step="1">＋</button>
      </div>
      <button id="go" class="btn primary">开始算</button>
    </div>
    <div id="out"></div>`)

  const peopleEl = $('#people')
  $$('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = Math.min(6, Math.max(1, Number(peopleEl.textContent) + Number(b.dataset.step)))
      peopleEl.textContent = next
    }),
  )

  $('#go').addEventListener('click', async () => {
    const out = $('#out')
    out.innerHTML = '<div class="loading"><div class="spinner"></div>逐个候选真实计价，约 10 秒……</div>'
    try {
      const d = await post('/api/pick/month', { storeCode: state.store.storeCode, people: Number(peopleEl.textContent) })
      const meals = d.meals
        .map((m, i) =>
          cardHtml({
            tag: m.kind,
            tagClass: m.hasCoupon ? 'coupon' : '',
            title: m.title,
            price: yuan(m.price),
            note:
              m.saved > 0
                ? `<span class="saving">省 ${yuan(m.saved)}</span>（原价 ${yuan(m.originalPrice)}）`
                : `原价 ${yuan(m.originalPrice)}`,
            lines: linesHtml(m.items),
            best: i === 0,
          }),
        )
        .join('')
      const extras = d.extras
        .map((m) =>
          cardHtml({
            tag: m.kind,
            tagClass: m.hasCoupon ? 'coupon' : '',
            title: m.title,
            price: yuan(m.price),
            lines: linesHtml(m.items),
          }),
        )
        .join('')
      out.innerHTML = `
        <div class="muted" style="margin:10px 0 12px">
          枚举 ${d.counts.candidates} 个候选，成功计价 ${d.counts.quoted} 个${d.counts.failed ? `，失败 ${d.counts.failed} 个` : ''}
        </div>
        <div class="result">${meals}</div>
        ${extras ? `<div class="section-title" style="margin:20px 0 8px">加购推荐</div><div class="result">${extras}</div>` : ''}
        ${d.failedSamples?.length ? `<div class="muted" style="margin-top:12px">个别候选计价失败：${esc(d.failedSamples.map((f) => f.title).join('、'))}</div>` : ''}`
    } catch (e) {
      out.innerHTML = `<div class="alert">${esc(e.message)}</div>`
    }
  })
}

/** 盲盒：老虎机 */
async function runBlind() {
  const menu = await ensureMenu()
  const groups = Object.keys(menu.groups || {}).filter((g) => g !== '未分组')

  render(`
    <div class="section-title">盲盒选餐</div>
    <div class="section-sub">每个分类一个滚轮，数量自由加减。总餐量至少一份，某个分类不想要就减到 0。</div>
    <div class="row" id="reel-ctrl"></div>
    <div class="row"><button id="go" class="btn primary">摇一次</button></div>
    <div id="out"></div>`)

  const readReels = mountReelControls($('#reel-ctrl'), groups)

  $('#go').addEventListener('click', async () => {
    const out = $('#out')
    let active
    try {
      active = activeReels(readReels())
    } catch (e) {
      return (out.innerHTML = `<div class="alert">${esc(e.message)}</div>`)
    }

    out.innerHTML = `${slotHtml(active)}<div id="reveal"></div>`
    try {
      const d = await post('/api/pick/blind', { storeCode: state.store.storeCode, reels: active })
      // 翻动动画的候选池也用单品，不然滚轮里闪过的全是套餐名
      const pool = (menu.items || []).filter((i) => !isComboName(i.name)).map((i) => i.name)
      await spinAll(d.items, pool)
      $('#reveal').innerHTML = `
        ${d.excludedCombos ? `<div class="card-note" style="margin-top:14px">已从候选池剔除 ${d.excludedCombos} 个套餐／拼盘类组合，盲盒只开单品。</div>` : ''}
        <div class="result" style="margin-top:18px">
          ${cardHtml({
            tag: '摇出',
            title: `${d.items.length} 样`,
            price: d.priced?.price != null ? yuan(d.priced.price) : yuan(d.total),
            note: d.priced?.price != null ? '官方接口实时计价' : '菜单价合计',
            lines: linesHtml(
              d.priced?.lines?.length ? d.priced.lines : d.items.map((i) => ({ name: i.name, price: i.price })),
            ),
            best: true,
          })}
        </div>`
    } catch (e) {
      out.innerHTML = `<div class="alert">${esc(e.message)}</div>`
    }
  })
}

/** 健康选餐 */
async function runHealth() {
  render(`
    <div class="section-title">健康选餐</div>
    <div class="section-sub">给一个卡路里预算，在门店里配出最合适的一餐。</div>
    <div class="slider-row">
      <input type="range" id="kcal" min="200" max="1200" step="50" value="600">
      <span class="kcal-val" id="kcal-val">600 kcal</span>
    </div>
    <div class="row"><button id="go" class="btn primary">开始配餐</button></div>
    <div id="out"></div>`)

  const slider = $('#kcal')
  slider.addEventListener('input', () => ($('#kcal-val').textContent = `${slider.value} kcal`))

  $('#go').addEventListener('click', async () => {
    const out = $('#out')
    out.innerHTML = '<div class="loading"><div class="spinner"></div>枚举组合中……</div>'
    try {
      const d = await post('/api/pick/health', { storeCode: state.store.storeCode, kcal: Number(slider.value) })
      out.innerHTML = `
        <div class="muted" style="margin:10px 0">
          门店 ${d.stats.menu} 个餐品里有营养数据的 ${d.stats.usable} 个，枚举 ${d.combosTried} 种组合。
          ${d.stats.usable < d.stats.menu ? '套餐和部分新品查不到营养数据，不在候选中。' : ''}
        </div>
        <div class="result">${d.plans
          .map((p, i) =>
            cardHtml({
              tag: `${p.fillPercent}%`,
              title: `${p.kcal} / ${p.budget} kcal`,
              price: p.priced?.price != null ? yuan(p.priced.price) : '—',
              note: `蛋白 ${p.protein}g · 钠 ${p.sodium}mg`,
              lines: linesHtml(
                p.items.map((it, i) => ({
                  name: `${it.name}（${it.nutrition.kcal} kcal）`,
                  // 价格优先取实时计价的分项，拿不到才退回菜单价
                  price: p.priced?.lines?.[i]?.subtotal != null ? p.priced.lines[i].subtotal / 100 : it.price,
                })),
              ),
              best: i === 0,
            }),
          )
          .join('')}</div>`
    } catch (e) {
      out.innerHTML = `<div class="alert">${esc(e.message)}</div>`
    }
  })
}

/** 上上签 */
async function runFortune() {
  const menu = await ensureMenu()
  const groups = Object.keys(menu.groups || {}).filter((g) => g !== '未分组')

  render(`
    <div class="section-title">上上签</div>
    <div class="section-sub">先看今日黄历宜忌，再按宜忌抽今日之签。数量同样可以自由加减。</div>
    <div class="row" id="reel-ctrl"></div>
    <div class="row"><button id="go" class="btn primary">求今日签</button></div>
    <div id="out"></div>`)

  const readReels = mountReelControls($('#reel-ctrl'), groups)

  $('#go').addEventListener('click', async () => {
    const out = $('#out')
    let reels
    try {
      reels = activeReels(readReels())
    } catch (e) {
      return (out.innerHTML = `<div class="alert">${esc(e.message)}</div>`)
    }
    out.innerHTML = '<div class="loading"><div class="spinner"></div>推算今日宜忌……</div>'
    try {
      const d = await post('/api/pick/fortune', { storeCode: state.store.storeCode, reels })
      const a = d.almanac
      out.innerHTML = `
        <div class="almanac">
          <div class="almanac-head">
            <div class="almanac-date">${esc(a.date)}　星期${esc(a.weekday)}</div>
            <div class="almanac-ganzhi">${esc(a.ganzhi.year)}年　${esc(a.ganzhi.month)}月　${esc(a.ganzhi.day)}日</div>
            <div class="almanac-jianchu">${esc(a.jianchu)}执位　·　生肖${esc(a.ganzhi.zodiac)}</div>
          </div>
          <div class="yiji">
            <div class="yiji-col yi"><h4>今日宜</h4><ul>${d.guidance.yi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
            <div class="yiji-col ji"><h4>今日忌</h4><ul>${d.guidance.ji.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          </div>
        </div>
        ${slotHtml(reels)}
        <div id="reveal"></div>`
      const pool = (menu.items || []).map((i) => i.name).slice(0, 60)
      await spinAll(d.items, pool)
      $('#reveal').innerHTML = `
        <div class="result" style="margin-top:18px">
          <div class="card best">
            <div class="card-head">
              <span class="card-title">今日之签</span>
              <span class="card-price">${d.priced?.price != null ? yuan(d.priced.price) : yuan(d.total)}</span>
            </div>
            <ul class="lines">${d.items
              .map(
                (i) =>
                  `<li><span>${i.lucky ? '<span class="tag lucky">宜</span>' : ''}${esc(i.name)}</span><span>${yuan(
                    i.price,
                  )}</span></li>`,
              )
              .join('')}</ul>
          </div>
        </div>`
    } catch (e) {
      out.innerHTML = `<div class="alert">${esc(e.message)}</div>`
    }
  })
}

/** 愿赌服输 */
async function runGamble() {
  render(`
    <div class="section-title">愿赌服输</div>
    <div class="section-sub">完全随机，不分分类。摇出什么就吃什么。</div>
    <div class="promise">
      <h3>先签承诺书</h3>
      <p>本人自愿参与本次随机点餐。无论摇出什么，全部吃完，绝不浪费。</p>
    </div>
    <div class="row">
      <div class="counter"><span class="muted">摇几样</span><button data-step="-1">−</button><span id="count">7</span><button data-step="1">＋</button></div>
      <label class="muted"><input type="checkbox" id="agree"> 我已阅读并同意上述承诺</label>
      <button id="go" class="btn primary" disabled>签了，开摇</button>
    </div>
    <div id="out"></div>`)

  const countEl = $('#count')
  const agree = $('#agree')
  const go = $('#go')
  $$('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = Math.min(10, Math.max(5, Number(countEl.textContent) + Number(b.dataset.step)))
      countEl.textContent = next
    }),
  )
  agree.addEventListener('change', () => (go.disabled = !agree.checked))

  go.addEventListener('click', async () => {
    const out = $('#out')
    const n = Number(countEl.textContent)
    out.innerHTML = '<div class="loading"><div class="spinner"></div>正在摇号……</div>'
    try {
      const d = await post('/api/pick/gamble', {
        storeCode: state.store.storeCode,
        count: n,
        acceptPromise: true,
      })
      out.innerHTML = `
        <div class="slot"><div class="reel-box" data-group="__all">
          <div class="reel"><div class="reel-strip"><div class="reel-item">…</div></div></div>
          <div class="reel-label">${n} 样</div>
        </div></div>
        <div id="reveal"></div>`
      const menu = await ensureMenu()
      const pool = (menu.items || []).map((i) => i.name)
      await spinAll([{ group: '__all', name: `开 ${n} 样` }], pool.slice(0, 80))
      $('#reveal').innerHTML = `
        <div class="result" style="margin-top:18px">
          <div class="receipt">承诺书凭证　${esc(d.promise.id)}<br>签署时间　　${esc(d.promise.signedAt)}</div>
          ${cardHtml({
            tag: '结果',
            title: `${d.items.length} 样`,
            price: d.priced?.price != null ? yuan(d.priced.price) : yuan(d.total),
            lines: linesHtml(d.priced?.lines?.length ? d.priced.lines : d.items.map((i) => ({ name: i.name, price: i.price }))),
            best: true,
          })}
        </div>`
    } catch (e) {
      out.innerHTML = `<div class="alert">${esc(e.message)}</div>`
    }
  })
}

/* ---------------- 路由 ---------------- */

const MODES = { month: runMonth, blind: runBlind, health: runHealth, fortune: runFortune, gamble: runGamble }

async function runMode(mode) {
  state.mode = mode
  $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode))
  if (!state.store) {
    render(`<div class="empty"><p>先在上面选一家门店。</p></div>`)
    return
  }
  try {
    await MODES[mode]()
  } catch (e) {
    renderError(e.message)
  }
}

$$('.mode').forEach((btn) => btn.addEventListener('click', () => runMode(btn.dataset.mode)))
$('#find-stores').addEventListener('click', findStores)
$('#keyword').addEventListener('keydown', (e) => e.key === 'Enter' && findStores())

// 打开页面就先找一次门店，省得用户多点一下。
// ?mode=fortune 直接进某个模式；再加 &auto=1 就连主按钮一起点掉（截图和自测用）。
findStores().then(() => {
  const params = new URLSearchParams(location.search)
  const wanted = params.get('mode')
  if (!wanted || !MODES[wanted]) return
  runMode(wanted).then(() => {
    if (params.get('auto') !== '1') return
    setTimeout(() => {
      const agree = $('#agree')
      if (agree && !agree.checked) {
        agree.checked = true
        agree.dispatchEvent(new Event('change'))
      }
      $('#go')?.click()
    }, 400)
  })
})
