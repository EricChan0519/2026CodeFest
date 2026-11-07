/**
 * 坐車畫面的文字：坐哪一班、在哪下車、還有幾站、快到時的提醒。
 * 站數由定位推算（nav/journey.ts 的 rideStatus），只是提醒；下車一定由使用者按「下車了」確認。
 */
import type { Audience, Lang } from '@/lib/contract'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import type { RideStatus } from '@/nav/journey'
import { buildArrival, type ArrivalTrip } from './arrival'

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')

export function buildRide(trip: ArrivalTrip, lang: Lang, audience: Audience, status: RideStatus) {
  const s = ARRIVAL_STRINGS[lang]
  const base = buildArrival(trip, lang, audience)
  const stop = trip.alight ? (lang === 'zh-TW' ? trip.alight.zh || trip.alight.en : trip.alight.en || trip.alight.zh) ?? '' : ''
  const cueText =
    status.cue === 'get_off' ? fill(s.getOffNow, { stop }) : status.cue === 'next_stop' ? fill(s.nextStop, { stop }) : null
  return {
    routeBig: base.routeBig,
    routeSub: base.routeSub,
    direction: base.direction,
    getOff: base.getOff,
    stopsLeft: fill(s.stopsLeft, { n: String(status.remaining) }),
    cueText,
    speechLang: base.speechLang,
    rate: base.rate,
    labels: { gotOff: s.gotOff, hearAgain: s.hearAgain },
  }
}
