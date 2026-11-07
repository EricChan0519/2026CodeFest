/**
 * 地點搜尋的模糊比對（站牌、連鎖店共用，全部在裝置上算）。
 *
 * 使用者打的說法常和資料裡的名稱不同：
 * - 「芝山捷運站」「芝山站」「捷運 芝山」都要找得到「捷運芝山站(中山北路)」
 * - 「公園 芝山」用空白分開、順序不同
 * - 「天母棒球埸」打錯一個字
 *
 * 做法：先拿掉「捷運」「站」「公車站」這類種類字，剩下的叫「核心」（芝山）；
 * 核心在名稱裡連續出現最好，空白分開的詞都出現次之，四個字以上允許錯一個字。
 * 種類字（捷運）有對上的再加分，所以「芝山捷運站」會把捷運站排在「芝山國小」前面。
 */

/** 臺／台統一、去空白、小寫 */
export function normalizeQuery(s: string): string {
  return s.replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase()
}

/** 種類字：長的放前面，避免「公車站牌」先被「站」切掉 */
const KIND_WORDS: { word: string; tag: string }[] = [
  { word: '捷運站', tag: 'mrt' },
  { word: '捷運', tag: 'mrt' },
  { word: 'mrtstation', tag: 'mrt' },
  { word: 'mrt', tag: 'mrt' },
  { word: 'metro', tag: 'mrt' },
  { word: '公車站牌', tag: 'bus' },
  { word: '公車站', tag: 'bus' },
  { word: '站牌', tag: 'bus' },
  { word: '公車', tag: 'bus' },
  { word: 'busstop', tag: 'bus' },
  { word: 'station', tag: '' },
  { word: '站', tag: '' },
  // 正式名稱的前綴，站牌通常省略（「國立臺灣大學」→ 站牌「臺灣大學」）
  { word: '臺北市立', tag: '' },
  { word: '國立', tag: '' },
  { word: '市立', tag: '' },
]

/** 名稱裡出現這些字，就算有這個種類 */
const TAG_IN_NAME: Record<string, string[]> = {
  mrt: ['捷運', 'mrt', 'metro'],
  bus: [],
}

export interface ParsedQuery {
  /** 正規化後的整個搜尋字串 */
  full: string
  /** 拿掉種類字之後的核心；只有種類字時是空字串 */
  core: string
  /** 使用者用空白分開的詞，各自拿掉種類字（「芝山 公園」→ 芝山、公園） */
  words: string[]
  /** 使用者提到的種類（mrt、bus） */
  tags: string[]
}

function stripKindWords(s: string, tags: Set<string>): string {
  let out = s
  for (const { word, tag } of KIND_WORDS) {
    if (out.includes(word)) {
      out = out.split(word).join('')
      if (tag) tags.add(tag)
    }
  }
  return out
}

export function parseQuery(q: string): ParsedQuery {
  const tags = new Set<string>()
  const full = normalizeQuery(q)
  const core = stripKindWords(full, tags)
  const words = q
    .trim()
    .split(/\s+/)
    .map((w) => stripKindWords(normalizeQuery(w), new Set()))
    .filter(Boolean)
  return { full, core, words, tags: [...tags] }
}

const isLatin = (s: string) => /^[\x00-\x7f]*$/.test(s)

/** 名稱裡有沒有一段和 core 一樣長、只差一個字的地方（打錯字） */
function oneTypoAway(core: string, key: string): boolean {
  const a = [...core]
  const b = [...key]
  for (let i = 0; i + a.length <= b.length; i++) {
    let diff = 0
    for (let j = 0; j < a.length && diff <= 1; j++) if (a[j] !== b[i + j]) diff++
    if (diff <= 1) return true
  }
  return false
}

export interface FuzzyOptions {
  /** false：只接受核心連續出現（資料量大、怕雜訊時用，例如連鎖店） */
  loose?: boolean
}

/**
 * 模糊分數 0–1；0 表示不算符合。完全相同、開頭相同、包含整個字串的情況由呼叫端自己給更高分。
 * key 必須已經 normalizeQuery 過。
 */
export function fuzzyScore(parsed: ParsedQuery, key: string, opts: FuzzyOptions = {}): number {
  const { core, words, tags } = parsed
  const { loose = true } = opts
  // 太短的核心（「山」「a」）會配到一大堆，不做模糊
  if (core.length < (isLatin(core) ? 3 : 2)) return 0

  let base = 0
  if (key.includes(core)) base = 0.7
  else if (!loose) return 0
  // 空白分開的每個詞都出現，順序不限（「公園 芝山」）
  else if (words.length > 1 && words.every((w) => key.includes(w))) base = 0.45
  // 四個字以上允許打錯一個字（「天母棒球埸」）；英文字母太常見，不做
  else if (!isLatin(core) && [...core].length >= 4 && oneTypoAway(core, key)) base = 0.3
  else return 0

  // 使用者說了「捷運」，名稱也有「捷運」的排前面
  const wanted = tags.filter((t) => TAG_IN_NAME[t]?.length)
  if (wanted.length) {
    const hit = wanted.filter((t) => TAG_IN_NAME[t]!.some((w) => key.includes(w))).length
    base += (0.2 * hit) / wanted.length
  }
  // 名稱越接近核心的長度越好（「捷運芝山站」優先於「捷運芝山站(中山北路)」）
  return base + 0.05 * Math.min(1, core.length / Math.max(1, key.length))
}
