/**
 * 简易黄历，给「上上签」模式用。
 *
 * 干支和十二建除用标准公式算，不是随机数。
 * 校准锚点：2026-10-13 是庚申日、开执位、丙午年戊戌月（取自公开黄历）。
 * 三个公式都对着这个锚点验过。
 *
 * 农历月日需要天文算法（朔望月 + 闰月），本项目不做，只给干支和建除。
 * 「宜忌」是点餐语境的，不是传统黄历的嫁娶安葬那套。它决定抽取范围，
 * 所以同一天的推荐结果是确定的、能解释的。
 */

const STEMS = '甲乙丙丁戊己庚辛壬癸'
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥'
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪'
const JIANCHU = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭']

/** 儒略日数。干支纪日的基础。 */
export function julianDay(y, m, d) {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  )
}

/** 节气近似日。真实节气每年浮动一两天，对建除判断够用。 */
const TERMS = [
  { month: 1, day: 6, branch: 1 },
  { month: 2, day: 4, branch: 2 },
  { month: 3, day: 6, branch: 3 },
  { month: 4, day: 5, branch: 4 },
  { month: 5, day: 6, branch: 5 },
  { month: 6, day: 6, branch: 6 },
  { month: 7, day: 7, branch: 7 },
  { month: 8, day: 8, branch: 8 },
  { month: 9, day: 8, branch: 9 },
  { month: 10, day: 8, branch: 10 },
  { month: 11, day: 7, branch: 11 },
  { month: 12, day: 7, branch: 0 },
]

/** 当前属于哪个节气月，返回地支索引。 */
export function monthBranchIndex(date) {
  const m = date.getMonth() + 1
  const d = date.getDate()
  let cur = TERMS[TERMS.length - 1]
  for (const t of TERMS) {
    if (t.month < m || (t.month === m && t.day <= d)) cur = t
  }
  // 1 月初到小寒之前仍属上一年子月
  if (m === 1 && d < TERMS[0].day) return 0
  return cur.branch
}

/** 日干支。 */
export function dayGanzhi(date) {
  const jdn = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const stemIdx = (((jdn - 1) % 10) + 10) % 10
  const branchIdx = (((jdn + 1) % 12) + 12) % 12
  return { stemIdx, branchIdx, text: STEMS[stemIdx] + BRANCHES[branchIdx] }
}

/** 年干支。以公历年为界，不细究立春分界。 */
export function yearGanzhi(date) {
  const y = date.getFullYear()
  const stemIdx = (((y - 4) % 10) + 10) % 10
  const branchIdx = (((y - 4) % 12) + 12) % 12
  return { stemIdx, branchIdx, text: STEMS[stemIdx] + BRANCHES[branchIdx], zodiac: ZODIAC[branchIdx] }
}

/** 月干支。月序从寅月起算为 1。 */
export function monthGanzhi(date) {
  const yStem = yearGanzhi(date).stemIdx
  const branchIdx = monthBranchIndex(date)
  const order = ((branchIdx - 2 + 12) % 12) + 1 // 寅=1, 卯=2 ...
  const stemIdx = (yStem * 2 + order + 1) % 10
  return { stemIdx, branchIdx, text: STEMS[stemIdx] + BRANCHES[branchIdx] }
}

/** 十二建除。日支相对月支的位置。 */
export function jianchu(date) {
  const day = dayGanzhi(date).branchIdx
  const month = monthBranchIndex(date)
  const idx = (day - month + 12) % 12
  return { idx, name: JIANCHU[idx] }
}

/** 点餐语境的宜忌词条。filter 决定吃什么，effect 影响搭配。 */
export const DINING_ITEMS = {
  宜食牛: { kind: '宜', filter: (m) => /牛|巨无霸|安格斯/.test(m.name + (m.tags || []).join('')) },
  宜食鸡: { kind: '宜', filter: (m) => /鸡|麦乐鸡|脆皮|V翅/.test(m.name) },
  宜尝鲜: { kind: '宜', filter: (m) => (m.tags || []).length > 0 },
  宜加餐: { kind: '宜', effect: 'extraSnack' },
  宜会友: { kind: '宜', effect: 'morePeople' },
  宜成套: { kind: '宜', filter: (m) => /套餐|件套|随心配|拼盘/.test(m.name) },
  宜轻食: { kind: '宜', filter: (m) => /苹果|玉米|沙拉|纯悦|水|茶/.test(m.name) },
  宜大口: { kind: '宜', filter: (m) => /巨无霸|安格斯|厚牛|三层/.test(m.name) },
  忌油炸: { kind: '忌', filter: (m) => !/炸|鸡块|鸡翅|薯条|薯饼/.test(m.name) },
  忌贪凉: { kind: '忌', filter: (m) => !/冰|麦旋风|圆筒|新地|圣代/.test(m.name) },
  忌过甜: { kind: '忌', filter: (m) => !/派|麦旋风|新地|圣代|奶昔|甜品/.test(m.name) },
  忌独食: { kind: '忌', effect: 'hint' },
  忌重口: { kind: '忌', filter: (m) => !/辣|熏|芝士|培根/.test(m.name) },
  忌空腹: { kind: '忌', effect: 'hint' },
}

/** 用日期做确定性洗牌，保证同一天结果一致。 */
function seededShuffle(list, seed) {
  const a = [...list]
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 组装完整黄历。
 * @returns {{date, ganzhi, jianchu, guide: {yi: string[], ji: string[]}}}
 */
export function almanac(date = new Date()) {
  const y = yearGanzhi(date)
  const m = monthGanzhi(date)
  const d = dayGanzhi(date)
  const j = jianchu(date)
  const jdn = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate())

  const yiPool = Object.keys(DINING_ITEMS).filter((k) => DINING_ITEMS[k].kind === '宜')
  const jiPool = Object.keys(DINING_ITEMS).filter((k) => DINING_ITEMS[k].kind === '忌')
  const yi = seededShuffle(yiPool, jdn).slice(0, 3)
  const ji = seededShuffle(jiPool, jdn * 7 + 13).slice(0, 3)

  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    weekday: '日一二三四五六'[date.getDay()],
    ganzhi: { year: y.text, month: m.text, day: d.text, zodiac: y.zodiac },
    jianchu: j.name,
    guide: { yi, ji },
  }
}

/**
 * 把宜忌应用到候选池上。
 * 宜条目的 filter 用来扩大候选（并集），忌条目的 filter 用来排除。
 */
export function applyGuidance(items, guide) {
  const yiFilters = guide.yi.map((k) => DINING_ITEMS[k]?.filter).filter(Boolean)
  const jiFilters = guide.ji.map((k) => DINING_ITEMS[k]?.filter).filter(Boolean)

  const kept = items.filter((it) => jiFilters.every((f) => f(it)))
  // 宜只做加权：命中宜条目的排前面，而不是把没命中的全丢掉
  const scored = kept.map((it) => ({
    item: it,
    score: yiFilters.reduce((n, f) => n + (f(it) ? 1 : 0), 0),
  }))
  const boosted = scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item)

  return {
    items: boosted,
    removed: items.length - kept.length,
    boosted: scored.filter((s) => s.score > 0).length,
  }
}

/** 宜忌里的 effect 项，影响搭配方式。 */
export function guidanceEffects(guide) {
  const all = [...guide.yi, ...guide.ji]
  return {
    extraSnack: guide.yi.some((k) => DINING_ITEMS[k]?.effect === 'extraSnack'),
    morePeople: guide.yi.some((k) => DINING_ITEMS[k]?.effect === 'morePeople'),
    hint: all.some((k) => DINING_ITEMS[k]?.effect === 'hint'),
  }
}
