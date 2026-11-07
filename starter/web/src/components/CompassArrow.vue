<script setup lang="ts">
/**
 * 方向粗箭頭。
 * angle：要走的方向，相對於「開始這一步時面向的方向」（0 = 正前方，-90 = 左轉，90 = 右轉）。
 * 箭頭 = 要走的方向 − 使用者已經轉了多少，可 360° 轉動。
 * 例：下一步左轉 → 箭頭先指左；人往左轉 90° 後，箭頭回正指上方。
 * 沒有方位感測器（桌機、投影 Demo）時，模擬使用者跟著轉身，一樣看得到回正的過程。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useHeading } from '@/composables/useHeading'

const props = defineProps<{ angle: number; step: number }>()
const heading = useHeading()
const baseline = ref<number | null>(null)
const simulated = ref(0)
let ticker: ReturnType<typeof setInterval> | undefined
let delay: ReturnType<typeof setTimeout> | undefined
function stopSim() { clearInterval(ticker); clearTimeout(delay); ticker = undefined }

/** 模擬轉身：停 1.2 秒讓人看清楚箭頭方向，再用 1.6 秒轉過去（以時間計算，不靠逐格動畫） */
function simulateTurn(target: number) {
  stopSim()
  simulated.value = 0
  if (heading.value !== null || target === 0) return
  delay = setTimeout(() => {
    const start = Date.now()
    ticker = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 1600)
      simulated.value = target * (1 - (1 - p) ** 3)
      if (p >= 1 || heading.value !== null) stopSim()
    }, 30)
  }, 1200)
}

// 每一步開始時（用步驟編號，不是角度，連續兩步同角度也會重設），以當下朝向為基準
watch(() => props.step, () => { baseline.value = heading.value; simulateTurn(props.angle) }, { immediate: true })
watch(heading, h => { if (baseline.value === null && h !== null) baseline.value = h })
onBeforeUnmount(stopSim)

/** 已經轉了多少度：有感測器用實際朝向，沒有就用模擬值 */
const turned = computed(() => (heading.value === null || baseline.value === null ? simulated.value : heading.value - baseline.value))

/** 累加角度、每次走最短路徑，避免 350° → 10° 時繞一大圈 */
function useShortestRotation(target: () => number) {
  const shown = ref(target())
  watch(target, t => { shown.value += ((((t - shown.value) % 360) + 540) % 360) - 180 })
  return shown
}
const needle = useShortestRotation(() => props.angle - turned.value)
</script>

<template>
  <svg class="compass" viewBox="0 0 200 200" role="img" :aria-label="`${Math.round(((props.angle % 360) + 360) % 360)}°`">
    <g class="compass-rot" :style="{ transform: `rotate(${needle}deg)` }">
      <!-- 粗箭頭：箭頭大三角＋寬箭身，圓角用同色描邊做出來 -->
      <path class="arrow" d="M100 16 L178 96 L132 96 L132 184 L68 184 L68 96 L22 96 Z" />
    </g>
  </svg>
</template>

<style scoped>
.compass { width: min(78vw, 340px, 40dvh); height: auto; aspect-ratio: 1; display: block; }
.compass-rot { transform-origin: 100px 100px; transition: transform .4s cubic-bezier(.2, .8, .2, 1); }
.arrow { fill: var(--accent); stroke: var(--accent); stroke-width: 14; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { .compass-rot { transition: none; } }
</style>
