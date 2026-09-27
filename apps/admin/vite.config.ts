import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 独自ドメイン(genlinks.app)配下で client=/ ・ admin=/admin として運用するため、
// 本番ビルドのみ base を /admin/ にする(dev serverは従来どおり / のまま=ローカル開発フローに影響なし)。
// ★vue-router の createWebHistory() は引数なしだと '/' 基準（BASE_URL は使わない）。/admin/* で開いた時の基準は
//  router/index.ts が開いた場所で決める（2026-09-27 修正。以前ここに「router側の変更は不要」と書いていたのは誤り）。
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'build' ? '/admin/' : '/',
  server: { port: 3001 },
}))
