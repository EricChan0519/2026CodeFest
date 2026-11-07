/**
 * 外語地點搜尋（韓、日、英、印尼、越、泰、高棉）：
 * 1. 搜尋字串不是中文 → 後端 POST /api/translate/query 換成中文（規則＋開放資料，不用 AI 模型）
 * 2. 用中文跑原本的搜尋（站牌、連鎖店、地標、OSM），比直接拿外文去比對準得多
 * 3. 結果的名稱用 POST /api/translate/names 換成使用者的語言；拆不出來的不翻，只給讀音，畫面同時留中文原名
 *    （路上的招牌、站牌都是中文，使用者要對得上）
 */
import { api } from '@/lib/api'
import type { ForeignLang, LocalizedName, Station } from '@/lib/contract'
import type { PoiBrand } from '@/lib/poiSearch'

export const FOREIGN_LANGS: ForeignLang[] = ['en', 'id', 'vi', 'th', 'km', 'ko', 'ja']

/** 韓文、泰文、高棉文、假名、拉丁字母（含越南文）；中文夾雜英文字母（「MRT 芝山」「7-11」）不算 */
const FOREIGN_SCRIPT = /[가-힣฀-๿ក-៿぀-ヿ]/
const LATIN = /[a-zA-ZÀ-ɏḀ-ỿ]{2,}/
const HAN = /[㐀-鿿豈-﫿]/
/** 常見的日文新字體、簡體字（臺灣不用）：「士林駅」「台湾大学」只有漢字，也要先換成繁體再搜尋 */
const JA_OR_SIMPLIFIED = /[湾学駅国区図竜円広鉄楽芸栄医気県剣温経営东门车场馆园宫纪厅华龙汉宁饶圆农阳动乐万兴复师荣机艺术线号长庙]/

export function isForeignQuery(q: string): boolean {
  if (FOREIGN_SCRIPT.test(q) || JA_OR_SIMPLIFIED.test(q)) return true
  return LATIN.test(q) && !HAN.test(q)
}

/** 網址 ?lang=（城市通或選語言畫面指定）；中文或沒指定回 null */
export function pageLang(search: string = typeof location === 'undefined' ? '' : location.search): ForeignLang | null {
  const v = new URLSearchParams(search).get('lang')
  return v && (FOREIGN_LANGS as string[]).includes(v) ? (v as ForeignLang) : null
}

export interface QueryTranslation {
  /** 使用者打的字 */
  from: string
  /** 拿去搜尋的中文；翻不出來時是 null，照原字串搜尋 */
  to: string | null
  /** 其他可能的中文（讓使用者點） */
  alternatives: string[]
  /** 有看不懂、略過的部分 */
  skipped: string[]
  lang: ForeignLang | null
}

/** 外語 → 中文；後端沒開或逾時就丟錯，呼叫端改用原字串搜尋 */
export async function translateForSearch(q: string): Promise<QueryTranslation> {
  const res = await api.translateQuery(q)
  return {
    from: q,
    to: res.queries[0] ?? null,
    alternatives: res.queries.slice(1),
    skipped: res.segments.filter((s) => s.kind === 'unknown').map((s) => s.text),
    lang: res.lang === 'zh' ? null : res.lang,
  }
}

/** 一個中文地名在使用者語言的寫法；approx：有一部分是用讀音寫的（認得的詞翻譯，其他照唸） */
export interface NameLabel {
  text: string
  approx: boolean
}

/** 搜尋結果在使用者語言的寫法：名稱、地址、類別（中文 → 外語） */
export interface ResultLabels {
  names: Map<string, NameLabel>
  addresses: Map<string, string>
  categories: Map<string, string>
}

export const emptyLabels = (): ResultLabels => ({ names: new Map(), addresses: new Map(), categories: new Map() })

const nameCache = new Map<string, LocalizedName>()
const textCache = new Map<string, string | null>()

/** 名稱、地址、類別 → 使用者的語言；同一個只問一次。失敗就回空的（畫面只顯示中文） */
export async function localizeResults(
  lang: ForeignLang,
  input: { names: string[]; addresses?: string[]; categories?: string[] },
): Promise<ResultLabels> {
  const uniq = (xs: string[] = []) => [...new Set(xs.filter(Boolean))]
  const names = uniq(input.names)
  const addresses = uniq(input.addresses)
  const categories = uniq(input.categories)
  const missNames = names.filter((n) => !nameCache.has(`${lang}|${n}`))
  const missAddr = addresses.filter((a) => !textCache.has(`${lang}|a|${a}`))
  const missCat = categories.filter((c) => !textCache.has(`${lang}|c|${c}`))
  for (let i = 0; i < Math.max(missNames.length, missAddr.length, missCat.length); i += 100) {
    try {
      const res = await api.translateNames(lang, missNames.slice(i, i + 100), missAddr.slice(i, i + 100), missCat.slice(i, i + 100))
      for (const item of res.names) nameCache.set(`${lang}|${item.zh}`, item)
      for (const item of res.addresses ?? []) textCache.set(`${lang}|a|${item.zh}`, item.text)
      for (const item of res.categories ?? []) textCache.set(`${lang}|c|${item.zh}`, item.text)
    } catch {
      break
    }
  }
  const out = emptyLabels()
  for (const n of names) {
    const item = nameCache.get(`${lang}|${n}`)
    if (item?.text) out.names.set(n, { text: item.text, approx: !item.exact })
  }
  for (const a of addresses) {
    const text = textCache.get(`${lang}|a|${a}`)
    if (text) out.addresses.set(a, text)
  }
  for (const c of categories) {
    const text = textCache.get(`${lang}|c|${c}`)
    if (text) out.categories.set(c, text)
  }
  return out
}

/**
 * 站牌的外語名稱：英文、印尼文直接用 TDX 的官方英文站名；其他語言用翻譯結果，
 * 只有讀音（approx）又有官方英文站名時，英文站名也一起附上。
 */
export function stopLabel(st: Station, lang: ForeignLang, labels: Map<string, NameLabel>): NameLabel | null {
  const official = st.name.en ? { text: st.name.en, approx: false } : null
  if (lang === 'en' || lang === 'id') return official ?? labels.get(st.name.zh) ?? null
  const mine = labels.get(st.name.zh)
  if (mine && !mine.approx) return mine
  if (mine && official) return { text: `${mine.text} · ${official.text}`, approx: true }
  return mine ?? official
}

const HAN_ONLY = /^[㐀-鿿豈-﫿]+$/

/**
 * 連鎖店名稱拿去翻譯前，把中文品牌名換成品牌的英文名（台北車站二樓星巴克 → 台北車站二樓 Starbucks），
 * 不然品牌會被照中文音唸成「싱바커」，外國人認不出來。
 */
export function poiNameForTranslation(name: string, brand: PoiBrand): string {
  if (!brand.en) return name
  const zhNames = [brand.zh, ...brand.aliases].filter((a) => a && HAN_ONLY.test(a)).sort((a, b) => b.length - a.length)
  for (const zh of zhNames) {
    if (name.includes(zh)) return name.replace(zh, ` ${brand.en} `).replace(/\s+/g, ' ').trim()
  }
  return name
}
