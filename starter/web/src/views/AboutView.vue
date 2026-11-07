<script setup lang="ts">
/**
 * 「關於這個服務」：決選禁用簡報 → 理念、受眾、資料來源、技術做進作品裡。
 * 不要做成投影片式整頁，維持一般資訊頁樣式。
 */
const sources = [
  { name: '（資料集名稱）', org: '（提供機關）', url: 'https://data.taipei', freq: '（更新頻率）' },
]
const tech = [
  ['Vue 3 + Vite + TypeScript', 'MIT'],
  ['Tailwind CSS 4', 'MIT'],
  ['Leaflet + 國土測繪中心電子地圖', 'BSD-2 / 政府開放資料'],
  ['FastAPI（Cloud Run）', 'MIT'],
  ['TownPass 城市通（Flutter）', 'GPL-3.0'],
]
</script>

<template>
  <main class="space-y-6 px-4 py-5">
    <section>
      <h1 class="text-xl font-bold">關於這個服務</h1>
      <p class="mt-2 text-sm leading-relaxed text-gray-700">（理念：幫＿＿在＿＿情境解決＿＿）</p>
    </section>

    <section>
      <h2 class="font-semibold">誰會用</h2>
      <p class="mt-1 text-sm text-gray-700">（目標使用者）</p>
    </section>

    <section>
      <h2 class="font-semibold">資料來源</h2>
      <ul class="mt-2 space-y-2">
        <li v-for="s in sources" :key="s.name" class="rounded-xl bg-gray-50 p-3 text-sm">
          <a :href="s.url" class="font-medium text-primary-700 underline">{{ s.name }}</a>
          <p class="text-xs text-gray-500">{{ s.org }}・{{ s.freq }}</p>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="font-semibold">開源技術</h2>
      <ul class="mt-2 divide-y divide-gray-100 text-sm">
        <li v-for="[n, l] in tech" :key="n" class="flex justify-between py-2">
          <span>{{ n }}</span><span class="text-gray-500">{{ l }}</span>
        </li>
      </ul>
    </section>

    <p class="text-xs text-gray-500">本服務原始碼以 AGPL-3.0 授權公開。</p>
  </main>
</template>
