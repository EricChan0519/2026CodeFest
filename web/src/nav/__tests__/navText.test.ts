import { describe, expect, it } from 'vitest'
import type { Station } from '@/lib/contract'
import type { BusPlan } from '@/lib/transferBus'
import type { NavView } from '../machine'
import { NAV_STRINGS } from '@/i18n/nav'
import { bigText, busPlanText, cueText, distanceLabel, placeDistance, sentence } from '../navText'

const view = (v: Partial<NavView>) => ({ state: 'navigating', failReason: null, headingLost: false, distanceM: 120, direction: null, nextTurn: null, ...v }) as NavView

describe('distanceLabel', () => {
  it('rounds and uses the unit of the chosen language', () => {
    expect(distanceLabel(123, 'zh-TW')).toBe('120 公尺')
    expect(distanceLabel(123, 'en')).toBe('120 m')
    expect(distanceLabel(42, 'vi')).toBe('40 m')
  })

  it('says "almost there" under 10 m', () => {
    expect(distanceLabel(6, 'id')).toBe(NAV_STRINGS.id.almostThere)
  })

  it('shows kilometres for places far away', () => {
    expect(placeDistance(6500, 'zh-TW')).toBe('6.5 公里')
    expect(placeDistance(6500, 'vi')).toBe('6.5 km')
    expect(placeDistance(6500, 'th')).toBe('6.5 กม.')
    expect(placeDistance(64, 'ko')).toBe('60 m')
  })
})

describe('cueText', () => {
  it('speaks the turn in the chosen language', () => {
    expect(cueText({ key: 'turn_ahead', turn: 'left', haptic: 'turn', interrupt: false, speak: true }, 'zh-TW')).toBe('前面路口左轉')
    expect(cueText({ key: 'turn_ahead', turn: 'left', haptic: 'turn', interrupt: false, speak: true }, 'en')).toBe('Turn left at the next corner')
    expect(cueText({ key: 'off_route', haptic: null, interrupt: true, speak: true }, 'vi')).toBe(NAV_STRINGS.vi.cueOffRoute)
  })
})

describe('bigText and sentence', () => {
  it('shows distance and direction while walking', () => {
    expect(bigText(view({ distanceM: 123 }), 'en')).toBe('120 m')
    expect(sentence(view({ direction: 'left' }), 'en', false)).toBe(NAV_STRINGS.en.dirLeft)
  })

  it('warns about the turn when it is close', () => {
    expect(sentence(view({ nextTurn: { kind: 'right', distanceM: 20, index: 1 } }), 'ja', false)).toBe(
      NAV_STRINGS.ja.turnAhead.replace('{turn}', NAV_STRINGS.ja.turnRight),
    )
  })

  it('explains failures and arrival', () => {
    expect(bigText(view({ state: 'failed', failReason: 'location_denied' }), 'th')).toBe(NAV_STRINGS.th.noPermission)
    expect(sentence(view({ state: 'arrived' }), 'id', true)).toBe(NAV_STRINGS.id.waitBusHere)
    expect(sentence(view({ state: 'arrived' }), 'id', false)).toBe(NAV_STRINGS.id.arrivedDest)
  })
})

describe('busPlanText', () => {
  const st = (zh: string, en: string): Station => ({ stationUid: zh, name: { zh, en }, bearing: null, lat: 25, lon: 121.5, routes: [] })
  const route = (zh: string) => ({ routeName: { zh, en: zh }, direction: 0, headsign: { zh: '往板橋', en: 'To Banqiao' }, stopUid: zh })
  const plan: BusPlan = {
    rides: [
      { mode: 'bus', board: st('特教學校', 'Special School'), route: route('606'), alight: st('小北街', 'Xiaobei St.'), stops: [st('a', 'a'), st('b', 'b'), st('c', 'c')] },
      { mode: 'bus', board: st('小北街', 'Xiaobei St.'), route: route('310'), alight: st('板橋車站', 'Banqiao Sta.'), stops: [st('d', 'd'), st('e', 'e')] },
    ],
    walkToBoardM: 12,
    transferWalkM: 0,
    walkFromAlightM: 210,
    stopCount: 3,
  }

  it('describes every leg with Chinese stop names and English for other languages', () => {
    expect(busPlanText(plan, 'zh-TW')).toEqual([
      '走 10 公尺到「特教學校」上車',
      '坐 2 站，在「小北街」下車',
      '走 10 公尺到「小北街」轉 310',
      '坐 1 站，在「板橋車站」下車',
      '再走 210 公尺',
    ])
    const en = busPlanText(plan, 'en')
    expect(en[0]).toBe('Walk 10 m to "Special School 特教學校" and board')
    expect(en[2]).toBe('Walk 10 m to "Xiaobei St. 小北街" and change to 310')
  })
})

describe('crossing the street first (develop 11/7, now in every language)', () => {
  const cue = (then: 'right' | null) => ({ key: 'turn_ahead' as const, turn: 'cross' as const, then, haptic: 'turn' as const, interrupt: false, speak: true })
  it('says cross, then turn', () => {
    expect(cueText(cue('right'), 'zh-TW')).toBe('過完馬路再右轉')
    expect(cueText(cue('right'), 'ko')).toBe('길을 건넌 뒤 우회전')
    expect(cueText(cue('right'), 'id')).toBe('Seberangi jalan, lalu belok kanan')
  })
  it('just crossing warns about cars', () => {
    expect(cueText(cue(null), 'zh-TW')).toBe('前面過馬路，注意來車')
    for (const lang of Object.keys(NAV_STRINGS) as (keyof typeof NAV_STRINGS)[]) expect(cueText(cue(null), lang)).toBe(NAV_STRINGS[lang].crossAhead)
  })
})
