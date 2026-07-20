import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 独自ドメイン(genlinks.app)配下で client=/ ・ admin=/admin として運用するため、
// 本番ビルドのみ base を /admin/ にする(dev serverは従来どおり / のまま=ローカル開発フローに影響なし)。
// vue-router の createWebHistory() は import.meta.env.BASE_URL を既定値に使うため、router側の変更は不要。
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'build' ? '/admin/' : '/',
  server: { port: 3001 },
}))
