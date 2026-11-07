import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    // 「關於這個服務」頁：取代簡報（理念、受眾、資料來源、架構、開源技術）
    { path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
  ],
})
