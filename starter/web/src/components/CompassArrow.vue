<script setup lang="ts">
/**
 * 方向粗箭頭，角度由導航引擎（web/src/nav）算好：
 * rotation＝NavView.cssRotation（已加磁偏角、已平滑、走最短方向，可超過 360）；null 時不顯示箭頭。
 * 下一步左轉 → 箭頭先指左；人往左轉後，羅盤（或模擬的行進方向）跟著變，箭頭回正指上方。
 * 沒有箭頭（找位置、找方向、沒有羅盤、定位失敗）時，在同一個位置顯示問號，畫面不會空一塊。
 * 每一幀往目標角度趨近（easeRotation），不用 CSS transition（感測頻率低時會一格一格跳、而且更慢）。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { easeRotation } from '@team/nav/arrow'
import { NAV_CONFIG } from '@team/nav/config'

const props = defineProps<{ rotation: number | null; hollow?: boolean }>()
const shown = ref(props.rotation ?? 0)
let raf = 0
let last = 0
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function frame(now: number) {
  const target = props.rotation
  if (target === null) { raf = 0; return }
  shown.value = reduceMotion ? target : easeRotation(shown.value, target, last ? now - last : 16, NAV_CONFIG.arrowTauMs)
  last = now
  raf = shown.value === target ? 0 : requestAnimationFrame(frame)
}
watch(() => props.rotation, (r, prev) => {
  if (r === null) return
  if (prev === null || prev === undefined) shown.value = r // 剛出現：直接指對，不要從 0° 轉過來
  if (!raf) { last = 0; raf = requestAnimationFrame(frame) }
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <svg class="compass" viewBox="0 0 200 200" role="img" :aria-hidden="props.rotation === null">
    <g v-if="props.rotation !== null" class="compass-rot" :style="{ transform: `rotate(${shown}deg)` }">
      <!-- 粗箭頭：箭頭大三角＋寬箭身，圓角用同色描邊做出來；訊號弱／重新找路時是空心 -->
      <path class="arrow" :class="{ hollow: props.hollow }" d="M100 16 L178 96 L132 96 L132 184 L68 184 L68 96 L22 96 Z" />
    </g>
    <!-- 問號：和箭頭同樣的粗線、圓角 -->
    <g v-else class="unknown">
      <circle class="unknown-ring" cx="100" cy="100" r="84" />
      <path class="unknown-mark" d="M74 80 C74 58 88 48 102 48 C118 48 130 60 130 75 C130 92 116 98 107 106 C102 111 100 116 100 126" />
      <circle class="unknown-dot" cx="100" cy="156" r="11" />
    </g>
  </svg>
</template>

<style scoped>
.compass { width: min(78vw, 340px, 40dvh); height: auto; aspect-ratio: 1; display: block; }
.compass-rot { transform-origin: 100px 100px; }
.arrow { fill: var(--accent); stroke: var(--accent); stroke-width: 14; stroke-linejoin: round; }
.arrow.hollow { fill: none; stroke-width: 12; }
.unknown-ring { fill: var(--accent-weak); stroke: var(--accent); stroke-width: 12; }
.unknown-mark { fill: none; stroke: var(--accent); stroke-width: 20; stroke-linecap: round; stroke-linejoin: round; }
.unknown-dot { fill: var(--accent); }
</style>
