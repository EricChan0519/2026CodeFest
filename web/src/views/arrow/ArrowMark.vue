<script setup lang="ts">
/**
 * 「跟著箭頭走」的箭頭：主 logo、導航箭頭、搜尋鈕、轉彎小圖示都用這一個形狀。
 * 圓角線條箭頭使用 currentColor；導航版留出目的地方向圓點的空間。
 * hollow：空心（訊號弱、重新找路）；done：換成打勾（抵達）。
 */
import { reducedMotion } from './pose'

defineProps<{ hollow?: boolean; done?: boolean; navigation?: boolean }>()
</script>

<template>
  <svg class="am" :class="{ hollow, done, navigation, 'reduce-motion': reducedMotion() }" viewBox="12 12 76 76" aria-hidden="true" focusable="false">
    <path class="am-arrow" d="M50 84 V16 M20 45 L50 15 L80 45" />
    <g class="am-direction">
      <path d="M50 78 V33 M33 49 L50 32 L67 49" />
    </g>
    <circle class="am-ring" cx="50" cy="50" r="35" pathLength="1" />
    <path class="am-check" d="M24 52 L42 70 L77 33" pathLength="1" />
  </svg>
</template>

<style scoped>
.am {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.am-arrow {
  fill: none;
  stroke: currentColor;
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: opacity 0.3s ease;
}
.hollow .am-arrow {
  opacity: 0.55;
}
.am-direction {
  display: none;
  transition: opacity 0.3s ease;
}
.navigation .am-arrow {
  display: none;
}
.navigation .am-direction {
  display: block;
}
.am-direction path {
  fill: none;
  stroke: currentColor;
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.navigation.hollow .am-direction {
  opacity: 0.55;
}
.am-ring,
.am-check {
  fill: none;
  stroke: currentColor;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  opacity: 0;
}
.am-ring {
  stroke-width: 3;
  transform: rotate(-90deg);
  transform-origin: 50px 50px;
}
.am-check {
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform: translate(10px, 10px) scale(0.8);
}
.done .am-arrow,
.done .am-direction {
  opacity: 0;
}
.done .am-ring,
.done .am-check {
  opacity: 1;
}
.done .am-ring {
  animation: draw-check 0.6s ease-out forwards;
}
.done .am-check {
  animation: draw-check 0.45s ease-out 0.3s forwards;
}
@keyframes draw-check {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}
.done.reduce-motion .am-ring,
.done.reduce-motion .am-check {
  animation: none;
  stroke-dashoffset: 0;
}
</style>
