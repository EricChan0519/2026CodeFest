<script setup lang="ts">
/**
 * 隱藏的除錯工具：長按右上角（看不見的按鈕）0.7 秒，或網址加 ?debug=1。
 * UI 展示階段：搖桿已是真的 lab/Joystick.vue；地圖先放位置，整合時換成 lab/NavDebugMap.vue（點開才載入 Leaflet）。
 */
import { defineAsyncComponent } from 'vue'
import type { JoystickVector } from '@/sensors/joystick'
import type { DemoState } from './demoNav'

const Joystick = defineAsyncComponent(() => import('../lab/Joystick.vue'))

defineProps<{ forced: DemoState | null; speed: number; navigating: boolean }>()
const emit = defineEmits<{
  close: []
  force: [s: DemoState | null]
  speed: [mps: number]
  joystick: [v: JoystickVector]
}>()

const STATES: { key: DemoState | null; label: string }[] = [
  { key: null, label: '自動' },
  { key: 'weak_signal', label: '訊號弱' },
  { key: 'rerouting', label: '重新找路' },
  { key: 'back_to_route', label: '回到路線' },
  { key: 'arrived', label: '抵達' },
]
const SPEEDS = [
  { v: 1.2, label: '步行' },
  { v: 6, label: '5×' },
  { v: 15, label: '12×' },
]
</script>

<template>
  <!-- 不加遮罩：開著也要看得到上面的導航箭頭跟著搖桿轉 -->
  <section class="dbg" role="dialog" aria-label="除錯工具">
    <header class="dbg-head">
      <h2>除錯工具</h2>
      <button type="button" class="dbg-x" aria-label="關閉除錯工具" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="dbg-row">
      <div class="dbg-map">
        <p>除錯地圖</p>
        <small>整合時接 NavDebugMap（Leaflet + OSM，打開才載入）</small>
      </div>
      <Joystick :size="136" @change="emit('joystick', $event)" />
    </div>

    <div class="dbg-ctrl">
      <p class="dbg-label">狀態</p>
      <div class="dbg-chips">
        <button
          v-for="s in STATES"
          :key="s.label"
          type="button"
          class="chip"
          :aria-pressed="forced === s.key"
          :disabled="!navigating"
          @click="emit('force', s.key)"
        >
          {{ s.label }}
        </button>
      </div>
      <p class="dbg-label">速度</p>
      <div class="dbg-chips">
        <button
          v-for="s in SPEEDS"
          :key="s.label"
          type="button"
          class="chip"
          :aria-pressed="speed === s.v"
          @click="emit('speed', s.v)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>
    <p v-if="!navigating" class="dbg-note">先搜尋目的地開始導航，狀態按鈕才會有作用。</p>
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
  padding: 12px 16px calc(20px + env(safe-area-inset-bottom));
  background: #171b1d;
  color: #f1f3f4;
  border-radius: 24px 24px 0 0;
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
.dbg-map {
  flex: 1;
  min-width: 0;
  height: 136px;
  display: grid;
  place-content: center;
  gap: 4px;
  padding: 8px;
  border: 1.5px dashed #5e6d76;
  border-radius: 16px;
  text-align: center;
  color: #adb8be;
}
.dbg-map p {
  font-size: 16px;
  font-weight: 600;
  color: #e3e7e9;
}
.dbg-map small {
  font-size: 13px;
  line-height: 1.4;
}
.dbg-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}
.dbg-label {
  margin: 4px 0 6px;
  font-size: 14px;
  color: #adb8be;
}
.dbg-chips {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
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
.dbg-note {
  margin-top: 4px;
  font-size: 14px;
  color: #adb8be;
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
