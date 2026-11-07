<script setup lang="ts">
/**
 * 「關於這個服務」：決選禁用簡報 → 理念、受眾、資料來源、技術做進作品裡。
 * 不要做成投影片式整頁，維持一般資訊頁樣式。清單與 microservice/README.md 第 4、5 節一致。
 */
const sources = [
  { name: '臺北市公車站位、路線與時刻', org: '交通部 TDX', url: 'https://tdx.transportdata.tw/', freq: '建置時快照' },
  { name: '臺北捷運車站與路線', org: '交通部 TDX', url: 'https://tdx.transportdata.tw/', freq: '建置時快照' },
  { name: 'OpenStreetMap 路網', org: 'OpenStreetMap contributors（ODbL）', url: 'https://www.openstreetmap.org/copyright', freq: '部署時更新' },
  { name: '20 公尺網格數值地形模型', org: '內政部', url: 'https://data.gov.tw/dataset/35430', freq: '建置時快照' },
  { name: '臺北市路燈位置分布圖', org: '臺北市政府工務局公園路燈工程管理處', url: 'https://tppkl.blob.core.windows.net/blobfs/TaipeiLight.json', freq: '建置時快照' },
  { name: '錄影監視系統設置區位', org: '臺北市政府警察局', url: 'https://data.gov.tw/dataset/130094', freq: '建置時快照' },
  { name: '警察機關名稱及地址', org: '臺北市政府警察局', url: 'https://data.gov.tw/dataset/130095', freq: '建置時快照' },
  { name: 'Overture Maps Places／Addresses', org: 'Overture Maps Foundation', url: 'https://overturemaps.org/', freq: '2026-10-21.0 版' },
  { name: 'Unicode Unihan Database、OpenCC', org: 'Unicode, Inc.／BYVoid', url: 'https://www.unicode.org/charts/unihan.html', freq: '外語地名轉換' },
]
const tech = [
  ['Vue 3 + Vite + TypeScript', 'MIT / Apache-2.0'],
  ['Tailwind CSS 4', 'MIT'],
  ['Leaflet + 國土測繪中心電子地圖', 'BSD-2 / 政府開放資料'],
  ['FastAPI（Cloud Run）', 'MIT'],
  ['Valhalla 步行路線 + OpenStreetMap', 'MIT / ODbL'],
  ['flutter_tts（語音）', 'MIT'],
  ['TownPass 城市通（Flutter）', 'GPL-3.0'],
]
</script>

<template>
  <main class="space-y-6 px-4 py-5">
    <section>
      <h1 class="text-xl font-bold">關於一箭成行</h1>
      <p class="mt-2 text-sm leading-relaxed text-gray-700">
        看不懂地圖也能走到：搜尋要去的地方（公車站牌也可以），跟著一支依路線轉彎的箭頭走過去，搭配語音和震動提示。
      </p>
    </section>

    <section>
      <h2 class="font-semibold">誰會用</h2>
      <p class="mt-1 text-sm text-gray-700">
        看不懂地圖方向的長者、第一次自己走到站牌的兒童，以及看不懂中文站名的外籍人士。
      </p>
    </section>

    <section>
      <h2 class="font-semibold">資料來源</h2>
      <ul class="mt-2 space-y-2">
        <li v-for="s in sources" :key="s.name" class="rounded-xl bg-gray-50 p-3 text-sm">
          <a :href="s.url" class="font-medium text-primary-700 underline">{{ s.name }}</a>
          <p class="text-xs text-gray-500">{{ s.org }}・{{ s.freq }}</p>
        </li>
      </ul>
      <p class="mt-2 text-xs text-gray-500">公車搭乘時間依站數估計，不是即時到站資料。</p>
    </section>

    <section>
      <h2 class="font-semibold">開源技術</h2>
      <ul class="mt-2 divide-y divide-gray-100 text-sm">
        <li v-for="[n, l] in tech" :key="n" class="flex justify-between py-2">
          <span>{{ n }}</span><span class="text-gray-500">{{ l }}</span>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="font-semibold">隱私</h2>
      <p class="mt-1 text-sm text-gray-700">
        你的位置只用來計算路線，不會出現在網址、不會被記錄或儲存；本服務不讀取你的城市通帳號資料，也不使用 AI 模型。
      </p>
    </section>

    <p class="text-xs text-gray-500">本服務原始碼以 AGPL-3.0 授權公開。</p>
  </main>
</template>
