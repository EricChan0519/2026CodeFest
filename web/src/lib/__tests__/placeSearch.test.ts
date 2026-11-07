import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/contract'
import { fromLandmark, fromOsm, mergePlaces, osmMatches, relevance } from '../placeSearch'

const TIANMU: LatLon = [25.115, 121.536]
const TAIPEI_STATION: LatLon = [25.0478, 121.517]

const gym = fromLandmark({ name: '天母體育館', lat: 25.115164, lon: 121.534019, address: null, category: '運動場館', distanceM: 200 })
const xinyi = fromLandmark({ name: '信義體育館', lat: 25.033, lon: 121.565, address: '松勤街100號', category: '運動場館', distanceM: 9500 })
const osmGym = fromOsm({ name: '臺北市立大學天母體育館', detail: '忠誠路二段', point: [25.1153, 121.5342] })
const osmFar = fromOsm({ name: '臺北體育館', detail: '南京東路', point: [25.0514, 121.5517] })

describe('mergePlaces', () => {
  it('sorts everything by distance from the user, whichever source it came from', () => {
    // Nominatim 原本的順序是 臺北體育館 在前；要改成越近越前面
    const out = mergePlaces('體育館', [[xinyi], [osmFar, gym]], TIANMU)
    expect(out.map((p) => p.name)).toEqual(['天母體育館', '臺北體育館', '信義體育館'])
    const d = out.map((p) => p.distanceM!)
    expect(d).toEqual([...d].sort((a, b) => a - b))
  })

  it('re-sorts when the user is somewhere else', () => {
    const out = mergePlaces('體育館', [[gym, xinyi], [osmFar]], TAIPEI_STATION)
    expect(out.map((p) => p.name)).toEqual(['臺北體育館', '信義體育館', '天母體育館'])
  })

  it('recomputes the distance from the given point', () => {
    const [p] = mergePlaces('天母體育館', [[gym]], TAIPEI_STATION)
    expect(p!.distanceM).toBeGreaterThan(7000)
  })

  it('keeps one entry when both sources have the same place', () => {
    const out = mergePlaces('天母體育館', [[gym], [osmGym]], TIANMU)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: '天母體育館', source: 'overture', category: '運動場館' })
  })

  it('does not merge same-name places that are far apart', () => {
    const a = fromOsm({ name: '天母豆漿', detail: '', point: [25.1121, 121.5375] })
    const b = fromOsm({ name: '天母豆漿', detail: '', point: [25.05, 121.52] })
    expect(mergePlaces('天母豆漿', [[a, b]], TIANMU)).toHaveLength(2)
  })

  it('puts an exact name match first even when it is farther', () => {
    const hall = fromLandmark({ name: '中正紀念堂', lat: 25.035, lon: 121.521, address: null, category: '博物館', distanceM: null })
    const shop = fromLandmark({ name: '中正紀念堂 春水堂', lat: 25.114, lon: 121.537, address: null, category: '餐廳', distanceM: null })
    expect(mergePlaces('中正紀念堂', [[shop, hall]], TIANMU).map((p) => p.name)).toEqual(['中正紀念堂', '中正紀念堂 春水堂'])
  })

  it('a generic short word like 體育館 stays sorted by distance', () => {
    // 實測：OSM 有好幾個名稱就叫「體育館」的地點在 10 公里外，不可以排在 400 公尺的天母體育館前面
    const generic = fromOsm({ name: '體育館', detail: '南港區', point: [25.055, 121.607] })
    const out = mergePlaces('體育館', [[gym], [generic]], TIANMU)
    expect(out.map((p) => p.name)).toEqual(['天母體育館', '體育館'])
  })

  it('keeps the original order when there is no reference point', () => {
    const out = mergePlaces('體育館', [[xinyi, gym]], null)
    expect(out.map((p) => p.name)).toEqual(['信義體育館', '天母體育館'])
    expect(out[0]!.distanceM).toBeNull()
  })

  it('shows category and address in the detail line', () => {
    expect(xinyi.detail).toBe('運動場館・松勤街100號')
    expect(gym.detail).toBe('運動場館')
  })
})

describe('osmMatches', () => {
  const place = (name: string) => ({ name, detail: '', point: [25.1, 121.5] as [number, number] })
  it('drops other MRT stations Nominatim returns for 芝山捷運站 (2026-11-07)', () => {
    expect(osmMatches('芝山捷運站', place('捷運圓山站'))).toBe(false)
    expect(osmMatches('芝山捷運站', place('捷運大直站'))).toBe(false)
    expect(osmMatches('芝山捷運站', place('芝山'))).toBe(true)
    expect(osmMatches('芝山捷運站', place('捷運芝山站'))).toBe(true)
  })
  it('does not filter road or address searches', () => {
    expect(osmMatches('忠孝西路一段', place('忠孝西路一段'))).toBe(true)
    expect(osmMatches('天母體育館', place('天母體育館'))).toBe(true)
  })
})

describe('relevance ranking (2026-11-07: 士林站 showed an eyelash salon first)', () => {
  const hit = (name: string, km: number, category: string | null = null) => ({
    name,
    detail: '',
    point: [25.0478 + km / 111, 121.517] as [number, number],
    distanceM: null,
    category,
    address: null,
    source: 'overture' as const,
  })
  it('the station itself comes before names that only mention it, even if they are closer', () => {
    const out = mergePlaces(
      '士林站',
      [[hit('璞美學-接睫毛/民權西路站/中山站/雙連站/劍潭站/士林站/大橋頭站', 1.7, '生活服務'), hit('大都會士林站', 5.2, '公車站'), hit('捷運士林站', 5.2, '車站')], [hit('公車士林站', 5.4)]],
      [25.0478, 121.517],
    )
    expect(out.map((p) => p.name)).toEqual(['捷運士林站', '公車士林站', '大都會士林站', '璞美學-接睫毛/民權西路站/中山站/雙連站/劍潭站/士林站/大橋頭站'])
  })
  it('a direction after a dash is still the station itself', () => {
    expect(relevance('士林站', { name: '捷運士林站 - 中正', category: '公車站' })).toBe(1)
  })
  it('generic words are still sorted by distance only', () => {
    expect(relevance('公園', { name: '公園', category: null })).toBe(0)
    expect(relevance('公園', { name: '大安森林公園', category: null })).toBe(0)
  })
})

describe('far away results (2026-11-07: 중산역 showed 中山站 in Taichung and Kaohsiung first)', () => {
  it('a same-name place outside Greater Taipei goes to the bottom', () => {
    const at = (name: string, lat: number, lon: number) => ({ name, detail: '', point: [lat, lon] as [number, number], distanceM: null, category: null, address: null, source: 'osm' as const })
    const out = mergePlaces('中山站', [[at('中山站', 24.1477, 120.6736), at('中山站', 22.62, 120.27), at('捷運中山站', 25.0525, 121.5203)]], [25.0478, 121.517])
    expect(out[0]!.name).toBe('捷運中山站')
  })
})
