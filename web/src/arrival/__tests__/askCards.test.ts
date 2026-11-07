import { describe, expect, it } from 'vitest'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import type { Lang } from '@/lib/contract'
import { askCards } from '../arrival'

const trip = {
  station: { zh: '臺北車站(忠孝)', en: 'Taipei Main Sta.' },
  route: { zh: '307', en: '307' },
  headsign: { zh: '往板橋', en: 'To Banqiao' },
  alight: { zh: '板橋車站', en: 'Banqiao Sta.' },
}
const place = { zh: '全家板橋車站店', en: null }

describe('askCards', () => {
  it('gives three cards, always in Chinese for the person being asked', () => {
    const cards = askCards(trip, 'vi', place)
    expect(cards.map((c) => c.id)).toEqual(['bus', 'remind', 'lost'])
    expect(cards[0].zh).toBe('我要搭 307 號公車，往板橋。請問是這班車嗎？')
    expect(cards[1].zh).toBe('到「板橋車站」請提醒我下車，謝謝')
    expect(cards[2].zh).toBe('我迷路了，請幫幫我。我要去「全家板橋車站店」')
  })

  it('shows the phone owner what each card says in their language', () => {
    const [, remind, lost] = askCards(trip, 'vi', place)
    expect(remind.tab).toBe(ARRIVAL_STRINGS.vi.tabRemind)
    expect(remind.own).toContain('Banqiao Sta.')
    expect(lost.own).toContain('全家板橋車站店')
    expect(askCards(trip, 'zh-TW', place)[1].own).toBeNull()
  })

  it('leaves out cards it has no information for', () => {
    const { alight: _alight, ...noAlight } = trip
    expect(askCards(noAlight, 'en').map((c) => c.id)).toEqual(['bus'])
    expect(askCards({ ...trip, route: { zh: '', en: null } }, 'en', place).map((c) => c.id)).toEqual(['remind', 'lost'])
  })

  it('has the new card texts in every language', () => {
    for (const lang of Object.keys(ARRIVAL_STRINGS) as Lang[]) {
      const s = ARRIVAL_STRINGS[lang]
      expect(s.askRemind).toContain('{stop}')
      expect(s.askLost).toContain('{place}')
      expect(s.tabBus && s.tabRemind && s.tabLost).toBeTruthy()
    }
  })
})
