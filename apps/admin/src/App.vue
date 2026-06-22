<template>
  <div v-if="currentUser" class="admin-shell">
    <!-- モバイル用トップバー（≤768pxで表示）-->
    <header class="topbar">
      <button class="hamburger" aria-label="メニュー" @click="drawerOpen = true">
        <span class="material-symbols-rounded">menu</span>
      </button>
      <div class="topbar-brand">{{ brandName }}<span class="topbar-sub">管理</span></div>
    </header>

    <!-- ドロワー開時のオーバーレイ -->
    <div v-if="drawerOpen" class="drawer-overlay" @click="drawerOpen = false" />

    <nav class="sidebar" :class="{ open: drawerOpen }">
      <div class="sidebar-head">
        <div class="logo">{{ brandName }}<span class="logo-sub">管理</span></div>
        <button class="drawer-close" aria-label="閉じる" @click="drawerOpen = false">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <ul class="nav-list">
        <li class="nav-section">レポート</li>
        <li><RouterLink to="/" class="nav-link"><span class="material-symbols-rounded nav-icon">dashboard</span>ダッシュボード</RouterLink></li>
        <li><RouterLink to="/reports" class="nav-link"><span class="material-symbols-rounded nav-icon">list_alt</span>日報一覧</RouterLink></li>
        <li><RouterLink to="/worker-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">badge</span>出面・勤怠</RouterLink></li>
        <li><RouterLink to="/paid-leave" class="nav-link"><span class="material-symbols-rounded nav-icon">beach_access</span>有給管理</RouterLink></li>
        <li><RouterLink to="/site-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">bar_chart</span>現場別集計</RouterLink></li>
        <li><RouterLink to="/expenses" class="nav-link"><span class="material-symbols-rounded nav-icon">receipt_long</span>経費管理</RouterLink></li>
        <li><RouterLink to="/estimates-list" class="nav-link"><span class="material-symbols-rounded nav-icon">calculate</span>見積もり</RouterLink></li>
        <li><RouterLink to="/estimates" class="nav-link"><span class="material-symbols-rounded nav-icon">description</span>見積書</RouterLink></li>
        <li><RouterLink to="/purchase-orders" class="nav-link"><span class="material-symbols-rounded nav-icon">assignment</span>注文書発行</RouterLink></li>
        <li><RouterLink to="/subcontractor-invoices" class="nav-link"><span class="material-symbols-rounded nav-icon">request_quote</span>下請け請求</RouterLink></li>
        <li><RouterLink to="/calendar" class="nav-link"><span class="material-symbols-rounded nav-icon">calendar_month</span>予定管理</RouterLink></li>

        <li class="nav-section">出退勤</li>
        <li><RouterLink to="/attendance" class="nav-link"><span class="material-symbols-rounded nav-icon">login</span>出退勤ログ</RouterLink></li>

        <li class="nav-section">マスタ</li>
        <li><RouterLink to="/workers" class="nav-link"><span class="material-symbols-rounded nav-icon">engineering</span>作業員</RouterLink></li>
        <li><RouterLink to="/sites" class="nav-link"><span class="material-symbols-rounded nav-icon">location_on</span>現場</RouterLink></li>
        <li><RouterLink to="/contractors" class="nav-link"><span class="material-symbols-rounded nav-icon">apartment</span>元請け業者</RouterLink></li>
        <li><RouterLink to="/subcontractors" class="nav-link"><span class="material-symbols-rounded nav-icon">handshake</span>下請け業者</RouterLink></li>
        <li><RouterLink to="/vehicles" class="nav-link"><span class="material-symbols-rounded nav-icon">directions_car</span>車両</RouterLink></li>

        <li class="nav-section">管理</li>
        <li><RouterLink to="/users" class="nav-link"><span class="material-symbols-rounded nav-icon">manage_accounts</span>ユーザー</RouterLink></li>
        <li><RouterLink to="/non-submitters" class="nav-link"><span class="material-symbols-rounded nav-icon">person_off</span>未送信者リスト</RouterLink></li>
        <li><RouterLink to="/reminder-history" class="nav-link"><span class="material-symbols-rounded nav-icon">history</span>リマインド履歴</RouterLink></li>
        <li><RouterLink to="/company-profile" class="nav-link"><span class="material-symbols-rounded nav-icon">badge</span>自社情報</RouterLink></li>
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
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { currentUser, signOut } from './lib/auth'
import { getAccountSlug, getAccountName } from './lib/account'

// ログインユーザーのテナントに追従（マルチテナント：app_metadata.account_slug 優先）
const brandName = computed(() => getAccountSlug().toUpperCase())

// サイト名（ブラウザタブ）を会社名ベースで設定。
// fetch が解決してからセットする（未取得での空振りを避ける）。
async function refreshTitle() {
  const name = await getAccountName()
  if (name) document.title = `${name}｜管理システム`
}
onMounted(refreshTitle)
// ログインユーザー（テナント）が変わったらタイトルも更新（マルチテナント）
watch(currentUser, refreshTitle)

const router = useRouter()
const route  = useRoute()

// 画面遷移したらドロワーを閉じる
const drawerOpen = ref(false)
watch(() => route.path, () => { drawerOpen.value = false })

async function handleLogout() {
  await signOut()
  router.push('/login')
}
</script>

<style scoped>
.admin-shell { display: flex; min-height: 100vh; }

/* ── モバイル用トップバー（既定は非表示）── */
.topbar { display: none; }

.sidebar {
  width: 200px; min-height: 100vh; background: #1a1a1a; color: #fff;
  display: flex; flex-direction: column; gap: 32px; padding: 24px 0; flex-shrink: 0;
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
}
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
.logo { font-size: 18px; font-weight: 900; letter-spacing: 4px; color: #06C755; }
.logo-sub { font-size: 11px; letter-spacing: 2px; color: #888; margin-left: 8px; font-weight: 400; }
.drawer-close { display: none; background: none; border: none; color: #888; cursor: pointer; padding: 4px; }
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

.drawer-overlay { display: none; }

/* ── スマホ（≤768px）── */
@media (max-width: 768px) {
  .topbar {
    display: flex; align-items: center; gap: 12px;
    position: sticky; top: 0; z-index: 40;
    height: 52px; padding: 0 12px;
    background: #1a1a1a; color: #fff;
  }
  .hamburger {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px;
    background: none; border: none; color: #fff; cursor: pointer;
  }
  .hamburger .material-symbols-rounded { font-size: 26px; }
  .topbar-brand { font-size: 16px; font-weight: 900; letter-spacing: 3px; color: #06C755; }
  .topbar-sub { font-size: 10px; letter-spacing: 1px; color: #888; margin-left: 6px; font-weight: 400; }

  .admin-shell { display: block; }

  /* サイドバーをオフキャンバスのドロワーに */
  .sidebar {
    transform: translateX(-100%);
    transition: transform .25s ease;
    width: 264px; gap: 20px; padding-top: 16px;
    box-shadow: 2px 0 16px rgba(0,0,0,.4);
  }
  .sidebar.open { transform: translateX(0); }
  .drawer-close { display: block; }

  .drawer-overlay {
    display: block; position: fixed; inset: 0;
    background: rgba(0,0,0,.5); z-index: 45;
  }

  .nav-link { padding: 13px 20px; font-size: 15px; }   /* タップしやすく */
  .nav-section { padding-top: 14px; }

  .content { margin-left: 0; padding: 16px 14px; }
}

@media print {
  .topbar, .sidebar, .drawer-overlay { display: none !important; }
  .content { margin-left: 0 !important; padding: 0 !important; }
}
</style>
