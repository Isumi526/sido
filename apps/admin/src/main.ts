import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initAuth } from './lib/auth'
import './style.css'

// 接続中の Supabase ホストを起動時に1行表示する保険（localhost:54321=LOCAL / *.supabase.co=CLOUD）。
// ※ local dev のみの話。Vercel(preview/prod) は Vercel 環境変数を使うため挙動には無関係。
{
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || '(unset)'
  let host = url
  try { host = new URL(url).host } catch { /* keep raw */ }
  const isLocal = /localhost|127\.0\.0\.1/.test(url)
  console.log(
    `%c[Supabase] ${host} ${isLocal ? '🟢 LOCAL' : '☁️ CLOUD'}`,
    `color:${isLocal ? '#06C755' : '#e67e22'};font-weight:bold`,
  )
}

async function main() {
  await initAuth()           // セッション復元 → currentUser をセット
  createApp(App).use(router).mount('#app')
}

main()
