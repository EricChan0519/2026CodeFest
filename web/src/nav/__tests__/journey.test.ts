import { describe, expect, it } from 'vitest'
import type { LatLon, Station } from '@/lib/contract'
import { boarded, currentRide, gotOff, legArrived, rideStatus, rideStatusByTime, startJourney, walkTarget, type Ride } from '../journey'

// 沿經線排的站位，緯度每 0.001 度約 111 公尺
const st = (uid: string, lat: number): Station => ({
  stationUid: uid,
  name: { zh: `站${uid}`, en: null },
  bearing: null,
  lat,
  lon: 121.5,
  routes: [],
})
const route = (zh: string) => ({ routeName: { zh, en: zh }, direction: 0, headsign: { zh: '往板橋', en: null }, stopUid: 'x' })
const ride = (zh: string, stops: Station[]): Ride => ({
  mode: 'bus',
  board: stops[0],
  alight: stops[stops.length - 1],
  route: route(zh),
  stops,
})
const final = { name: '全家板橋車站店', point: [25.05, 121.5] as LatLon }
const S = [st('A', 25.0), st('B', 25.01), st('C', 25.02), st('D', 25.03)]

describe('journey', () => {
  it('walks to the stop, waits, rides, gets off, then walks to the destination', () => {
    let j = startJourney([ride('307', S)], final)
    expect(j.phase).toBe('walk_to_stop')
    expect(walkTarget(j)).toMatchObject({ name: '站A', station: S[0], alight: S[3] })

    j = legArrived(j)
    expect(j.phase).toBe('at_stop')
    j = boarded(j)
    expect(j.phase).toBe('ride')
    expect(currentRide(j)?.route.routeName.zh).toBe('307')

    j = gotOff(j)
    expect(j.phase).toBe('walk_to_dest')
    expect(walkTarget(j)).toEqual({ name: '全家板橋車站店', points: [final.point] })

    j = legArrived(j)
    expect(j.phase).toBe('arrived')
    expect(walkTarget(j)).toBeNull()
  })

  it('walks to the next boarding stop after the first ride when there is a transfer', () => {
    const second = [st('E', 25.031), st('F', 25.04)]
    let j = startJourney([ride('307', S), ride('紅3', second)], final)
    j = gotOff(boarded(legArrived(j)))
    expect(j.phase).toBe('walk_to_stop')
    expect(j.rideIndex).toBe(1)
    expect(walkTarget(j)?.station?.stationUid).toBe('E')
    j = gotOff(boarded(legArrived(j)))
    expect(j.phase).toBe('walk_to_dest')
  })

  it('without a bus it is just one walk to the destination', () => {
    const j = startJourney([], final)
    expect(j.phase).toBe('walk_to_dest')
    expect(legArrived(j).phase).toBe('arrived')
  })

  it('ignores events that do not fit the current phase', () => {
    const j = startJourney([ride('307', S)], final)
    expect(boarded(j)).toBe(j)
    expect(gotOff(j)).toBe(j)
  })
})

describe('rideStatus', () => {
  it('counts the stops left and warns one stop before getting off', () => {
    expect(rideStatus(S, [25.0, 121.5], 0)).toEqual({ index: 0, remaining: 3, cue: 'none' })
    expect(rideStatus(S, [25.0101, 121.5], 0)).toEqual({ index: 1, remaining: 2, cue: 'none' })
    expect(rideStatus(S, [25.02, 121.5], 1)).toEqual({ index: 2, remaining: 1, cue: 'next_stop' })
    expect(rideStatus(S, [25.0298, 121.5], 2)).toEqual({ index: 3, remaining: 0, cue: 'get_off' })
  })

  it('never goes backwards when GPS jumps toward an earlier stop', () => {
    expect(rideStatus(S, [25.0, 121.5], 2).index).toBe(2)
  })
})

describe('metro journey', () => {
  const M = [st('metro:BL11', 25.0), st('metro:BL12', 25.01)]
  const N = [st('metro:R10', 25.01), st('metro:R11', 25.02)]
  const metroRide = (zh: string, stops: Station[], extra: Partial<Ride> = {}): Ride => ({
    ...ride(zh, stops),
    mode: 'metro',
    stopTimesS: stops.map((_, i) => i * 120),
    ...extra,
  })

  it('walks to the station exit instead of the station centre', () => {
    const j = startJourney([metroRide('板南線', M, { boardPoint: [25.0004, 121.4992], boardExit: '6' })], final)
    expect(walkTarget(j)?.points).toEqual([[25.0004, 121.4992]])
    expect(walkTarget(j)?.station?.stationUid).toBe('metro:BL11')
  })

  it('changes metro lines inside the station without a walking leg', () => {
    let j = startJourney([metroRide('板南線', M), metroRide('淡水信義線', N)], final)
    j = gotOff(boarded(legArrived(j)))
    expect(j.phase).toBe('at_stop')
    expect(j.rideIndex).toBe(1)
    expect(walkTarget(j)).toBeNull()
  })

  it('still walks between a metro ride and a bus ride', () => {
    let j = startJourney([metroRide('板南線', M), ride('307', S)], final)
    j = gotOff(boarded(legArrived(j)))
    expect(j.phase).toBe('walk_to_stop')
  })
})

describe('rideStatusByTime', () => {
  const times = [0, 120, 230, 350]

  it('counts stations from the time since boarding', () => {
    expect(rideStatusByTime(times, 0)).toEqual({ index: 0, remaining: 3, cue: 'none' })
    expect(rideStatusByTime(times, 125)).toEqual({ index: 1, remaining: 2, cue: 'none' })
  })

  it('warns after leaving the second-to-last station and asks to get off on arrival', () => {
    expect(rideStatusByTime(times, 240)).toEqual({ index: 2, remaining: 1, cue: 'next_stop' })
    expect(rideStatusByTime(times, 350)).toEqual({ index: 3, remaining: 0, cue: 'get_off' })
    expect(rideStatusByTime(times, 9999)).toEqual({ index: 3, remaining: 0, cue: 'get_off' })
  })

  it('never goes backwards', () => {
    expect(rideStatusByTime(times, 10, 2).index).toBe(2)
  })
})
