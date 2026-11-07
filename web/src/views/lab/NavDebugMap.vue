<script setup lang="ts">
/**
 * 導航除錯地圖（實驗頁、除錯工具用）：路線、目前位置與精度、箭頭指的點、最近的路線點、羅盤朝向、目的地。
 * 一眼看出「箭頭歪掉」是路線本身繞過去、GPS 偏了，還是羅盤錯了。
 * 點地圖會 emit('pick')：模擬 GPS 時可以直接把自己瞬移過去。
 * 圖資：國土測繪中心 EMAP（{z}/{y}/{x}），載入失敗改 OSM。禁止 Google Maps / Mapbox。
 *
 * 順暢：圖層只建一次，之後只改座標；位置、朝向每一幀（requestAnimationFrame）平滑補間過去，
 * 不會因為 GPS 一秒只來 1–2 筆就一格一格跳。live 是模擬 GPS 的即時位置（100 ms 一筆），有就用它。
 *
 * rotate：前方朝上（地圖跟著羅盤轉）。Leaflet 不支援旋轉（leaflet-rotate 是 GPL，不能用），
 * 做法是把地圖放在一個「對角線大小」的方塊裡用 CSS 轉，外框裁掉多出來的角。
 * 轉了以後 Leaflet 自己算的點擊座標會錯，所以拖曳／手勢縮放關掉、點擊自己換算；縮放鈕和圖資來源放在旋轉層外面。
 */
import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LatLon } from '@/lib/contract'
import { fromLocalXY, rad } from '@/nav/geo'

const props = withDefaults(
  defineProps<{
    geometry: LatLon[] | null
    here: LatLon | null
    accuracyM: number | null
    target: LatLon | null
    nearest: LatLon | null
    /** 平滑後的真北朝向 */
    headingDeg: number | null
    destination: LatLon | null
    /** 模擬 GPS 的即時位置（比 here 更新得勤） */
    live?: LatLon | null
    /** 前方朝上：地圖跟著朝向轉 */
    rotate?: boolean
  }>(),
  { live: null, rotate: false },
)
const emit = defineEmits<{ pick: [p: LatLon] }>()

const frame = ref<HTMLDivElement>()
const rotor = ref<HTMLDivElement>()
const el = ref<HTMLDivElement>()
const attribution = ref('&copy; 內政部國土測繪中心')
let map: L.Map | null = null
let routeLayer: L.Polyline | null = null
let follow = true
let lastGeometry: LatLon[] | null = null

const NLSC = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

// ── 圖層：只建一次，沒有資料時藏起來 ────────────────
const HIDE = { opacity: 0, fillOpacity: 0 }
const STYLE = {
  dest: { radius: 9, color: '#fff', weight: 2, fillColor: '#16a34a', opacity: 1, fillOpacity: 1 },
  nearest: { radius: 5, color: '#2563eb', weight: 2, fillColor: '#fff', opacity: 1, fillOpacity: 1 },
  acc: { color: '#fd853a', weight: 1, opacity: 1, fillOpacity: 0.1 },
  heading: { color: '#0ea5e9', weight: 3, dashArray: '4 4', opacity: 1 },
  targetLine: { color: '#f97316', weight: 4, opacity: 1 },
  targetDot: { radius: 6, color: '#fff', weight: 2, fillColor: '#f97316', opacity: 1, fillOpacity: 1 },
  here: { radius: 8, color: '#fff', weight: 3, fillColor: '#fd853a', opacity: 1, fillOpacity: 1 },
}
const ORIGIN: L.LatLngTuple = [0, 0]
let layers: {
  dest: L.CircleMarker
  nearest: L.CircleMarker
  acc: L.Circle
  heading: L.Polyline
  targetLine: L.Polyline
  targetDot: L.CircleMarker
  here: L.CircleMarker
} | null = null

/** 顯示／隱藏：狀態沒變就不動 SVG（每一幀都會呼叫） */
const visible = new WeakMap<L.Path, boolean>()
function show(layer: L.Path, on: boolean, style: L.PathOptions) {
  if (visible.get(layer) === on) return
  visible.set(layer, on)
  layer.setStyle(on ? style : HIDE)
}

function drawRoute() {
  if (!map) return
  if (props.geometry === lastGeometry) return
  lastGeometry = props.geometry
  routeLayer?.remove()
  routeLayer = null
  if (props.geometry && props.geometry.length > 1) {
    routeLayer = L.polyline(props.geometry, { color: '#2563eb', weight: 6, opacity: 0.8 }).addTo(map)
    routeLayer.bringToBack()
  }
}

/** 不常變的：目的地、最近的路線點、箭頭指的點 */
function drawStatic() {
  if (!layers) return
  const { destination, nearest, target } = props
  if (destination) layers.dest.setLatLng(destination)
  show(layers.dest, !!destination, STYLE.dest)
  if (nearest) layers.nearest.setLatLng(nearest)
  show(layers.nearest, !!nearest, STYLE.nearest)
  if (target) layers.targetDot.setLatLng(target)
  show(layers.targetDot, !!target, STYLE.targetDot)
  dirty = true
}

// ── 每一幀的補間 ───────────────────────────────
/** 位置、朝向追上最新值的時間常數（毫秒）；跳太遠（瞬移、重新定位）直接到位 */
const POS_TAU_MS = 120
const HEAD_TAU_MS = 90
const SNAP_M = 60
let goal: LatLon | null = null
let shown: LatLon | null = null
let goalHead: number | null = null
let shownHead = 0
let dirty = true
let raf = 0
let lastT = 0

// here 和 live 誰「值」變了就追誰。只比參考不行：朝向事件也會產生新的 view，
// 裡面的 here 是新陣列但還是 500 ms 前的舊位置，會把地圖拉回去、往回抖
const sameLL = (a: LatLon | null, b: LatLon | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1]
watch(
  () => props.here,
  (p, old) => p && !sameLL(p, old ?? null) && (goal = p),
)
watch(
  () => props.live,
  (p, old) => p && !sameLL(p, old ?? null) && (goal = p),
)
watch(
  () => props.headingDeg,
  (h) => (goalHead = h),
)

const metersBetween = (a: LatLon, b: LatLon) => {
  const dy = (a[0] - b[0]) * 111320
  const dx = (a[1] - b[1]) * 111320 * Math.cos(rad(a[0]))
  return Math.hypot(dx, dy)
}

function loop(t: number) {
  raf = requestAnimationFrame(loop)
  const dt = lastT ? Math.min(t - lastT, 100) : 16
  lastT = t
  if (!map || !layers) return

  let moved = false
  if (goal) {
    if (!shown || metersBetween(shown, goal) > SNAP_M) {
      shown = goal
      moved = true
    } else if (shown[0] !== goal[0] || shown[1] !== goal[1]) {
      const a = 1 - Math.exp(-dt / POS_TAU_MS)
      shown = [shown[0] + (goal[0] - shown[0]) * a, shown[1] + (goal[1] - shown[1]) * a]
      if (metersBetween(shown, goal) < 0.02) shown = goal
      moved = true
    }
  }
  let turned = false
  if (goalHead !== null) {
    const diff = ((goalHead - shownHead + 540) % 360) - 180 // 走最短的那一邊
    if (Math.abs(diff) > 0.05) {
      shownHead = (shownHead + diff * (1 - Math.exp(-dt / HEAD_TAU_MS)) + 360) % 360
      turned = true
    }
  }
  if (!moved && !turned && !dirty) return
  dirty = false

  const target = props.target
  if (shown) {
    layers.here.setLatLng(shown)
    layers.acc.setLatLng(shown)
    if (props.accuracyM) layers.acc.setRadius(props.accuracyM)
    show(layers.acc, !!props.accuracyM, STYLE.acc)
    show(layers.here, true, STYLE.here)
    if (target) layers.targetLine.setLatLngs([shown, target])
    show(layers.targetLine, !!target, STYLE.targetLine)
    if (goalHead !== null) {
      const h = rad(shownHead)
      layers.heading.setLatLngs([shown, fromLocalXY(shown, [Math.sin(h) * 25, Math.cos(h) * 25])])
    }
    show(layers.heading, goalHead !== null, STYLE.heading)
    if (follow || props.rotate) centerOn(shown)
  }
  if (props.rotate && rotor.value) rotor.value.style.transform = `translate(-50%, -50%) rotate(${-shownHead}deg)`
}

/** 用 panBy 跟著走：比 setView 便宜很多（setView 會整個重設視圖） */
function centerOn(p: LatLon) {
  if (!map) return
  const size = map.getSize()
  const pt = map.latLngToContainerPoint(p)
  const dx = pt.x - size.x / 2
  const dy = pt.y - size.y / 2
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) map.panBy([dx, dy], { animate: false })
}

// ── 旋轉模式：方塊大小、點擊換算 ────────────────────
let resizeObs: ResizeObserver | null = null
function fitRotor() {
  if (!frame.value || !rotor.value) return
  const { width, height } = frame.value.getBoundingClientRect()
  const d = Math.ceil(props.rotate ? Math.hypot(width, height) : 0)
  rotor.value.style.width = props.rotate ? `${d}px` : '100%'
  rotor.value.style.height = props.rotate ? `${d}px` : '100%'
  map?.invalidateSize({ pan: false })
  dirty = true
}

/** 螢幕上的點 → 地圖座標：把旋轉轉回去，再交給 Leaflet */
function onRotatedClick(e: MouseEvent) {
  if (!props.rotate || !map || !frame.value) return
  const r = frame.value.getBoundingClientRect()
  const sx = e.clientX - (r.left + r.width / 2)
  const sy = e.clientY - (r.top + r.height / 2)
  const h = rad(shownHead)
  const px = sx * Math.cos(h) - sy * Math.sin(h)
  const py = sx * Math.sin(h) + sy * Math.cos(h)
  const size = map.getSize()
  const ll = map.containerPointToLatLng([size.x / 2 + px, size.y / 2 + py])
  emit('pick', [ll.lat, ll.lng])
}

function zoom(by: number) {
  map?.setZoom(map.getZoom() + by, { animate: false })
  dirty = true
}

onMounted(() => {
  const start = props.live ?? props.here ?? props.destination ?? [25.1172, 121.5345]
  goal = props.live ?? props.here
  goalHead = props.headingDeg
  shownHead = goalHead ?? 0
  const interactive = !props.rotate
  map = L.map(el.value!, {
    zoomControl: interactive,
    attributionControl: interactive,
    dragging: interactive,
    touchZoom: interactive,
    doubleClickZoom: interactive,
    scrollWheelZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
    fadeAnimation: false,
  }).setView(start, 18)
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
      attribution.value = '&copy; OpenStreetMap contributors'
    }
  })
  // 圖層順序固定：加入的順序就是上下層
  layers = {
    dest: L.circleMarker(ORIGIN, { ...STYLE.dest, ...HIDE }).bindTooltip('目的地').addTo(map),
    nearest: L.circleMarker(ORIGIN, { ...STYLE.nearest, ...HIDE }).addTo(map),
    acc: L.circle(ORIGIN, { ...STYLE.acc, radius: 1, ...HIDE }).addTo(map),
    heading: L.polyline([ORIGIN, ORIGIN], { ...STYLE.heading, ...HIDE }).addTo(map),
    targetLine: L.polyline([ORIGIN, ORIGIN], { ...STYLE.targetLine, ...HIDE }).addTo(map),
    targetDot: L.circleMarker(ORIGIN, { ...STYLE.targetDot, ...HIDE }).addTo(map),
    here: L.circleMarker(ORIGIN, { ...STYLE.here, ...HIDE }).addTo(map),
  }
  // 使用者拖地圖後就不自動置中，按「置中」再恢復
  map.on('dragstart', () => (follow = false))
  if (interactive) map.on('click', (e: L.LeafletMouseEvent) => emit('pick', [e.latlng.lat, e.latlng.lng]))
  drawRoute()
  drawStatic()
  if (props.rotate) {
    resizeObs = new ResizeObserver(fitRotor)
    resizeObs.observe(frame.value!)
    fitRotor()
  }
  raf = requestAnimationFrame(loop)
})

watch(() => props.geometry, drawRoute)
watch(() => [props.target, props.nearest, props.destination, props.accuracyM], drawStatic)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resizeObs?.disconnect()
  map?.remove()
  map = null
  layers = null
})

function recenter() {
  follow = true
  dirty = true
}
</script>

<template>
  <div ref="frame" class="relative h-full w-full overflow-hidden" @click="onRotatedClick">
    <div ref="rotor" class="ndm-rotor" :class="{ 'is-rotate': rotate }">
      <div ref="el" class="h-full w-full" />
    </div>
    <template v-if="rotate">
      <div class="ndm-zoom" @click.stop>
        <button type="button" aria-label="放大地圖" @click="zoom(1)">+</button>
        <button type="button" aria-label="縮小地圖" @click="zoom(-1)">−</button>
      </div>
      <p class="ndm-attr" v-html="attribution" />
    </template>
    <button
      v-else
      class="absolute bottom-2 right-2 z-[1000] rounded bg-white px-2 py-1 text-xs text-[#30383D] shadow"
      @click="recenter"
    >
      置中
    </button>
  </div>
</template>

<style scoped>
.ndm-rotor {
  width: 100%;
  height: 100%;
}
.ndm-rotor.is-rotate {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  will-change: transform;
}
.ndm-zoom {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ndm-zoom button {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.92);
  color: #30383d;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
  cursor: pointer;
}
.ndm-attr {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 1000;
  padding: 1px 6px;
  border-top-left-radius: 6px;
  background: rgb(255 255 255 / 0.8);
  color: #30383d;
  font-size: 9px;
  line-height: 1.4;
  pointer-events: none;
}
</style>
