/**
 * 在城市通裡用 App 的 speak Handler，在一般瀏覽器用 Web Speech（開發和實驗用）。
 * 兩邊都沒有語音時靜默，畫面文字仍可讀。
 */
import { isInTownPass, send } from '@/lib/townpass-bridge'

export function speakText(text: string, lang: string, rate: 'slow' | 'normal'): void {
  if (isInTownPass()) {
    send('speak', { text, lang, rate, interrupt: true })
    return
  }
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate === 'slow' ? 0.7 : 1
  speechSynthesis.speak(utterance)
}
