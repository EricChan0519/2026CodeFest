<script setup lang="ts">
/**
 * 隱藏的除錯工具：長按右上角（看不見的按鈕）0.7 秒，或網址加 ?debug=1。
 * 和實驗頁（/lab/nav）同一套工具：除錯地圖（點地圖瞬移）、模擬 GPS 搖桿、速度、重算失敗、手動朝向、重新定位、軌跡。
 * 地圖與搖桿只在打開時載入（Leaflet 不進主畫面的 bundle）。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import type { Trip } from '@/trip/useTrip'
import type { DestinationSearch } from '@/trip/useDestinationSearch'

const Joystick = defineAsyncComponent(() => import('../lab/Joystick.vue'))
const NavDebugMap = defineAsyncComponent(() => import('../lab/NavDebugMap.vue'))

const props = defineProps<{ trip: Trip; search: DestinationSearch; canDemo: boolean }>()
const emit = defineEmits<{ close: []; demo: []; timeChange: [] }>()

const latitude = ref(String(props.search.debugOrigin.value?.[0] ?? 25.116056))
const longitude = ref(String(props.search.debugOrigin.value?.[1] ?? 121.535444))
const gpsError = ref('')
function setOrigin() {
  const lat = Number(latitude.value)
  const lon = Number(longitude.value)
  if (!latitude.value.trim() || !longitude.value.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    gpsError.value = '請輸入有效的緯度與經度'
    return
  }
  gpsError.value = ''
  props.search.debugOrigin.value = [lat, lon]
  emit('timeChange')
}
function clearOrigin() {
  props.search.debugOrigin.value = null
  gpsError.value = ''
  emit('timeChange')
}

function setTransitTime(value: string) {
  const date = value ? new Date(value) : null
  if (date && Number.isNaN(date.getTime())) return
  props.search.debugTransitTime.value = date
  emit('timeChange')
}

const transitTimeValue = computed(() => {
  const date = props.search.debugTransitTime.value
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
})

const nav = props.trip.nav
const view = computed(() => nav.view.value)
const navigating = computed(() => nav.running.value && !!view.value)

const SPEEDS = [
  { v: 1.4, label: '步行' },
  { v: 3, label: '3 m/s' },
  { v: 6, label: '6 m/s' },
  { v: 12, label: '12 m/s' },
]

/** 切換模擬 GPS：導航中就用同一個目的地重新開始這一段 */
function toggleSim() {
  nav.simGps.value = !nav.simGps.value
  if (nav.running.value) nav.restart()
}

const nextTurn = computed(() => {
  const t = view.value?.nextTurn
  return t ? `${t.kind}${t.then ? `→${t.then}` : ''} ${t.distanceM.toFixed(0)}m` : '—'
})
const streets = computed(() => nav.routeInfo.value?.maneuvers.filter((x) => x.street).map((x) => x.street).join(' → ') || '無路名')
</script>

<template>
  <!-- 不加遮罩：開著也要看得到上面的導航箭頭跟著搖桿轉 -->
  <section class="dbg" role="dialog" aria-label="除錯工具" lang="zh-TW">
    <header class="dbg-head">
      <h2>除錯工具</h2>
      <button type="button" class="dbg-x" aria-label="關閉除錯工具" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div v-if="navigating && view" class="dbg-row">
      <div class="dbg-map">
        <NavDebugMap
          :geometry="view.geometry"
          :here="view.here"
          :accuracy-m="view.accuracyM"
          :target="view.targetPoint"
          :nearest="view.nearestPoint"
          :heading-deg="view.headingDeg"
          :destination="nav.destinationPoint.value"
          @pick="nav.simPick"
        />
      </div>
      <Joystick v-if="nav.simGps.value" :size="136" @change="nav.onJoystick" />
    </div>
    <p v-if="navigating" class="dbg-note">
      藍線：路線・橘線：箭頭指的點・虛線：羅盤朝向・綠點：目的地<template v-if="nav.simGps.value">・點地圖可以瞬移；電腦可用方向鍵、Q／E 轉向</template>
    </p>
    <p v-if="nav.simNote.value" class="dbg-note">{{ nav.simNote.value }}</p>

    <div class="dbg-ctrl">
      <p class="dbg-label">交通路線測試位置</p>
      <label for="debug-lat">緯度</label>
      <input id="debug-lat" v-model="latitude" class="dbg-time" type="text" inputmode="decimal" />
      <label for="debug-lon">經度</label>
      <input id="debug-lon" v-model="longitude" class="dbg-time" type="text" inputmode="decimal" />
      <div class="dbg-chips">
        <button type="button" class="chip" @click="setOrigin">使用測試位置</button>
        <button type="button" class="chip" @click="clearOrigin">使用實際位置</button>
      </div>
      <p class="dbg-note" role="status">{{ gpsError || (search.debugOrigin.value ? `測試位置啟用中：${search.debugOrigin.value.join(', ')}` : '目前使用實際位置。預設座標為臺北市立大學天母體育館。') }} 此設定用於公車與捷運路線規劃。</p>
      <label class="dbg-label" for="transit-time">公車／捷運規劃時間</label>
      <input id="transit-time" class="dbg-time" type="datetime-local" :value="transitTimeValue" @change="setTransitTime(($event.target as HTMLInputElement).value)" />
      <button type="button" class="chip" @click="setTransitTime('')">使用實際時間</button>
      <p class="dbg-note">{{ transitTimeValue ? '模擬時間已啟用，路線將依所選日期與時間計算。' : '目前使用實際時間。' }} 資料為路線規劃資料，並非即時班次。</p>
      <p class="dbg-label">模擬</p>
      <div class="dbg-chips">
        <button type="button" class="chip" :aria-pressed="nav.simGps.value" @click="toggleSim">模擬 GPS</button>
        <button type="button" class="chip" :aria-pressed="nav.rerouteFails.value" @click="nav.rerouteFails.value = !nav.rerouteFails.value">
          重算會失敗
        </button>
        <button type="button" class="chip" :aria-pressed="nav.useManualHeading.value" @click="nav.setManualHeading(!nav.useManualHeading.value)">
          手動朝向
        </button>
      </div>
      <input
        v-if="nav.useManualHeading.value"
        class="dbg-range"
        type="range"
        min="0"
        max="359"
        :value="nav.manualHeading.value"
        aria-label="手動朝向（度）"
        @input="nav.setManualHeading(true, Number(($event.target as HTMLInputElement).value))"
      />

      <template v-if="nav.simGps.value">
        <p class="dbg-label">搖桿往上</p>
        <div class="dbg-chips">
          <button type="button" class="chip" :aria-pressed="nav.joyFrame.value === 'map'" @click="nav.joyFrame.value = 'map'">地圖上方（北）</button>
          <button type="button" class="chip" :aria-pressed="nav.joyFrame.value === 'phone'" @click="nav.joyFrame.value = 'phone'">手機面對的方向</button>
        </div>
        <p class="dbg-label">推到底的速度</p>
        <div class="dbg-chips">
          <button
            v-for="s in SPEEDS"
            :key="s.label"
            type="button"
            class="chip"
            :aria-pressed="nav.simSpeed.value === s.v"
            @click="nav.simSpeed.value = s.v"
          >
            {{ s.label }}
          </button>
        </div>
      </template>

      <p class="dbg-label">動作</p>
      <div class="dbg-chips">
        <button v-if="canDemo" type="button" class="chip" @click="emit('demo')">導航到示範站牌</button>
        <button type="button" class="chip" :disabled="!navigating" @click="nav.recalibrate('manual')">重新定位</button>
        <button type="button" class="chip" :disabled="!nav.traceCount.value" @click="nav.downloadTrace">下載軌跡（{{ nav.traceCount.value }}）</button>
        <button type="button" class="chip" :disabled="!nav.traceCount.value" @click="nav.copyTrace">複製軌跡</button>
      </div>
    </div>

    <dl v-if="view" class="dbg-grid">
      <div><dt>狀態</dt><dd>{{ view.state }}</dd></div>
      <div><dt>精度</dt><dd>{{ view.accuracyM?.toFixed(0) ?? '—' }} m</dd></div>
      <div><dt>朝向(真北)</dt><dd>{{ view.headingDeg?.toFixed(0) ?? '—' }}°</dd></div>
      <div><dt>箭頭</dt><dd>{{ view.arrowDeg?.toFixed(0) ?? '—' }}°</dd></div>
      <div><dt>羅盤檢查</dt><dd>{{ view.headingCheck }}</dd></div>
      <div><dt>羅盤偏差</dt><dd>{{ view.headingOffsetDeg?.toFixed(0) ?? '—' }}°</dd></div>
      <div><dt>進度</dt><dd>{{ Math.round(view.progress * 100) }}%</dd></div>
      <div><dt>下個轉彎</dt><dd>{{ nextTurn }}</dd></div>
      <div class="wide">
        <dt>GPS 走向</dt>
        <dd>
          {{ nav.gpsCourse.value === null ? '—（走 5 m 以上才有）' : `${nav.gpsCourse.value.toFixed(0)}°` }}
          <template v-if="nav.courseDiff.value !== null">・和羅盤差 {{ nav.courseDiff.value }}°</template>
        </dd>
      </div>
      <div v-if="nav.routeInfo.value" class="wide">
        <dt>路線</dt>
        <dd>
          {{ nav.legMode.value }}→{{ nav.routeInfo.value.id }}（{{ nav.routeInfo.value.reasons.join('、') }}）・{{ nav.routeInfo.value.distanceM }} m・{{ Math.round(nav.routeInfo.value.durationS / 60) }} 分・階梯 {{ nav.routeInfo.value.stairsCount }} 段・過馬路 {{ nav.routeInfo.value.crossCount ?? '—' }} 次・{{ streets }}
        </dd>
      </div>
      <div v-if="nav.routeError.value" class="wide warn"><dt>錯誤</dt><dd>{{ nav.routeError.value }}</dd></div>
      <div v-if="nav.permissionNote.value" class="wide warn"><dt>權限</dt><dd>{{ nav.permissionNote.value }}</dd></div>
      <div v-if="nav.wakeNote.value" class="wide"><dt>螢幕</dt><dd>{{ nav.wakeNote.value }}</dd></div>
    </dl>

    <div v-if="nav.log.value.length" class="dbg-log">
      <p class="dbg-label">語音／震動紀錄</p>
      <p v-for="c in nav.log.value" :key="c">{{ c }}</p>
    </div>
    <p v-if="!navigating && !canDemo" class="dbg-note">搜尋目的地開始導航後，這裡會出現地圖和狀態。</p>
  </section>
</template>

<style scoped>
.dbg {
  z-index: 40;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 60%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 16px calc(20px + env(safe-area-inset-bottom));
  background: #171b1d;
  color: #f1f3f4;
  border-radius: 24px 24px 0 0;
  user-select: text;
  -webkit-user-select: text;
  animation: rise 0.28s cubic-bezier(0.2, 0.9, 0.1, 1);
}
.dbg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
}
.dbg-head h2 {
  font-size: 18px;
  font-weight: 700;
}
.dbg-x {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  cursor: pointer;
}
.dbg-x svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
}
.dbg-x:focus-visible,
.chip:focus-visible {
  outline: 3px solid #93d4df;
  outline-offset: 2px;
}
.dbg-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 6px;
}
.dbg-map {
  flex: 1;
  min-width: 0;
  height: 168px;
  overflow: hidden;
  border-radius: 16px;
  background: #30383d;
}
.dbg-label {
  margin: 8px 0 6px;
  font-size: 14px;
  color: #adb8be;
}
.dbg-chips {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chip {
  flex: none;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: #30383d;
  font-size: 14px;
  cursor: pointer;
  touch-action: manipulation;
}
.chip[aria-pressed='true'] {
  background: #93d4df;
  color: #112629;
  font-weight: 700;
}
.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dbg-range {
  width: 100%;
  margin: 6px 0;
  accent-color: #93d4df;
}
.dbg-time {
  display: block;
  color: #f1f3f4;
  background: #30383d;
  color-scheme: dark;
  border-radius: 8px;
  padding: 8px;
  margin: 6px 0;
}
.dbg-note {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: #adb8be;
}
.dbg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  margin-top: 12px;
  font-size: 13px;
}
.dbg-grid div {
  display: flex;
  gap: 6px;
  min-width: 0;
}
.dbg-grid .wide {
  grid-column: span 2;
}
.dbg-grid dt {
  flex: none;
  color: #adb8be;
}
.dbg-grid dd {
  min-width: 0;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.dbg-grid .warn dd {
  color: #f4d69e;
}
.dbg-log {
  margin-top: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #cad1d5;
}
@keyframes rise {
  from {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dbg {
    animation: none;
  }
}
</style>
