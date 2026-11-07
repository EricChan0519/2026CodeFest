/**
 * 臺北捷運路線的官方名稱（2026-11-08 回報：淡水信義線等路線名要用官方翻譯）。
 * metro_index.json 只有中文和官方英文（Tamsui-Xinyi Line）；韓文、日文用臺北捷運公司的韓文、日文名稱。
 * 印尼、越南、泰、高棉文臺北捷運用的是英文線名，所以照用英文。後端 api/data/place_glossary.json 是同一份。
 */
import type { Lang } from '@/lib/contract'

const OFFICIAL: Record<string, { ko: string; ja: string }> = {
  淡水信義線: { ko: '단수이신이선', ja: '淡水信義線' },
  松山新店線: { ko: '쑹산신뎬선', ja: '松山新店線' },
  中和新蘆線: { ko: '중허신루선', ja: '中和新蘆線' },
  板南線: { ko: '반난선', ja: '板南線' },
  文湖線: { ko: '원후선', ja: '文湖線' },
  環狀線: { ko: '환상선', ja: '環状線' },
  新北投支線: { ko: '신베이터우지선', ja: '新北投支線' },
  小碧潭支線: { ko: '샤오비탄지선', ja: '小碧潭支線' },
}

/** 捷運路線名：韓文、日文用官方名稱；不是捷運路線（公車）回 null，照原本的規則 */
export function metroLineName(zh: string | null | undefined, lang: Lang): string | null {
  if (!zh) return null
  const o = OFFICIAL[zh.replace('台', '臺')]
  if (!o) return null
  if (lang === 'ko') return o.ko
  if (lang === 'ja') return o.ja
  return null
}
