<script setup lang="ts">
/**
 * P7 抵達（獨立網址 /arrived?…）：畫面在 ArrivalCard。
 * 導航中的行程不會跳到這裡，而是直接在導航頁顯示 ArrivalCard，行程才不會中斷。
 * 「完成」回上一頁；直接開網址沒有上一頁時回導航頁，不回範本首頁。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ArrivalCard from '@/arrival/ArrivalCard.vue'
import { tripFromQuery } from '@/arrival/arrival'

const route = useRoute()
const router = useRouter()
const parsed = computed(() => tripFromQuery(route.query))

function done() {
  if (window.history.length > 1) router.back()
  else void router.push('/lab/nav')
}
</script>

<template>
  <ArrivalCard :trip="parsed.trip" :lang="parsed.lang" :audience="parsed.audience" @primary="done" />
</template>
