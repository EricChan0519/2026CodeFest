/**
 * 外語地點搜尋（韓、日、英、印尼、越、泰、高棉）：
 * 1. 搜尋字串不是中文 → 後端 POST /api/translate/query 換成中文（規則＋開放資料，不用 AI 模型）
 * 2. 用中文跑原本的搜尋（站牌、連鎖店、地標、OSM），比直接拿外文去比對準得多
 * 3. 結果的名稱用 POST /api/translate/names 換成使用者的語言；拆不出來的不翻，只給讀音，畫面同時留中文原名
 *    （路上的招牌、站牌都是中文，使用者要對得上）
 */
import { api } from '@/lib/api'
import type { ForeignLang, LocalizedName, Station } from '@/lib/contract'

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

/** 一個中文地名在使用者語言的寫法：主要那行（翻譯或讀音）＋是不是讀音 */
export interface NameLabel {
  text: string
  isReading: boolean
}

const cache = new Map<string, LocalizedName>()

/** 中文地名 → 使用者的語言；同一個名稱只問一次。失敗就回空的（畫面只顯示中文） */
export async function localizeNames(lang: ForeignLang, names: string[]): Promise<Map<string, NameLabel>> {
  const unique = [...new Set(names.filter(Boolean))]
  const missing = unique.filter((n) => !cache.has(`${lang}|${n}`))
  for (let i = 0; i < missing.length; i += 100) {
    try {
      const res = await api.translateNames(lang, missing.slice(i, i + 100))
      for (const item of res.names) cache.set(`${lang}|${item.zh}`, item)
    } catch {
      break
    }
  }
  const out = new Map<string, NameLabel>()
  for (const n of unique) {
    const item = cache.get(`${lang}|${n}`)
    if (item?.text) out.set(n, { text: item.text, isReading: false })
    else if (item?.reading) out.set(n, { text: item.reading, isReading: true })
  }
  return out
}

/**
 * 站牌的外語名稱：英文、印尼文直接用 TDX 的官方英文站名；其他語言用翻譯結果，
 * 翻不出來再退回官方英文站名（總比只有中文好）。
 */
export function stopLabel(st: Station, lang: ForeignLang, labels: Map<string, NameLabel>): NameLabel | null {
  const official = st.name.en ? { text: st.name.en, isReading: false } : null
  if (lang === 'en' || lang === 'id') return official ?? labels.get(st.name.zh) ?? null
  const mine = labels.get(st.name.zh)
  if (mine && !mine.isReading) return mine
  return official ?? mine ?? null
}
