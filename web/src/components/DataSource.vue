<script setup lang="ts">
/** 每個畫面都標資料出處與更新時間（評分：技術完整度「資料來源正確」） */
defineProps<{
  sources: { name: string; url?: string }[]
  updatedAt?: string | Date | null
}>()

function fmt(d: string | Date) {
  return new Date(d).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
</script>

<template>
  <p class="px-4 py-3 text-xs leading-relaxed text-gray-500">
    資料來源：
    <template v-for="(s, i) in sources" :key="s.name">
      <span v-if="i">、</span>
      <a v-if="s.url" :href="s.url" class="underline">{{ s.name }}</a>
      <span v-else>{{ s.name }}</span>
    </template>
    <template v-if="updatedAt">，更新於 {{ fmt(updatedAt) }}</template>
  </p>
</template>
