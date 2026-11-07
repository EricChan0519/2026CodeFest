<script setup lang="ts">
/**
 * 圓形拖曳搖桿：按住搖桿頭拖動，放開回到中心。
 * 往上 = 往手機朝向前進。用 Pointer Events，手指和滑鼠都可以。
 * 除了 touch-action: none，還要阻止觸控預設行為，避免 iOS Safari／部分 WebView 捲動或回彈。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { joystickVector } from '@/sensors/joystick'
import type { JoystickVector } from '@/sensors/joystick'

const props = withDefaults(defineProps<{ size?: number }>(), { size: 176 })
const emit = defineEmits<{ change: [v: JoystickVector] }>()

const base = ref<HTMLDivElement>()
const knob = ref({ x: 0, y: 0 })
const active = ref(false)
let pointerId: number | null = null

function preventTouchScroll(e: TouchEvent) {
  e.preventDefault()
}

onMounted(() => {
  base.value?.addEventListener('touchstart', preventTouchScroll, { passive: false })
  base.value?.addEventListener('touchmove', preventTouchScroll, { passive: false })
})
onBeforeUnmount(() => {
  base.value?.removeEventListener('touchstart', preventTouchScroll)
  base.value?.removeEventListener('touchmove', preventTouchScroll)
})

const radius = () => props.size / 2 - 28 // 搖桿頭半徑 28px，留在圓內

function update(e: PointerEvent) {
  const r = base.value!.getBoundingClientRect()
  const v = joystickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), radius())
  knob.value = { x: v.knobX, y: v.knobY }
  emit('change', v)
}

function down(e: PointerEvent) {
  pointerId = e.pointerId
  base.value!.setPointerCapture(e.pointerId)
  active.value = true
  update(e)
}

function move(e: PointerEvent) {
  if (e.pointerId === pointerId) update(e)
}

function up(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  active.value = false
  knob.value = { x: 0, y: 0 }
  emit('change', { forward: 0, right: 0, knobX: 0, knobY: 0 })
}
</script>

<template>
  <div
    ref="base"
    class="relative mx-auto touch-none select-none rounded-full border-2 border-white/40 bg-white/15"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="application"
    aria-label="移動搖桿：拖曳搖桿頭移動，往上是往前"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <span class="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-xs opacity-70">前</span>
    <div
      class="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-white shadow-lg"
      :class="active ? 'opacity-100' : 'opacity-80'"
      :style="{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }"
    />
  </div>
</template>
