<template>
  <div v-if="currentUser" class="admin-shell">
    <nav class="sidebar">
      <div class="logo">APP<span class="logo-sub">管理</span></div>
      <ul class="nav-list">
        <li><RouterLink to="/" class="nav-link">ダッシュボード</RouterLink></li>
        <li><RouterLink to="/site-reports" class="nav-link">現場別集計</RouterLink></li>
        <li><RouterLink to="/reports" class="nav-link">日報一覧</RouterLink></li>
        <li><RouterLink to="/workers" class="nav-link">作業員</RouterLink></li>
        <li><RouterLink to="/sites" class="nav-link">現場</RouterLink></li>
        <li><RouterLink to="/subcontractors" class="nav-link">下請け業者</RouterLink></li>
        <li><RouterLink to="/settings" class="nav-link">設定</RouterLink></li>
      </ul>
      <button class="btn-logout" @click="handleLogout">ログアウト</button>
    </nav>
    <main class="content">
      <RouterView />
    </main>
  </div>

  <!-- 未ログイン時はログイン画面のみ表示 -->
  <RouterView v-else />
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { currentUser, signOut } from './lib/auth'

const router = useRouter()

async function handleLogout() {
  await signOut()
  router.push('/login')
}
</script>

<style scoped>
.admin-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 200px; min-height: 100vh; background: #1a1a1a; color: #fff;
  display: flex; flex-direction: column; gap: 32px; padding: 24px 0; flex-shrink: 0;
  position: fixed; top: 0; left: 0; bottom: 0;
}
.logo { padding: 0 20px; font-size: 18px; font-weight: 900; letter-spacing: 4px; color: #06C755; }
.logo-sub { font-size: 11px; letter-spacing: 2px; color: #888; margin-left: 8px; font-weight: 400; }
.nav-list { list-style: none; display: flex; flex-direction: column; flex: 1; }
.nav-link { display: block; padding: 12px 20px; font-size: 14px; color: #aaa; transition: background .15s, color .15s; }
.nav-link:hover, .nav-link.router-link-exact-active { background: #2a2a2a; color: #fff; }
.nav-link.router-link-exact-active { border-left: 3px solid #06C755; }
.btn-logout {
  margin: 0 16px 8px;
  background: transparent;
  border: 1px solid #444;
  border-radius: 6px;
  color: #888;
  font-size: 13px;
  padding: 8px 12px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.btn-logout:hover { border-color: #f87171; color: #f87171; }
.content { margin-left: 200px; flex: 1; padding: 32px; min-height: 100vh; }
</style>
