/**
 * 菜单分类归组。
 *
 * query-meals 返回 14 个分类，名字带换行和斜杠，而且粒度不一
 * （「巨无霸 牛鱼肉堡」和「饮品」在同一层）。用户的直觉只有三种：
 * 主食、小吃、饮品。这里做一次归组，老虎机的滚轮按这三类出。
 */

/** 归组表。键是组名，值是菜单分类名的关键词。 */
const GROUP_RULES = [
  {
    key: '主食',
    emoji: '🍔',
    // 汉堡、卷、套餐类。注意不要放营销位（人气热卖），它是跨类的，
    // 会把「蘸酱炸鸡」这种小食错归成主食。
    match: ['巨无霸', '牛鱼肉堡', '安格斯', '厚牛堡', '鸡肉汉堡', '大堡口福', '精选单人餐', '500 大卡', '随心配'],
  },
  {
    key: '小吃',
    emoji: '🍟',
    match: ['小食', '炸鸡', '蘸酱', '开心乐园'],
  },
  {
    key: '饮品',
    emoji: '🥤',
    match: ['饮品'],
  },
]

/**
 * 调味酱不参与搭配。否则会凑出「炸鸡 + 蘸酱 + 矿泉水」这种怪组合。
 * 锚定结尾，不然「蘸酱炸鸡」这种带蘸酱的炸鸡也会被误伤。
 */
const SEASONING = /酱$|蘸料$|调料$|风味盐$/

/**
 * 套餐 / 拼盘这类组合商品。
 * 盲盒只抽单品：抽到套餐就没有「开盲盒」的感觉了，
 * 而且一份套餐的价格往往顶好几个单品。
 */
const COMBO_PATTERN = /套餐|件套|随心配|随心拼|随心选|拼盘|四宫格|分享餐|双人餐|单人餐|多人餐|乐园餐/

/** 判断是不是套餐类组合商品。 */
export function isCombo(item) {
  return COMBO_PATTERN.test(String(item?.name || ''))
}

/** 只留单品，剔掉套餐类。 */
export function singlesOnly(items) {
  return (items || []).filter((it) => !isCombo(it))
}

/** 组顺序，前端按这个顺序摆滚轮。 */
export const GROUP_ORDER = GROUP_RULES.map((r) => r.key)

/** 分类名兜不住时（例如归属是营销位「人气热卖」），按商品名猜一次。 */
const NAME_HINTS = [
  { key: '饮品', re: /可乐|雪碧|芬达|咖啡|美式|拿铁|奶茶|果汁|豆浆|纯悦|水$|茶$|饮/ },
  { key: '主食', re: /汉堡|堡|卷|件套|套餐|随心配|饭|派盒/ },
  { key: '小吃', re: /薯条|鸡块|鸡翅|鸡柳|炸鸡|麦旋风|冰淇淋|圆筒|新地|苹果片|玉米|沙拉|拼盘/ },
]

/**
 * 判断一个餐品属于哪一组。
 * 先看分类名，再看商品名，都命中不了返回 null。
 */
export function groupOf(category, productName = '') {
  const name = String(category || '')
  for (const rule of GROUP_RULES) {
    if (rule.match.some((kw) => name.includes(kw))) return rule.key
  }
  const pn = String(productName || '')
  for (const hint of NAME_HINTS) {
    if (hint.re.test(pn)) return hint.key
  }
  return null
}

/**
 * 把餐品列表按三大类归组。
 * @returns {{ 主食: item[], 小吃: item[], 饮品: item[], 未分组: item[] }}
 */
export function groupItems(items) {
  const out = { 主食: [], 小吃: [], 饮品: [], 未分组: [] }
  for (const it of items) {
    const g = groupOf(it.category, it.name)
    // 调味酱不参与搭配，否则会凑出「炸鸡 + 蘸酱 + 矿泉水」这种组合
    if (g === '小吃' && SEASONING.test(it.name)) {
      out.未分组.push({ ...it, group: '未分组' })
      continue
    }
    if (g) out[g].push({ ...it, group: g })
    else out.未分组.push({ ...it, group: '未分组' })
  }
  return out
}

/** 组名的展示信息，前端取 emoji 用。 */
export function groupMeta(key) {
  const rule = GROUP_RULES.find((r) => r.key === key)
  return rule ? { key: rule.key, emoji: rule.emoji } : { key, emoji: '🍽' }
}
