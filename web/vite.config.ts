import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // cloudflared / ngrok tunnel 給手機 App 看時需要
    allowedHosts: true,
    // 本機開發：/api 轉到本機 FastAPI（正式環境由 firebase.json rewrite 到 Cloud Run）；
    // 8080 被占用時可用 API_PROXY_TARGET=http://localhost:8081 指到別的埠
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:8080' },
  },
})
