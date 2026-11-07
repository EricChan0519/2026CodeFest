import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCoordinates, parseNominatim, searchPlaces } from '../geocode'

describe('parseCoordinates', () => {
  it('accepts lat, lon in Taiwan', () => {
    expect(parseCoordinates('25.1172, 121.5346')).toEqual([25.1172, 121.5346])
    expect(parseCoordinates(' 25.1172 121.5346 ')).toEqual([25.1172, 121.5346])
    expect(parseCoordinates('25.1172，121.5346')).toEqual([25.1172, 121.5346])
  })
  it('rejects swapped, out-of-range or non-coordinates', () => {
    expect(parseCoordinates('121.5346, 25.1172')).toBeNull()
    expect(parseCoordinates('48.85, 2.35')).toBeNull()
    expect(parseCoordinates('忠誠路二段')).toBeNull()
    expect(parseCoordinates('100號')).toBeNull()
  })
})

describe('parseNominatim', () => {
  it('splits name and detail, drops duplicates and bad rows', () => {
    const places = parseNominatim([
      { lat: '25.0477', lon: '121.5171', name: '臺北車站', display_name: '臺北車站, 3, 北平西路, 中正區, 臺北市, 臺灣' },
      { lat: '25.04771', lon: '121.51712', name: '臺北車站', display_name: '臺北車站, 3, 北平西路, 中正區, 臺北市, 臺灣' },
      { lat: 'x', lon: '1', display_name: '壞資料' },
      { lat: '25.1163', lon: '121.5341', display_name: '忠誠路二段, 三玉里, 士林區, 臺北市, 臺灣' },
    ])
    expect(places).toHaveLength(2)
    expect(places[0]).toMatchObject({ name: '臺北車站', point: [25.0477, 121.5171] })
    expect(places[0]!.detail).toContain('北平西路')
    expect(places[1]!.name).toBe('忠誠路二段')
  })
})

describe('searchPlaces', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns nothing for an empty query without calling the network', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await searchPlaces('   ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('coordinates skip the network', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await searchPlaces('25.1172, 121.5346')
    expect(r[0]!.point).toEqual([25.1172, 121.5346])
    expect(f).not.toHaveBeenCalled()
  })

  it('queries Nominatim restricted to Taiwan', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '25.1', lon: '121.5', display_name: '天母運動公園, 士林區' }],
    })
    vi.stubGlobal('fetch', f)
    const r = await searchPlaces('天母運動公園')
    const url = String(f.mock.calls[0]![0])
    expect(url).toContain('nominatim.openstreetmap.org/search')
    expect(url).toContain('countrycodes=tw')
    expect(url).toContain('bounded=1')
    expect(decodeURIComponent(url)).toContain('viewbox=121.40,25.22,121.70,24.95')
    expect(decodeURIComponent(url)).toContain('q=天母運動公園')
    expect(r[0]!.name).toBe('天母運動公園')
  })

  it('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(searchPlaces('x地')).rejects.toThrow('GEOCODE_HTTP_429')
  })

  it('asks for the standard MRT name first (芝山捷運站 → 捷運芝山站)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ lat: '25.1', lon: '121.5', display_name: '芝山, 士林區' }] })
    vi.stubGlobal('fetch', f)
    await searchPlaces('芝山捷運站')
    expect(decodeURIComponent(String(f.mock.calls[0]![0]))).toContain('q=捷運芝山站')
    expect(f).toHaveBeenCalledTimes(1)
  })
})
