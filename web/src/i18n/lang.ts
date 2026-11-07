/**
 * 使用者的語言：一開始先選，記在這支手機上；網址 ?lang= 優先（城市通或 Demo 直接指定）。
 * 只存語言代碼，不存其他個資。
 */
import type { Lang } from '@/lib/contract'

/** 選語言畫面的順序：中文、英文，接著是在臺移工人數較多的語言，最後日韓觀光客 */
export const LANG_CHOICES: { lang: Lang; name: string }[] = [
  { lang: 'zh-TW', name: '中文' },
  { lang: 'en', name: 'English' },
  { lang: 'id', name: 'Bahasa Indonesia' },
  { lang: 'vi', name: 'Tiếng Việt' },
  { lang: 'th', name: 'ไทย' },
  { lang: 'km', name: 'ខ្មែរ' },
  { lang: 'ja', name: '日本語' },
  { lang: 'ko', name: '한국어' },
]

const KNOWN = new Set<string>(LANG_CHOICES.map((c) => c.lang))
const isLang = (v: unknown): v is Lang => typeof v === 'string' && KNOWN.has(v)

/** 網址的語言 > 記住的語言；都沒有回傳 null，畫面要先請使用者選 */
export function resolveLang(fromUrl: unknown, stored: unknown): Lang | null {
  if (isLang(fromUrl)) return fromUrl
  if (isLang(stored)) return stored
  return null
}

const KEY = 'arrow-nav.lang'

export function loadStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    return isLang(v) ? v : null
  } catch {
    return null
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // 無痕模式等存不進去：這次照用，下次再選一次
  }
}
