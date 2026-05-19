import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initAuth } from './lib/auth'
import './style.css'

async function main() {
  await initAuth()           // セッション復元 → currentUser をセット
  createApp(App).use(router).mount('#app')
}

main()
