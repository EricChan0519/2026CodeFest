<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { languages, locale, translate } from './translations'
import AppIcon from './components/AppIcon.vue'
import CompassArrow from './components/CompassArrow.vue'
import { requestCompassPermission } from './composables/useHeading'
import type { ApiError } from './lib/api'
import { FALLBACK_ORIGIN, currentPosition, formatDistance, nearbyPlaces, planRoute, searchAddress, searchPlaces, type LatLon, type NavStep, type Place, type PlannedRoute } from './lib/arrow-api'

type Page = 'welcome' | 'home' | 'search' | 'route' | 'nav' | 'arrived' | 'settings' | 'about' | 'origin'
type Preferences = { audience: string; language: string; voice: boolean; vibration: boolean }
type Load = 'idle' | 'loading' | 'ok' | 'error'
const audiences = ['長者', '兒童', '外籍人士', '其他']
const stored = (() => { try { return JSON.parse(localStorage.getItem('arrow-preferences') || 'null') as Preferences | null } catch { return null } })()
const prefs = ref<Preferences>(stored ?? { audience: '長者', language: '繁體中文', voice: true, vibration: true })
const page = ref<Page>(stored && localStorage.getItem('arrow-welcomed') === '1' ? 'home' : 'welcome')
const welcomeStep = ref<1 | 2>(1)
const previous = ref<Page>('home')
const routePrevious = ref<Page>('home')
const selected = ref<Place | null>(null)
const query = ref('')
const searchOrigin = ref(false)
const listPage = ref(0)
const confirmExit = ref(false)
const navStep = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

/* ── 起點：先用手機定位；拒絕、逾時或不在臺北市時，改用圓山捷運站 ── */
const origin = ref<LatLon & { name: string }>({ ...FALLBACK_ORIGIN })
const located = ref(false)

/* ── 附近的公車站牌（後端 /api/stations/nearby） ── */
const nearby = ref<Place[]>([])
const nearbyState = ref<Load>('idle')
async function loadNearby() {
  nearbyState.value = 'loading'
  try {
    if (!located.value) {
      located.value = true
      const here = await currentPosition()
      if (here) origin.value = { name: '目前位置', ...here }
    }
    try { nearby.value = await nearbyPlaces(origin.value) }
    catch (e) {
      if ((e as ApiError).status !== 400 || origin.value.name !== '目前位置') throw e
      origin.value = { ...FALLBACK_ORIGIN }  // 不在服務範圍
      nearby.value = await nearbyPlaces(origin.value)
    }
    nearbyState.value = 'ok'
  } catch { nearbyState.value = 'error' }
}

/* ── 搜尋（後端 /api/stations/search）：停止輸入 300 毫秒後才送出 ── */
const searchResults = ref<Place[]>([])
const searchState = ref<Load>('idle')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
function runSearch(q: string) {
  clearTimeout(searchTimer)
  if (!q) { searchState.value = 'idle'; return }
  searchState.value = 'loading'
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq
    try { const list = await searchPlaces(q, origin.value); if (seq === searchSeq) { searchResults.value = list; searchState.value = 'ok' } }
    catch { if (seq === searchSeq) searchState.value = 'error' }
  }, 300)
}
watch(query, value => { listPage.value = 0; addressResults.value = []; addressState.value = 'idle'; runSearch(value.trim()) })

/* ── 地址搜尋（OpenStreetMap Nominatim）：只在按 Enter／「用地址搜尋」時查，且間隔至少 1 秒（Nominatim 使用規定） ── */
const addressResults = ref<Place[]>([])
const addressState = ref<Load>('idle')
let lastGeocodeAt = 0
async function runAddressSearch() {
  const q = query.value.trim()
  if (!q || addressState.value === 'loading') return
  addressState.value = 'loading'
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt))
  if (wait) await new Promise(r => setTimeout(r, wait))
  lastGeocodeAt = Date.now()
  try { const list = await searchAddress(q, origin.value); if (query.value.trim() === q) { addressResults.value = list; addressState.value = 'ok'; listPage.value = 0 } }
  catch { if (query.value.trim() === q) addressState.value = 'error' }
}
function retryList() { if (query.value.trim()) runSearch(query.value.trim()); else loadNearby() }
/** 沒輸入時顯示附近站牌，有輸入時顯示搜尋結果 */
const results = computed(() => (query.value.trim() ? [...addressResults.value, ...searchResults.value] : nearby.value))
const listState = computed(() => (query.value.trim() ? searchState.value : nearbyState.value))
const visibleResults = computed(() => results.value.slice(listPage.value * 3, listPage.value * 3 + 3))

/* ── 路線（後端 /api/routes） ── */
const planned = ref<PlannedRoute | null>(null)
const routeState = ref<Load>('idle')
const routeError = ref('')
let routeSeq = 0
async function loadRoute() {
  if (!selected.value) return
  const seq = ++routeSeq
  routeState.value = 'loading'; planned.value = null
  try { const r = await planRoute(origin.value, selected.value, prefs.value.audience); if (seq === routeSeq) { planned.value = r; routeState.value = 'ok' } }
  catch (e) {
    if (seq !== routeSeq) return
    // 404 或沒有路線＝真的找不到；其他（逾時、斷線、5xx）＝連線問題
    const status = (e as ApiError).status
    routeError.value = status === 404 || (e as Error).message === 'no route' ? '找不到可以走的路線' : '無法連線，請確認網路'
    routeState.value = 'error'
  }
}
watch(() => [page.value, selected.value?.id, origin.value.lat, origin.value.lon, prefs.value.audience], () => { if (page.value === 'route') loadRoute() })

const englishFirst = computed(() => prefs.value.language !== '繁體中文')
function placeName(place: Place) { return englishFirst.value && place.nameEn ? `${place.nameEn} · ${place.name}` : place.name }
/** 站牌的副標：停靠的公車路線 */
/** 副標：站牌顯示停靠公車，店家顯示分店地址，地址顯示行政區 */
function placeSub(place: Place) { return place.kind === 'stop' ? placeRoutes(place) : place.detail }
function placeRoutes(place: Place) { const max = prefs.value.audience === '長者' ? 3 : 6; const shown = place.routes.slice(0, max).join('、'); return `${t('公車')} ${shown}${place.routes.length > max ? '…' : ''}` }
/** 列表副標一行：距離 · 停靠公車（目前結果都是站牌，不再重複顯示「公車站牌」） */
function placeLine(place: Place) { return [placeDistance(place), placeSub(place)].filter(Boolean).join(' · ') }
function placeDistance(place: Place) { return place.distanceM == null ? '' : formatValue(formatDistance(place.distanceM)) }
const audienceIcons = ['user', 'smile', 'globe', 'more']
const categoryIcons: Record<string, string> = { '公共設施': 'building', '交通站點': 'train', '地址': 'home', '公車站牌': 'bus', '店家': 'store' }
const steps = computed<NavStep[]>(() => planned.value?.steps ?? [])
const step = computed(() => steps.value[navStep.value] ?? { angle: 0, distance: '', instruction: '' })
function t(text: string) { return translate(prefs.value.language, text) }
function formatValue(text: string) { return text.replace('公尺', t('公尺')).replace('約', t('約')).replace('分鐘', t('分鐘')) }
/** 目的地是地址（不是地名）時，抵達頁不再重複顯示副標；目前資料都是站牌 */
function isAddress(place: Place) { return place.kind === 'address' }
function displayPlace(value: string) { return value === '目前位置' ? t(value) : value }
watch(() => prefs.value.language, value => { document.documentElement.lang = locale(value); document.title = t('跟著箭頭走') }, { immediate: true })
watch(prefs, value => { try { localStorage.setItem('arrow-preferences', JSON.stringify(value)) } catch { /* settings remain in memory */ } }, { deep: true })
function go(next: Page) { if (page.value === 'welcome' && next === 'home') { try { localStorage.setItem('arrow-welcomed', '1') } catch { /* storage unavailable */ } } page.value = next; window.scrollTo(0, 0) }
function startSearch(forOrigin = false) { searchOrigin.value = forOrigin; query.value = ''; listPage.value = 0; go('search') }
function choose(place: Place) { if (searchOrigin.value) { origin.value = { name: place.name, lat: place.lat, lon: place.lon }; searchOrigin.value = false; go('route') } else { selected.value = place; routePrevious.value = 'search'; go('route') } }
function openSettings() { previous.value = page.value; go('settings') }
function announce(message: string) { if (prefs.value.voice && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); const lang = locale(prefs.value.language); const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0]); if (voice) { const utterance = new SpeechSynthesisUtterance(t(message)); utterance.lang = lang; utterance.voice = voice; utterance.rate = prefs.value.audience === '長者' ? 0.8 : 1; window.speechSynthesis.speak(utterance) } } if (prefs.value.vibration && 'vibrate' in navigator) navigator.vibrate(120) }
/**
 * 進度條：依「剩餘抵達時間」計算。
 * 模擬：整段路程 = steps.length × 5 秒；正式版改成 已走時間 /（已走時間 + 剩餘距離 ÷ 步行速度）。
 */
const navProgress = ref(0)
let demoDuration = 15000
let navStartedAt = 0
let progressTimer: ReturnType<typeof setInterval> | undefined
function tickProgress() { navProgress.value = Math.min(1, (Date.now() - navStartedAt) / demoDuration) }
function stopTimer() { if (timer) clearInterval(timer); timer = undefined; if (progressTimer) clearInterval(progressTimer); progressTimer = undefined; if ('speechSynthesis' in window) window.speechSynthesis.cancel() }
function startNav() { if (!steps.value.length) return; requestCompassPermission(); navStep.value = 0; demoDuration = steps.value.length * 5000; navProgress.value = 0; navStartedAt = Date.now(); progressTimer = setInterval(tickProgress, 250); go('nav'); announce(steps.value[0]!.instruction); timer = setInterval(() => { if (navStep.value < steps.value.length - 1) { navStep.value++; announce(step.value.instruction) } else { stopTimer(); go('arrived'); announce('到了！') } }, 5000) }
function exitNav() { stopTimer(); confirmExit.value = false; go('home') }
onUnmounted(stopTimer)

/**
 * 長者模式：字級倍率 --fs 介於 1～2，自動取「這一頁不用捲動」的最大值（二分搜尋）。
 * 換頁、換步驟、換語言、轉向或字體載入完成時重算。
 */
const appEl = ref<HTMLElement>()
async function fitText() {
  await nextTick()
  const el = appEl.value
  if (!el) return
  if (prefs.value.audience !== '長者') { el.style.removeProperty('--fs'); return }
  const fits = () => {
    const box = el.querySelector<HTMLElement>('.content, .nav-screen')
    return !box || box.scrollHeight <= box.clientHeight
  }
  el.style.setProperty('--fs', '2')
  if (fits()) return
  let lo = 1, hi = 2
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2
    el.style.setProperty('--fs', String(mid))
    if (fits()) lo = mid; else hi = mid
  }
  el.style.setProperty('--fs', String(lo))
}
watch(() => [page.value, welcomeStep.value, navStep.value, listPage.value, results.value.length, listState.value, nearbyState.value, routeState.value, query.value, prefs.value.audience, prefs.value.language, origin.value.name, selected.value?.id], fitText, { flush: 'post' })
// 進到首頁或搜尋頁時才定位、抓附近站牌（歡迎頁先不跳定位權限）
watch(page, value => { if ((value === 'home' || value === 'search') && nearbyState.value === 'idle') loadNearby() }, { immediate: true })
onMounted(() => {
  fitText()
  document.fonts?.ready.then(fitText)
  window.addEventListener('resize', fitText)
})
onUnmounted(() => window.removeEventListener('resize', fitText))
</script>

<template>
  <main ref="appEl" class="app" :class="{ 'large-type': prefs.audience === '長者' }">
    <div v-if="page !== 'nav' && page !== 'arrived'" class="shell">
      <header class="topbar">
        <button v-if="page === 'welcome' && welcomeStep === 2" class="icon-button back" :aria-label="t('返回語言選擇')" @click="welcomeStep = 1"><AppIcon name="arrow-left" /></button>
        <button v-else-if="!['home', 'welcome'].includes(page)" class="icon-button back" :aria-label="t('返回')" @click="page === 'settings' || page === 'about' ? go(previous) : page === 'search' ? go(searchOrigin ? 'route' : 'home') : page === 'route' ? (searchOrigin = false, go(routePrevious)) : go('home')"><AppIcon name="arrow-left" /></button>
        <span v-else class="brand-mark" aria-hidden="true"><AppIcon name="navigation" :size="20" /></span>
        <span class="brand-name">{{ t('跟著箭頭走') }}</span>
        <button v-if="page !== 'welcome' && page !== 'settings'" class="icon-button settings-icon" :aria-label="t('設定')" @click="openSettings"><AppIcon name="settings" /></button>
      </header>

      <section v-if="page === 'welcome'" class="content welcome">
        <template v-if="welcomeStep === 1">
          <div class="welcome-center">
            <h1>{{ t('選擇語言') }}</h1>
            <label class="field-label" for="welcome-lang">{{ t('語言') }}</label>
            <select id="welcome-lang" v-model="prefs.language"><option v-for="l in languages" :key="l" :value="l">{{ l }}</option></select>
          </div>
          <div class="actions"><button class="primary" @click="welcomeStep = 2">{{ t('下一步') }} <AppIcon name="arrow-right" :size="22" /></button></div>
        </template>
        <template v-else>
          <h1>{{ t('誰要使用') }}</h1>
          <div class="option-list" role="radiogroup" :aria-label="t('選擇使用對象')">
            <button v-for="(a, i) in audiences" :key="a" class="option" role="radio" :aria-checked="prefs.audience === a" :class="{ active: prefs.audience === a }" @click="prefs.audience = a">
              <AppIcon class="option-icon" :name="audienceIcons[i]!" />{{ t(a) }}
              <span class="radio"><AppIcon v-if="prefs.audience === a" name="check" :size="15" :stroke="3" /></span>
            </button>
          </div>
          <div class="actions">
            <button class="primary" @click="go('home')">{{ t('開始使用') }} <AppIcon name="arrow-right" :size="22" /></button>
          </div>
        </template>
      </section>

      <section v-else-if="page === 'home'" class="content home">
        <h1>{{ t('想去哪裡？') }}</h1>
        <button class="search-entry" @click="startSearch()"><AppIcon name="search" /><span>{{ t('搜尋地址或地點') }}</span></button>
        <div class="section-row">
          <h2>{{ t('附近的地點') }}</h2>
        </div>
        <p v-if="nearbyState === 'idle' || nearbyState === 'loading'" class="list-status" role="status">{{ t('載入中') }}</p>
        <div v-else-if="nearbyState === 'error'" class="empty"><h2>{{ t('無法連線，請確認網路') }}</h2><button class="secondary" @click="loadNearby">{{ t('再試一次') }}</button></div>
        <div v-else-if="!nearby.length" class="empty"><h2>{{ t('附近沒有公車站牌') }}</h2></div>
        <div v-else class="place-list">
          <button v-for="p in nearby.slice(0, 3)" :key="p.id" class="place" @click="selected = p; searchOrigin = false; routePrevious = 'home'; go('route')">
            <span class="place-icon"><AppIcon :name="categoryIcons[p.category] ?? 'pin'" /></span>
            <span class="place-info"><strong>{{ placeName(p) }}</strong><small>{{ placeLine(p) }}</small></span>
            <AppIcon class="place-arrow" name="chevron-right" />
          </button>
        </div>
        <button class="about-link" @click="previous = 'home'; go('about')"><AppIcon name="info" :size="20" />{{ t('關於這個服務') }}</button>
      </section>

      <section v-else-if="page === 'search'" class="content">
        <h1>{{ t(searchOrigin ? '從哪裡出發？' : '想去哪裡？') }}</h1>
        <label class="search-field"><AppIcon name="search" /><input v-model="query" autofocus enterkeyhint="search" @keydown.enter.prevent="runAddressSearch" :placeholder="t('輸入地址或地點')" :aria-label="t('搜尋地址或地點')"><button v-if="query" class="clear" :aria-label="t('清除搜尋')" @click="query = ''"><AppIcon name="x" :size="22" /></button></label>
        <div class="section-row"><h2>{{ t('搜尋結果') }}</h2><span class="muted">{{ results.length }}</span></div>
        <p v-if="listState === 'idle' || listState === 'loading'" class="list-status" role="status">{{ t('載入中') }}</p>
        <div v-else-if="listState === 'error'" class="empty"><h2>{{ t('無法連線，請確認網路') }}</h2><button class="secondary" @click="retryList">{{ t('再試一次') }}</button></div>
        <div v-else-if="results.length" class="place-list">
          <button v-for="p in visibleResults" :key="p.id" class="place" @click="choose(p)">
            <span class="place-icon"><AppIcon :name="categoryIcons[p.category] ?? 'pin'" /></span>
            <span class="place-info"><strong>{{ placeName(p) }}</strong><small>{{ placeLine(p) }}</small></span>
            <AppIcon class="place-arrow" name="chevron-right" />
          </button>
        </div>
        <div v-else class="empty"><span class="empty-icon"><AppIcon name="search" :size="24" /></span><h2>{{ t('找不到這個地點') }}</h2><button class="secondary" @click="query = ''">{{ t('清除搜尋') }}</button></div>
        <button v-if="query.trim() && listState === 'ok' && addressState !== 'ok'" class="address-search" :disabled="addressState === 'loading'" @click="runAddressSearch"><AppIcon name="pin" :size="22" />{{ addressState === 'loading' ? t('載入中') : addressState === 'error' ? t('無法連線，請確認網路') : t('用地址搜尋') }}</button>
        <div v-if="listState === 'ok' && results.length > 3" class="pagination">
          <button class="text-button" :disabled="listPage === 0" @click="listPage--"><AppIcon name="chevron-left" :size="20" />{{ t('上一頁') }}</button>
          <span>{{ listPage + 1 }} / {{ Math.ceil(results.length / 3) }}</span>
          <button class="text-button" :disabled="(listPage + 1) * 3 >= results.length" @click="listPage++">{{ t('下一頁') }}<AppIcon name="chevron-right" :size="20" /></button>
        </div>
      </section>

      <section v-else-if="page === 'route' && selected" class="content">
        <h1>{{ t('準備好出發了嗎？') }}</h1>
        <div class="route-card">
          <div class="route-point"><span class="point start-point"></span><div><small>{{ t('從這裡出發') }}</small><strong>{{ displayPlace(origin.name) }}</strong></div><button class="text-button" @click="startSearch(true)">{{ t('更改') }}</button></div>
          <div class="route-point dest"><span class="point end-point"></span><div><small>{{ t('要去的地方') }}</small><strong>{{ placeName(selected) }}</strong><p>{{ placeSub(selected) }}</p></div></div>
        </div>
        <div class="stats">
          <div class="stat"><AppIcon name="clock" /><div><small>{{ t('步行路線') }}</small>
            <strong v-if="routeState === 'ok' && planned">{{ formatValue(`約 ${Math.max(1, Math.ceil(planned.durationS / 60))} 分鐘`) }}<span class="stat-sep">·</span>{{ formatValue(formatDistance(planned.distanceM)) }}</strong>
            <strong v-else-if="routeState === 'error'">{{ t(routeError) }}</strong>
            <strong v-else role="status">{{ t('載入中') }}</strong>
          </div><button v-if="routeState === 'error'" class="text-button stat-retry" @click="loadRoute">{{ t('再試一次') }}</button></div>
        </div>
        <div class="actions route-actions">
          <button class="primary start-guide" :disabled="routeState !== 'ok'" @click="startNav"><AppIcon name="navigation" :size="28" />{{ t('開始帶路') }}</button>
          <p class="footnote"><AppIcon name="info" :size="18" />{{ t('請留意來車與紅綠燈。') }}</p>
        </div>
      </section>

      <section v-else-if="page === 'settings'" class="content">
        <h1>{{ t('設定') }}</h1>
        <label class="field-label" for="set-audience">{{ t('使用對象') }}</label>
        <select id="set-audience" v-model="prefs.audience"><option v-for="a in audiences" :key="a" :value="a">{{ t(a) }}</option></select>
        <label class="field-label" for="set-lang">{{ t('語言') }}</label>
        <select id="set-lang" v-model="prefs.language"><option v-for="l in languages" :key="l" :value="l">{{ l }}</option></select>
        <div class="settings-group">
          <label class="toggle-row"><span><strong>{{ t('語音提示') }}</strong></span><input v-model="prefs.voice" class="switch" type="checkbox" role="switch"></label>
          <label class="toggle-row"><span><strong>{{ t('震動提示') }}</strong></span><input v-model="prefs.vibration" class="switch" type="checkbox" role="switch"></label>
        </div>
        <div class="actions">
          <button class="primary" @click="go(previous)">{{ t('完成') }}</button>
        </div>
      </section>

      <section v-else-if="page === 'about'" class="content"><h1>{{ t('關於這個服務') }}</h1><p class="lead">{{ t('告訴我們目的地，剩下的跟著箭頭走。') }}</p></section>
    </div>

    <section v-else-if="page === 'nav'" class="nav-screen">
      <div class="nav-top">
        <div class="nav-tools">
          <button class="icon-button nav-round nav-end" :aria-label="t('結束導航')" @click="confirmExit = true"><AppIcon name="x" /></button>
          <button class="icon-button nav-round" :class="{ on: prefs.voice }" :aria-label="t('語音提示')" :aria-pressed="prefs.voice" @click="prefs.voice = !prefs.voice"><AppIcon :name="prefs.voice ? 'volume' : 'volume-off'" /></button>
        </div>
        <div class="nav-destination"><small>{{ t('正在前往') }}</small><strong>{{ selected ? placeName(selected) : '' }}</strong></div>
        <!-- 進度 = 已走時間 / 預估總時間，跟著剩餘抵達時間連續變化 -->
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(navProgress * 100)"><span :style="{ width: `${navProgress * 100}%` }"></span></div>
      </div>
      <div class="big-arrow"><CompassArrow :angle="step.angle" :step="navStep" /></div>
      <div class="nav-instruction" aria-live="polite"><strong>{{ formatValue(step.distance) }}</strong><p>{{ t(step.instruction) }}</p></div>
      <button class="secondary" @click="confirmExit = true"><AppIcon name="x" :size="22" />{{ t('結束導航') }}</button>
    </section>

    <section v-else class="nav-screen arrived">
      <h1 class="arrival-title" aria-live="polite">{{ t('到了！') }}</h1>
      <!-- 地圖大頭針從上方落下，插在地上的圓圈：就是這裡 -->
      <div class="arrival-mark" aria-hidden="true">
        <svg viewBox="0 0 200 250">
          <ellipse class="arrival-ring" cx="100" cy="226" rx="74" ry="16" />
          <g class="arrival-pin"><path fill-rule="evenodd" d="M100 214 C72 178 30 142 30 92 A70 70 0 1 1 170 92 C170 142 128 178 100 214 Z M130 92 A30 30 0 1 0 70 92 A30 30 0 1 0 130 92 Z" /></g>
        </svg>
      </div>
      <div class="arrival-sheet">
        <strong>{{ selected ? placeName(selected) : '' }}</strong>
        <!-- 目的地本身就是地址時，不再重複顯示地址 -->
        <p v-if="selected && !isAddress(selected)">{{ placeSub(selected) }}</p>
        <button class="primary arrival-done" @click="go('home')">{{ t('完成') }}</button>
      </div>
    </section>

    <div v-if="confirmExit" class="overlay" @click.self="confirmExit = false">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title">
        <h2 id="exit-title">{{ t('要結束導航嗎？') }}</h2>
        <button class="primary" @click="confirmExit = false">{{ t('繼續導航') }}</button>
        <button class="secondary" @click="exitNav">{{ t('結束導航') }}</button>
      </div>
    </div>
  </main>
</template>
