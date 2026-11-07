<script setup lang="ts">
/** 線條圖示（24×24、stroke = currentColor），取代 Unicode 符號，跨裝置字型一致。 */
const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), { size: 24, stroke: 2 })

const paths: Record<string, string> = {
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'arrow-up': 'M12 20V5M5 12l7-7 7 7',
  'turn-left': 'M19 21v-8a4 4 0 0 0-4-4H5M9 13 5 9l4-4',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-left': 'M15 18l-6-6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  settings: 'M3 6h11M18 6h3M3 12h3M10 12h11M3 18h13M20 18h1M16 4v4M8 10v4M18 16v4',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  bus: 'M7 3h10a2 2 0 0 1 2 2v12H5V5a2 2 0 0 1 2-2zM5 11h14M8 17v3M16 17v3M8.5 14h.01M15.5 14h.01',
  train: 'M9 3h6a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3zM6 10h12M9 13h.01M15 13h.01M8 19l-2 2M16 19l2 2',
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5',
  building: 'M5 3h14v18H5zM9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3',
  store: 'M6 8h12l-1 12H7L6 8zM9 8a3 3 0 0 1 6 0',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  volume: 'M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  'volume-off': 'M11 5 6 9H3v6h3l5 4V5zM22 9l-6 6M16 9l6 6',
  navigation: 'M12 3l7 18-7-4-7 4 7-18z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
}
</script>

<template>
  <svg
    :width="props.size" :height="props.size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    :stroke-width="props.stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon"
  ><path :d="paths[props.name]" /></svg>
</template>
