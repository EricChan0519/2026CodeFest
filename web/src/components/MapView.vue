<script setup lang="ts">
/**
 * Leaflet + 國土測繪中心 EMAP（禁止 Google Maps / Mapbox）。
 * 圖磚路徑是 {z}/{y}/{x}（y 在前）。載入失敗自動切 OSM。
 * 標記用 circleMarker / divIcon，避開 Vite 打包後預設 marker 圖示 404。
 */
import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface MapPoint {
  id: string | number
  lat: number
  lng: number
  label?: string
  color?: string
}

const props = withDefaults(
  defineProps<{
    points?: MapPoint[]
    center?: [number, number]
    zoom?: number
    me?: { lat: number; lng: number } | null
  }>(),
  { points: () => [], center: () => [25.0375, 121.5637], zoom: 15, me: null },
)
const emit = defineEmits<{ select: [point: MapPoint] }>()

const el = ref<HTMLDivElement>()
let map: L.Map | null = null
let layer: L.LayerGroup | null = null
let meMarker: L.CircleMarker | null = null

const NLSC = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function render() {
  if (!map || !layer) return
  layer.clearLayers()
  for (const p of props.points) {
    L.circleMarker([p.lat, p.lng], {
      radius: 9,
      color: '#fff',
      weight: 2,
      fillColor: p.color ?? '#5ab4c5',
      fillOpacity: 1,
    })
      .on('click', () => emit('select', p))
      .bindTooltip(p.label ?? '', { direction: 'top' })
      .addTo(layer)
  }
}

function renderMe() {
  if (!map) return
  meMarker?.remove()
  meMarker = null
  if (props.me) {
    meMarker = L.circleMarker([props.me.lat, props.me.lng], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#fd853a', fillOpacity: 1,
    }).addTo(map)
  }
}

onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: true }).setView(props.center, props.zoom)
  let errors = 0
  const nlsc = L.tileLayer(NLSC, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>',
  }).addTo(map)
  nlsc.on('tileerror', () => {
    if (++errors === 5 && map) {
      map.removeLayer(nlsc)
      L.tileLayer(OSM, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    }
  })
  layer = L.layerGroup().addTo(map)
  render()
  renderMe()
})

watch(() => props.points, render)
watch(() => props.me, renderMe)
watch(() => props.center, (c) => map?.setView(c))

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

/** 容器從隱藏變顯示後要呼叫 */
defineExpose({ invalidate: () => map?.invalidateSize(), flyTo: (lat: number, lng: number, z = 16) => map?.flyTo([lat, lng], z) })
</script>

<template>
  <div ref="el" class="h-full w-full" />
</template>
