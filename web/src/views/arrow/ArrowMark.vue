<script setup lang="ts">
/**
 * 「跟著箭頭走」的箭頭：主 logo、導航箭頭、搜尋鈕、轉彎小圖示都用這一個形狀。
 * 自己畫的直角箭頭（不是任何產品的圖示），顏色跟 currentColor。
 * hollow：空心（訊號弱、重新找路）；done：換成打勾（抵達）。
 */
defineProps<{ hollow?: boolean; done?: boolean }>()
</script>

<template>
  <svg class="am" :class="{ hollow, done }" viewBox="12 12 76 76" aria-hidden="true" focusable="false">
    <path class="am-arrow" d="M50 12 L82 47 L60 47 L60 88 L40 88 L40 47 L18 47 Z" />
    <path class="am-check" d="M24 52 L42 70 L77 33" />
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
  fill: currentColor;
  stroke: currentColor;
  stroke-width: 0;
  stroke-linejoin: miter;
  transition:
    fill-opacity 0.3s ease,
    opacity 0.3s ease;
}
.hollow .am-arrow {
  fill-opacity: 0;
  stroke-width: 4;
}
.am-check {
  fill: none;
  stroke: currentColor;
  stroke-width: 10;
  stroke-linecap: butt;
  stroke-linejoin: miter;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.done .am-arrow {
  opacity: 0;
}
.done .am-check {
  opacity: 1;
}
</style>
