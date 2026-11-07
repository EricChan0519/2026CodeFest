<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { languages, locale, translate } from './translations'
import AppIcon from './components/AppIcon.vue'
import CompassArrow from './components/CompassArrow.vue'
import { requestCompassPermission } from './composables/useHeading'

type Page = 'welcome' | 'home' | 'search' | 'route' | 'nav' | 'arrived' | 'settings' | 'about' | 'origin'
type Place = { id: number; name: string; address: string; category: string; distance: string; time: string }
type Preferences = { audience: string; language: string; voice: boolean; vibration: boolean }
const audiences = ['長者', '兒童', '外籍人士', '其他']
const stored = (() => { try { return JSON.parse(localStorage.getItem('arrow-preferences') || 'null') as Preferences | null } catch { return null } })()
const prefs = ref<Preferences>(stored ?? { audience: '長者', language: '繁體中文', voice: true, vibration: true })
const page = ref<Page>(stored && localStorage.getItem('arrow-welcomed') === '1' ? 'home' : 'welcome')
const welcomeStep = ref<1 | 2>(1)
const previous = ref<Page>('home')
const routePrevious = ref<Page>('home')
const selected = ref<Place | null>(null)
const origin = ref('目前位置')
const query = ref('')
const searchOrigin = ref(false)
const listPage = ref(0)
const confirmExit = ref(false)
const navStep = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
const places: Place[] = [
  { id: 1, name: '臺北市立美術館', address: '臺北市中山區中山北路三段 181 號', category: '公共設施', distance: '650 公尺', time: '約 9 分鐘' },
  { id: 2, name: '圓山捷運站', address: '臺北市大同區庫倫街 9-1 號', category: '交通站點', distance: '400 公尺', time: '約 6 分鐘' },
  { id: 3, name: '中山北路三段 181 號', address: '臺北市中山區中山北路三段 181 號', category: '地址', distance: '650 公尺', time: '約 9 分鐘' },
  { id: 4, name: '美術館公車站', address: '臺北市中山北路三段', category: '公車站牌', distance: '300 公尺', time: '約 4 分鐘' },
  { id: 5, name: '街角咖啡', address: '臺北市中山區中山北路三段 100 號', category: '店家', distance: '550 公尺', time: '約 8 分鐘' },
]
const englishNames: Record<number, string> = { 1: 'Taipei Fine Arts Museum', 2: 'Yuanshan MRT Station', 3: 'No. 181, Section 3, Zhongshan North Road', 4: 'Fine Arts Museum Bus Stop', 5: 'Corner Café' }
function placeName(place: Place) { return prefs.value.language === '繁體中文' ? place.name : `${englishNames[place.id]} · ${place.name}` }
const results = computed(() => places.filter(p => `${p.name} ${englishNames[p.id]} ${p.address} ${p.category} ${t(p.category)}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const visibleResults = computed(() => results.value.slice(listPage.value * 3, listPage.value * 3 + 3))
watch(query, () => { listPage.value = 0 })
const audienceIcons = ['user', 'smile', 'globe', 'more']
const categoryIcons: Record<string, string> = { '公共設施': 'building', '交通站點': 'train', '地址': 'home', '公車站牌': 'bus', '店家': 'store' }
const steps = [{ angle: 0, distance: '120 公尺', instruction: '往這個方向走' }, { angle: -90, distance: '50 公尺', instruction: '前面路口向左轉' }, { angle: 0, distance: '20 公尺', instruction: '快到了，繼續往前走' }]
const step = computed(() => steps[navStep.value]!)
function t(text: string) { return translate(prefs.value.language, text) }
function formatValue(text: string) { return text.replace('公尺', t('公尺')).replace('約', t('約')).replace('分鐘', t('分鐘')) }
/** 目的地是地址（不是地名）：類別為「地址」，或地址字串已包含名稱 */
function isAddress(place: Place) { return place.category === '地址' || place.address.includes(place.name) }
function displayPlace(value: string) { return value === '目前位置' ? t(value) : value }
watch(() => prefs.value.language, value => { document.documentElement.lang = locale(value); document.title = t('跟著箭頭走') }, { immediate: true })
watch(prefs, value => { try { localStorage.setItem('arrow-preferences', JSON.stringify(value)) } catch { /* settings remain in memory */ } }, { deep: true })
function go(next: Page) { if (page.value === 'welcome' && next === 'home') { try { localStorage.setItem('arrow-welcomed', '1') } catch { /* storage unavailable */ } } page.value = next; window.scrollTo(0, 0) }
function startSearch(forOrigin = false) { searchOrigin.value = forOrigin; query.value = ''; listPage.value = 0; go('search') }
function choose(place: Place) { if (searchOrigin.value) { origin.value = place.name; go('route') } else { selected.value = place; routePrevious.value = 'search'; go('route') } }
function openSettings() { previous.value = page.value; go('settings') }
function announce(message: string) { if (prefs.value.voice && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); const lang = locale(prefs.value.language); const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0]); if (voice) { const utterance = new SpeechSynthesisUtterance(t(message)); utterance.lang = lang; utterance.voice = voice; utterance.rate = prefs.value.audience === '長者' ? 0.8 : 1; window.speechSynthesis.speak(utterance) } } if (prefs.value.vibration && 'vibrate' in navigator) navigator.vibrate(120) }
/**
 * 進度條：依「剩餘抵達時間」計算。
 * 模擬：整段路程 = steps.length × 5 秒；正式版改成 已走時間 /（已走時間 + 剩餘距離 ÷ 步行速度）。
 */
const navProgress = ref(0)
const demoDuration = steps.length * 5000
let navStartedAt = 0
let progressTimer: ReturnType<typeof setInterval> | undefined
function tickProgress() { navProgress.value = Math.min(1, (Date.now() - navStartedAt) / demoDuration) }
function stopTimer() { if (timer) clearInterval(timer); timer = undefined; if (progressTimer) clearInterval(progressTimer); progressTimer = undefined; if ('speechSynthesis' in window) window.speechSynthesis.cancel() }
function startNav() { requestCompassPermission(); navStep.value = 0; navProgress.value = 0; navStartedAt = Date.now(); progressTimer = setInterval(tickProgress, 250); go('nav'); announce(steps[0]!.instruction); timer = setInterval(() => { if (navStep.value < steps.length - 1) { navStep.value++; announce(step.value.instruction) } else { stopTimer(); go('arrived'); announce('到了！') } }, 5000) }
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
watch(() => [page.value, welcomeStep.value, navStep.value, listPage.value, results.value.length, query.value, prefs.value.audience, prefs.value.language, origin.value, selected.value?.id], fitText, { flush: 'post' })
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
        <div class="place-list">
          <button v-for="p in places.slice(0, 3)" :key="p.id" class="place" @click="selected = p; searchOrigin = false; routePrevious = 'home'; go('route')">
            <span class="place-icon"><AppIcon :name="categoryIcons[p.category] ?? 'pin'" /></span>
            <span class="place-info"><strong>{{ placeName(p) }}</strong><small>{{ t(p.category) }} · {{ formatValue(p.distance) }}</small></span>
            <AppIcon class="place-arrow" name="chevron-right" />
          </button>
        </div>
        <button class="about-link" @click="previous = 'home'; go('about')"><AppIcon name="info" :size="20" />{{ t('關於這個服務') }}</button>
      </section>

      <section v-else-if="page === 'search'" class="content">
        <h1>{{ t(searchOrigin ? '從哪裡出發？' : '想去哪裡？') }}</h1>
        <label class="search-field"><AppIcon name="search" /><input v-model="query" autofocus :placeholder="t('輸入地址或地點')" :aria-label="t('搜尋地址或地點')"><button v-if="query" class="clear" :aria-label="t('清除搜尋')" @click="query = ''"><AppIcon name="x" :size="22" /></button></label>
        <div class="section-row"><h2>{{ t('搜尋結果') }}</h2><span class="muted">{{ results.length }}</span></div>
        <div v-if="results.length" class="place-list">
          <button v-for="p in visibleResults" :key="p.id" class="place" @click="choose(p)">
            <span class="place-icon"><AppIcon :name="categoryIcons[p.category] ?? 'pin'" /></span>
            <span class="place-info"><strong>{{ placeName(p) }}</strong><small>{{ p.address }}</small><small>{{ t(p.category) }} · {{ formatValue(p.distance) }}</small></span>
            <AppIcon class="place-arrow" name="chevron-right" />
          </button>
        </div>
        <div v-else class="empty"><span class="empty-icon"><AppIcon name="search" :size="24" /></span><h2>{{ t('找不到這個地點') }}</h2><button class="secondary" @click="query = ''">{{ t('清除搜尋') }}</button></div>
        <div v-if="results.length > 3" class="pagination">
          <button class="text-button" :disabled="listPage === 0" @click="listPage--"><AppIcon name="chevron-left" :size="20" />{{ t('上一頁') }}</button>
          <span>{{ listPage + 1 }} / {{ Math.ceil(results.length / 3) }}</span>
          <button class="text-button" :disabled="(listPage + 1) * 3 >= results.length" @click="listPage++">{{ t('下一頁') }}<AppIcon name="chevron-right" :size="20" /></button>
        </div>
      </section>

      <section v-else-if="page === 'route' && selected" class="content">
        <h1>{{ t('準備好出發了嗎？') }}</h1>
        <div class="route-card">
          <div class="route-point"><span class="point start-point"></span><div><small>{{ t('從這裡出發') }}</small><strong>{{ displayPlace(origin) }}</strong></div><button class="text-button" @click="startSearch(true)">{{ t('更改') }}</button></div>
          <div class="route-point dest"><span class="point end-point"></span><div><small>{{ t('要去的地方') }}</small><strong>{{ placeName(selected) }}</strong><p>{{ selected.address }}</p></div></div>
        </div>
        <div class="stats">
          <div class="stat"><AppIcon name="clock" /><div><small>{{ t('步行路線') }}</small><strong>{{ formatValue(selected.time) }}<span class="stat-sep">·</span>{{ formatValue(selected.distance) }}</strong></div></div>
        </div>
        <div class="actions route-actions">
          <button class="primary start-guide" @click="startNav"><AppIcon name="navigation" :size="28" />{{ t('開始帶路') }}</button>
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
        <p v-if="selected && !isAddress(selected)">{{ selected.address }}</p>
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
