import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const prototypeSrc = path.resolve(fileURLToPath(new URL('./src', import.meta.url)))
/** 隊伍正式前端 web/：重用它的搜尋程式（連鎖店、站牌、地址）與資料快照，不另外複製一份 */
const teamWeb = path.resolve(fileURLToPath(new URL('../../web', import.meta.url)))
const teamSrc = path.join(teamWeb, 'src')

/**
 * @/… 的解析：從 web/src 檔案裡發出的 import 解析到 web/src，其餘解析到原型自己的 src；
 * @team/… 一律解析到 web/src（原型用它來引用隊伍的模組）。
 */
function teamAliases(): Plugin {
  return {
    name: 'team-aliases',
    enforce: 'pre',
    async resolveId(source, importer) {
      let base: string | null = null
      let rest = ''
      if (source.startsWith('@team/')) { base = teamSrc; rest = source.slice(6) }
      else if (source.startsWith('@/')) { base = importer && path.resolve(importer).startsWith(teamSrc) ? teamSrc : prototypeSrc; rest = source.slice(2) }
      if (!base) return null
      const target = path.join(base, rest).split(path.sep).join('/')
      return (await this.resolve(target, importer, { skipSelf: true })) ?? target
    },
  }
}

export default defineConfig({
  plugins: [teamAliases(), vue(), tailwindcss()],
  // 轉譯 web/src 的檔案時也用原型的 tsconfig（web/ 沒裝 node_modules，找不到它 extends 的 @vue/tsconfig）
  tsconfig: './tsconfig.app.json',
  // /lab/poi_index.json、/lab/stop_index.json 直接用 web/public 的快照
  publicDir: path.join(teamWeb, 'public'),
  server: {
    fs: { allow: [path.resolve(fileURLToPath(new URL('.', import.meta.url))), teamWeb] },
    // cloudflared / ngrok tunnel 給手機 App 看時需要
    allowedHosts: true,
    // 本機開發：/api 轉到本機 FastAPI（正式環境由 firebase.json rewrite 到 Cloud Run）
    proxy: { '/api': 'http://localhost:8080' },
  },
})
