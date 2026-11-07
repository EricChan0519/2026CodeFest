<script setup lang="ts">
/**
 * 導航除錯地圖（實驗頁用）：路線、目前位置與精度、箭頭指的點、最近的路線點、羅盤朝向、目的地。
 * 一眼看出「箭頭歪掉」是路線本身繞過去、GPS 偏了，還是羅盤錯了。
 * 點地圖會 emit('pick')：模擬 GPS 時可以直接把自己瞬移過去。
 * 圖資：國土測繪中心 EMAP（{z}/{y}/{x}），載入失敗改 OSM。禁止 Google Maps / Mapbox。
 */
import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LatLon } from '@/lib/contract'
import { fromLocalXY, rad } from '@/nav/geo'

const props = defineProps<{
  geometry: LatLon[] | null
  here: LatLon | null
  accuracyM: number | null
  target: LatLon | null
  nearest: LatLon | null
  /** 平滑後的真北朝向 */
  headingDeg: number | null
  destination: LatLon | null
}>()
const emit = defineEmits<{ pick: [p: LatLon] }>()

const el = ref<HTMLDivElement>()
let map: L.Map | null = null
let routeLayer: L.Polyline | null = null
let dynamic: L.LayerGroup | null = null
let follow = true
let lastGeometry: LatLon[] | null = null

const NLSC = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function drawRoute() {
  if (!map) return
  if (props.geometry === lastGeometry) return
  lastGeometry = props.geometry
  routeLayer?.remove()
  routeLayer = null
  if (props.geometry && props.geometry.length > 1) {
    routeLayer = L.polyline(props.geometry, { color: '#2563eb', weight: 6, opacity: 0.8 }).addTo(map)
  }
}

function drawDynamic() {
  if (!map || !dynamic) return
  dynamic.clearLayers()
  const { here, target, nearest, destination } = props
  if (destination) {
    L.circleMarker(destination, { radius: 9, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 })
      .bindTooltip('目的地')
      .addTo(dynamic)
  }
  if (nearest) {
    L.circleMarker(nearest, { radius: 5, color: '#2563eb', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(dynamic)
  }
  if (here) {
    if (props.accuracyM) {
      L.circle(here, { radius: props.accuracyM, color: '#fd853a', weight: 1, fillOpacity: 0.1 }).addTo(dynamic)
    }
    // 羅盤朝向：從自己往前 25 公尺的藍線
    if (props.headingDeg !== null) {
      const h = rad(props.headingDeg)
      const tip = fromLocalXY(here, [Math.sin(h) * 25, Math.cos(h) * 25])
      L.polyline([here, tip], { color: '#0ea5e9', weight: 3, dashArray: '4 4' }).addTo(dynamic)
    }
    // 箭頭指的方向：自己 → 目標點的橘線
    if (target) {
      L.polyline([here, target], { color: '#f97316', weight: 4 }).addTo(dynamic)
      L.circleMarker(target, { radius: 6, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1 }).addTo(dynamic)
    }
    L.circleMarker(here, { radius: 8, color: '#fff', weight: 3, fillColor: '#fd853a', fillOpacity: 1 }).addTo(dynamic)
    if (follow) map.panTo(here, { animate: false })
  }
}

onMounted(() => {
  const start = props.here ?? props.destination ?? [25.1172, 121.5345]
  map = L.map(el.value!, { zoomControl: true, attributionControl: true }).setView(start, 18)
  let errors = 0
  const nlsc = L.tileLayer(NLSC, {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>',
  }).addTo(map)
  nlsc.on('tileerror', () => {
    if (++errors === 5 && map) {
      map.removeLayer(nlsc)
      L.tileLayer(OSM, { maxZoom: 20, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    }
  })
  dynamic = L.layerGroup().addTo(map)
  // 使用者拖地圖後就不自動置中，按「置中」再恢復
  map.on('dragstart', () => (follow = false))
  map.on('click', (e: L.LeafletMouseEvent) => emit('pick', [e.latlng.lat, e.latlng.lng]))
  drawRoute()
  drawDynamic()
})

watch(() => props.geometry, drawRoute)
watch(
  () => [props.here, props.target, props.nearest, props.headingDeg, props.accuracyM, props.destination],
  drawDynamic,
)

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

function recenter() {
  follow = true
  if (props.here) map?.panTo(props.here)
}
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="el" class="h-full w-full" />
    <button
      class="absolute bottom-2 right-2 z-[1000] rounded bg-white px-2 py-1 text-xs text-[#30383D] shadow"
      @click="recenter"
    >
      置中
    </button>
  </div>
</template>
