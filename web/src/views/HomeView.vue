<script setup lang="ts">
/**
 * 骨架示範頁（與題目無關）：後端連線、App 定位、地圖、推播。
 * 題目公布後整頁替換成主流程第一屏。
 */
import { onMounted, ref } from 'vue'
import DataSource from '@/components/DataSource.vue'
import MapView, { type MapPoint } from '@/components/MapView.vue'
import StateView from '@/components/StateView.vue'
import { useAsync } from '@/composables/useAsync'
import { api } from '@/lib/api'
import { isInTownPass, tp } from '@/lib/townpass-bridge'

interface Health { ok: boolean; revision: string }

const health = useAsync(() => api<Health>('/api/health'))
const me = ref<{ lat: number; lng: number } | null>(null)
const points = ref<MapPoint[]>([{ id: 1, lat: 25.0375, lng: 121.5637, label: '臺北市政府' }])
const locating = ref(false)

async function locate() {
  locating.value = true
  try {
    const pos = await tp.location()
    if (pos) me.value = { lat: pos.latitude, lng: pos.longitude }
  } finally {
    locating.value = false
  }
}

onMounted(() => {
  health.run()
})
</script>

<template>
  <main class="flex h-full flex-col">
    <section class="px-4 pt-4 pb-3">
      <h1 class="text-xl font-bold">服務名稱</h1>
      <p class="mt-1 text-sm text-gray-600">一句話說明這個服務幫誰、解決什麼。</p>
      <p class="mt-2 text-xs text-gray-500">
        環境：{{ isInTownPass() ? '城市通 App' : '瀏覽器（mock）' }}
      </p>
    </section>

    <div class="relative h-72 shrink-0">
      <MapView :points="points" :me="me" />
      <button
        class="absolute right-3 bottom-3 z-[500] min-h-12 rounded-full bg-white px-4 text-sm font-medium text-primary-600 shadow-card"
        :disabled="locating"
        @click="locate"
      >
        {{ locating ? '定位中…' : '我的位置' }}
      </button>
    </div>

    <section class="flex-1 overflow-y-auto px-4 py-4">
      <div class="rounded-2xl bg-white p-4 shadow-card">
        <h2 class="font-semibold">後端連線</h2>
        <StateView :loading="health.loading.value" :error="health.error.value" @retry="health.run()">
          <p class="mt-2 text-sm text-gray-700">
            /api/health：{{ health.data.value?.ok ? '正常' : '—' }}（{{ health.data.value?.revision }}）
          </p>
        </StateView>
      </div>

      <div class="mt-4 flex gap-3">
        <button
          class="min-h-12 flex-1 rounded-full bg-primary-500 font-medium text-white active:bg-primary-600"
          @click="tp.notify('測試通知', '來自微服務的推播')"
        >
          測試推播
        </button>
        <RouterLink
          to="/about"
          class="flex min-h-12 flex-1 items-center justify-center rounded-full border border-primary-500 font-medium text-primary-600"
        >
          關於這個服務
        </RouterLink>
      </div>
    </section>

    <DataSource :sources="[{ name: '臺北市資料大平臺', url: 'https://data.taipei' }]" :updated-at="new Date()" />
  </main>
</template>
