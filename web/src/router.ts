import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    // NAV 實驗頁：手機上測羅盤、定位與導航（不在主流程內）
    { path: '/lab/sensors', name: 'lab-sensors', component: () => import('./views/lab/SensorLab.vue') },
    { path: '/lab/nav', name: 'lab-nav', component: () => import('./views/lab/NavLab.vue') },
    // 「關於這個服務」頁：取代簡報（理念、受眾、資料來源、架構、開源技術）
    { path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
  ],
})
