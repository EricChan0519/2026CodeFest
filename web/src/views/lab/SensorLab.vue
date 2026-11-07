<script setup lang="ts">
/**
 * V1／V2 手機實驗頁：羅盤與定位的所有數值直接顯示在畫面上，
 * 因為 iPhone 沒有 Mac 看不到 Console。對照手機的指南針 App，誤差要在 15° 內。
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { NAV_CONFIG } from '@/nav/config'
import { norm360 } from '@/nav/geo'
import { WakeLockHolder } from '@/sensors/wakelock'
import { WebSensorSource } from '@/sensors/web'
import type { RawOrientation } from '@/sensors/web'

const running = ref(false)
const permission = ref('尚未要求')
const errors = ref<string[]>([])
const copied = ref('')

const raw = reactive<{ r: RawOrientation | null }>({ r: null })
const magDeg = ref<number | null>(null)
const headingTimes: number[] = []
const headingHz = ref(0)
const lastHeadingAt = ref(0)
const now = ref(Date.now())

const pos = reactive({
  lat: null as number | null,
  lon: null as number | null,
  accuracyM: null as number | null,
  count: 0,
  lastAt: 0,
  intervalMs: null as number | null,
})
const wakeLockState = ref('尚未要求')

const wake = new WakeLockHolder()
const source = new WebSensorSource({
  onRaw: (r) => (raw.r = r),
})

const trueDeg = computed(() => (magDeg.value === null ? null : norm360(magDeg.value + NAV_CONFIG.declinationDeg)))
const noHeading = computed(() => running.value && now.value - (lastHeadingAt.value || startedAt) > NAV_CONFIG.headingLostS * 1000)
const gpsAge = computed(() => (pos.lastAt ? Math.round((now.value - pos.lastAt) / 100) / 10 : null))
const secure = window.isSecureContext
let startedAt = 0

const timer = window.setInterval(() => {
  now.value = Date.now()
  const cutoff = now.value - 1000
  while (headingTimes.length && headingTimes[0]! < cutoff) headingTimes.shift()
  headingHz.value = headingTimes.length
}, 250)

async function start() {
  errors.value = []
  startedAt = Date.now()
  // iOS：權限要在點擊事件內呼叫
  permission.value = await source.requestPermission()
  if (permission.value === 'denied') {
    errors.value.push('羅盤權限被拒絕')
    return
  }
  source.start({
    onHeading(d) {
      magDeg.value = d
      lastHeadingAt.value = Date.now()
      headingTimes.push(Date.now())
    },
    onPosition(p) {
      if (pos.lastAt) pos.intervalMs = Date.now() - pos.lastAt
      pos.lat = p.lat
      pos.lon = p.lon
      pos.accuracyM = p.accuracyM
      pos.count++
      pos.lastAt = Date.now()
    },
    onError(code) {
      errors.value.push(`${new Date().toLocaleTimeString()} ${code}`)
    },
  })
  const ok = await wake.on()
  wakeLockState.value = ok ? '已取得' : wake.supported ? '取得失敗' : '不支援'
  running.value = true
}

async function stop() {
  source.stop()
  await wake.off()
  wakeLockState.value = '已釋放'
  running.value = false
}

const report = computed(() =>
  JSON.stringify(
    {
      ua: navigator.userAgent,
      secureContext: secure,
      permission: permission.value,
      event: raw.r?.eventName ?? null,
      absolute: raw.r?.absolute ?? null,
      headingHz: headingHz.value,
      magneticDeg: magDeg.value === null ? null : Math.round(magDeg.value * 10) / 10,
      trueDeg: trueDeg.value === null ? null : Math.round(trueDeg.value * 10) / 10,
      webkitCompassHeading: raw.r?.webkitCompassHeading ?? null,
      accuracyM: pos.accuracyM,
      gpsFixes: pos.count,
      gpsIntervalMs: pos.intervalMs,
      wakeLock: wakeLockState.value,
      errors: errors.value,
    },
    null,
    2,
  ),
)

async function copy() {
  try {
    await navigator.clipboard.writeText(report.value)
    copied.value = '已複製'
  } catch {
    copied.value = '無法自動複製，請長按下面的文字全選複製'
  }
}

onBeforeUnmount(() => {
  window.clearInterval(timer)
  void stop()
})

const f = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toFixed(d))
</script>

<template>
  <main class="mx-auto max-w-md space-y-4 p-4 text-base">
    <h1 class="text-xl font-bold">感測實驗（V1 羅盤、V2 定位）</h1>

    <p v-if="!secure" class="rounded bg-red-100 p-3 text-red-800">
      這個頁面不是 HTTPS，手機瀏覽器會封鎖羅盤和定位。請用 Firebase 預覽網址開。
    </p>

    <div class="flex gap-3">
      <button
        v-if="!running"
        class="h-16 flex-1 rounded-xl bg-[#356C77] text-lg font-bold text-white"
        @click="start"
      >
        開始
      </button>
      <button v-else class="h-16 flex-1 rounded-xl bg-[#30383D] text-lg font-bold text-white" @click="stop">
        停止
      </button>
    </div>

    <p v-if="noHeading" class="rounded bg-amber-100 p-3 text-amber-900">
      {{ NAV_CONFIG.headingLostS }} 秒內沒有收到朝向事件：這個環境可能沒有羅盤，或權限被擋。
    </p>
    <p v-for="e in errors" :key="e" class="rounded bg-red-100 p-2 text-red-800">{{ e }}</p>

    <section class="flex items-center gap-4 rounded-xl bg-gray-100 p-4">
      <!-- 紅色 N 指向真北：手機轉動時，N 應該一直指向現實中的北方 -->
      <div class="relative h-28 w-28 shrink-0 rounded-full border-4 border-gray-400">
        <div
          class="absolute inset-0 flex items-start justify-center text-xl font-bold text-red-600"
          :style="{ transform: `rotate(${-(trueDeg ?? 0)}deg)` }"
        >
          N
        </div>
        <div class="absolute inset-x-0 bottom-1 text-center text-xs text-gray-500">手機上緣↑</div>
      </div>
      <div>
        <div class="text-4xl font-bold tabular-nums">{{ f(trueDeg, 0) }}°</div>
        <div class="text-sm text-gray-600">真北朝向（磁偏角 {{ NAV_CONFIG.declinationDeg }}°）</div>
        <div class="text-sm text-gray-600">磁北朝向 {{ f(magDeg, 0) }}°</div>
      </div>
    </section>

    <section class="space-y-1 rounded-xl bg-gray-100 p-4 text-sm">
      <h2 class="font-bold">V1 羅盤</h2>
      <div>事件：{{ raw.r?.eventName ?? '—' }}（absolute={{ raw.r?.absolute ?? '—' }}）</div>
      <div>頻率：{{ headingHz }} Hz</div>
      <div>alpha {{ f(raw.r?.alpha) }}　beta {{ f(raw.r?.beta) }}　gamma {{ f(raw.r?.gamma) }}</div>
      <div>webkitCompassHeading（iOS）：{{ f(raw.r?.webkitCompassHeading) }}</div>
      <div>權限：{{ permission }}</div>
    </section>

    <section class="space-y-1 rounded-xl bg-gray-100 p-4 text-sm">
      <h2 class="font-bold">V2 定位</h2>
      <div>緯度 {{ f(pos.lat, 6) }}　經度 {{ f(pos.lon, 6) }}</div>
      <div>精度：{{ f(pos.accuracyM, 0) }} 公尺（超過 {{ NAV_CONFIG.weakAccuracyM }} 算訊號弱）</div>
      <div>更新次數 {{ pos.count }}　間隔 {{ pos.intervalMs ?? '—' }} ms　距上次 {{ gpsAge ?? '—' }} 秒</div>
      <div>螢幕常亮（Wake Lock）：{{ wakeLockState }}</div>
    </section>

    <section class="space-y-2 rounded-xl bg-gray-100 p-4 text-sm">
      <h2 class="font-bold">回報給隊長</h2>
      <button class="h-12 w-full rounded-lg bg-white font-bold shadow" @click="copy">複製結果 JSON</button>
      <div v-if="copied" class="text-gray-700">{{ copied }}</div>
      <textarea readonly class="h-48 w-full rounded border bg-white p-2 font-mono text-xs" :value="report" />
    </section>

    <router-link class="block text-center text-[#356C77] underline" to="/lab/nav">前往導航實驗 →</router-link>
  </main>
</template>
