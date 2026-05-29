<template>
  <div v-if="currentUser" class="admin-shell">
    <nav class="sidebar">
      <div class="logo">{{ brandName }}<span class="logo-sub">管理</span></div>
      <ul class="nav-list">
        <li class="nav-section">レポート</li>
        <li><RouterLink to="/" class="nav-link"><span class="material-symbols-rounded nav-icon">dashboard</span>ダッシュボード</RouterLink></li>
        <li><RouterLink to="/reports" class="nav-link"><span class="material-symbols-rounded nav-icon">list_alt</span>日報一覧</RouterLink></li>
        <li><RouterLink to="/worker-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">badge</span>出面・勤怠</RouterLink></li>
        <li><RouterLink to="/paid-leave" class="nav-link"><span class="material-symbols-rounded nav-icon">beach_access</span>有給管理</RouterLink></li>
        <li><RouterLink to="/site-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">bar_chart</span>現場別集計</RouterLink></li>
        <li><RouterLink to="/calendar" class="nav-link"><span class="material-symbols-rounded nav-icon">calendar_month</span>予定管理</RouterLink></li>

        <li class="nav-section">出退勤</li>
        <li><RouterLink to="/attendance" class="nav-link"><span class="material-symbols-rounded nav-icon">login</span>出退勤ログ</RouterLink></li>

        <li class="nav-section">マスタ</li>
        <li><RouterLink to="/workers" class="nav-link"><span class="material-symbols-rounded nav-icon">engineering</span>作業員</RouterLink></li>
        <li><RouterLink to="/sites" class="nav-link"><span class="material-symbols-rounded nav-icon">location_on</span>現場</RouterLink></li>
        <li><RouterLink to="/subcontractors" class="nav-link"><span class="material-symbols-rounded nav-icon">handshake</span>下請け業者</RouterLink></li>

        <li class="nav-section">管理</li>
        <li><RouterLink to="/users" class="nav-link"><span class="material-symbols-rounded nav-icon">manage_accounts</span>ユーザー</RouterLink></li>
        <li><RouterLink to="/settings" class="nav-link"><span class="material-symbols-rounded nav-icon">settings</span>設定</RouterLink></li>
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
import { ACCOUNT_SLUG } from './lib/account'

const brandName = ACCOUNT_SLUG.toUpperCase()

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
.nav-list { list-style: none; display: flex; flex-direction: column; flex: 1; padding: 0; margin: 0; overflow-y: auto; }
.nav-section {
  padding: 16px 20px 4px;
  font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
  color: #555; text-transform: uppercase;
}
.nav-link {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px; font-size: 13px; color: #aaa;
  transition: background .15s, color .15s;
}
.nav-link:hover { background: #2a2a2a; color: #ddd; }
.nav-link.router-link-exact-active { background: #2a2a2a; color: #fff; border-left: 3px solid #06C755; padding-left: 17px; }
.nav-icon {
  font-size: 18px; flex-shrink: 0;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}
.router-link-exact-active .nav-icon {
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
  color: #06C755;
}
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

@media print {
  .sidebar { display: none !important; }
  .content { margin-left: 0 !important; padding: 0 !important; }
}
</style>
