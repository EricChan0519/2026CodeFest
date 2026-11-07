import { createRouter, createWebHistory } from 'vue-router'
import ArrowView from './views/arrow/ArrowView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 主畫面：跟著箭頭走（開場 → 語言、使用者 → 搜尋 → 怎麼去 → 導航 → 到站、坐車、抵達）
    { path: '/', name: 'home', component: ArrowView },
    // 舊網址（yuchuan_ui_v4 的 UI 展示頁）
    { path: '/arrow', redirect: (to) => ({ path: '/', query: to.query }) },
    // P7 抵達：路線資訊由 arrivalLocation() 帶入，網址不放座標
    { path: '/arrived', name: 'arrived', component: () => import('./views/ArrivedView.vue') },
    // NAV 實驗頁：手機上測羅盤、定位與導航（不在主流程內）
    { path: '/lab/sensors', name: 'lab-sensors', component: () => import('./views/lab/SensorLab.vue') },
    { path: '/lab/nav', name: 'lab-nav', component: () => import('./views/lab/NavLab.vue') },
    // 範本骨架頁：後端連線、App 定位、地圖、推播的測試（原本的首頁）
    { path: '/lab/starter', name: 'lab-starter', component: () => import('./views/HomeView.vue') },
    // 「關於這個服務」頁：取代簡報（理念、受眾、資料來源、架構、開源技術）
    { path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
  ],
})
