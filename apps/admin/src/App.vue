<template>
  <!-- 独自ドメイン移行: 旧ドメインアクセス時のみ案内＋自動リダイレクト（NEW_ADMIN_ORIGIN未設定なら出ない） -->
  <div v-if="migrationUrl" class="domain-migrate-overlay">
    <div class="domain-migrate-card">
      <h1>ページが移行しました</h1>
      <p>新しいURL（<b>{{ migrationUrl }}</b>）へ <b>{{ countdown }}</b> 秒後に自動で移動します。</p>
      <a :href="migrationUrl" class="domain-migrate-link">今すぐ移動する</a>
    </div>
  </div>
  <div v-if="currentUser" class="admin-shell">
    <!-- モバイル用トップバー（≤768pxで表示）-->
    <header class="topbar">
      <button class="hamburger" aria-label="メニュー" @click="drawerOpen = true">
        <span class="material-symbols-rounded">menu</span>
      </button>
      <div class="topbar-brand">GENLINKS<span class="topbar-sub">{{ accountDisplayName }}</span></div>
    </header>

    <!-- ドロワー開時のオーバーレイ -->
    <div v-if="drawerOpen" class="drawer-overlay" @click="drawerOpen = false" />

    <nav class="sidebar" :class="{ open: drawerOpen }">
      <div class="sidebar-head">
        <div class="logo">GENLINKS<span class="logo-sub">{{ accountDisplayName }}</span></div>
        <button class="drawer-close" aria-label="閉じる" @click="drawerOpen = false">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <ul class="nav-list">
        <li class="nav-section">日次</li>
        <li><RouterLink to="/" class="nav-link"><span class="material-symbols-rounded nav-icon">dashboard</span>ダッシュボード</RouterLink></li>
        <li><RouterLink to="/reports" class="nav-link"><span class="material-symbols-rounded nav-icon">list_alt</span>日報一覧</RouterLink></li>
        <li><RouterLink to="/report-edit-approvals" class="nav-link"><span class="material-symbols-rounded nav-icon">lock_open</span>日報編集の許可申請<span v-if="editApprovalCount" class="nav-badge">{{ editApprovalCount }}</span></RouterLink></li>
        <li><RouterLink to="/report-site-relink" class="nav-link"><span class="material-symbols-rounded nav-icon">link</span>現場未設定の紐付け<span v-if="siteUnsetCount" class="nav-badge">{{ siteUnsetCount }}</span></RouterLink></li>
        <li><RouterLink to="/overtime-approvals" class="nav-link"><span class="material-symbols-rounded nav-icon">more_time</span>残業申請の承認<span v-if="overtimePendingCount" class="nav-badge">{{ overtimePendingCount }}</span></RouterLink></li>
        <li><RouterLink to="/site-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">bar_chart</span>現場別集計</RouterLink></li>
        <li><RouterLink to="/calendar" class="nav-link"><span class="material-symbols-rounded nav-icon">calendar_month</span>予定管理</RouterLink></li>
        <li><RouterLink to="/process" class="nav-link"><span class="material-symbols-rounded nav-icon">view_timeline</span>工程管理</RouterLink></li>

        <li class="nav-section">勤怠</li>
        <li><RouterLink to="/worker-reports" class="nav-link"><span class="material-symbols-rounded nav-icon">badge</span>出面・勤怠</RouterLink></li>
        <li><RouterLink to="/attendance" class="nav-link"><span class="material-symbols-rounded nav-icon">login</span>出退勤ログ</RouterLink></li>
        <li><RouterLink to="/paid-leave" class="nav-link"><span class="material-symbols-rounded nav-icon">beach_access</span>有給管理</RouterLink></li>

        <li class="nav-section">見積・発注</li>
        <li><RouterLink to="/estimate-list" class="nav-link"><span class="material-symbols-rounded nav-icon">calculate</span>見積もり</RouterLink></li>
        <li><RouterLink to="/estimates" class="nav-link"><span class="material-symbols-rounded nav-icon">description</span>見積書（受領）</RouterLink></li>
        <li><RouterLink to="/purchase-orders" class="nav-link"><span class="material-symbols-rounded nav-icon">assignment</span>注文書発行</RouterLink></li>

        <li class="nav-section">経費・請求</li>
        <li><RouterLink to="/expenses" class="nav-link"><span class="material-symbols-rounded nav-icon">receipt_long</span>経費管理</RouterLink></li>
        <li><RouterLink to="/gasoline-allocation" class="nav-link"><span class="material-symbols-rounded nav-icon">local_gas_station</span>ガソリン按分</RouterLink></li>
        <li><RouterLink to="/subcontractor-invoices" class="nav-link"><span class="material-symbols-rounded nav-icon">request_quote</span>協力業者請求</RouterLink></li>

        <li class="nav-section">マスタ</li>
        <li><RouterLink to="/workers" class="nav-link"><span class="material-symbols-rounded nav-icon">engineering</span>作業員</RouterLink></li>
        <li><RouterLink to="/sites" class="nav-link"><span class="material-symbols-rounded nav-icon">location_on</span>現場</RouterLink></li>
        <li><RouterLink to="/contractors" class="nav-link"><span class="material-symbols-rounded nav-icon">apartment</span>元請け業者</RouterLink></li>
        <li><RouterLink to="/subcontractors" class="nav-link"><span class="material-symbols-rounded nav-icon">handshake</span>協力業者</RouterLink></li>
        <li><RouterLink to="/vehicles" class="nav-link"><span class="material-symbols-rounded nav-icon">directions_car</span>車両</RouterLink></li>
        <li><RouterLink to="/estimate-masters" class="nav-link"><span class="material-symbols-rounded nav-icon">price_change</span>見積マスタ・単価表</RouterLink></li>

        <li class="nav-section">管理・設定</li>
        <li><RouterLink to="/ai-help" class="nav-link"><span class="material-symbols-rounded nav-icon">support_agent</span>AIヘルプ</RouterLink></li>
        <li><RouterLink to="/non-submitters" class="nav-link"><span class="material-symbols-rounded nav-icon">person_off</span>未送信者リスト</RouterLink></li>
        <li v-if="!HIDE_LINE_SECTIONS"><RouterLink to="/reminder-history" class="nav-link"><span class="material-symbols-rounded nav-icon">history</span>リマインド履歴</RouterLink></li>
        <li><RouterLink to="/operation-logs" class="nav-link"><span class="material-symbols-rounded nav-icon">receipt_long</span>操作ログ</RouterLink></li>
        <li v-if="!HIDE_LINE_SECTIONS"><RouterLink to="/users" class="nav-link"><span class="material-symbols-rounded nav-icon">manage_accounts</span>ユーザー</RouterLink></li>
        <li><RouterLink to="/company-profile" class="nav-link"><span class="material-symbols-rounded nav-icon">business</span>自社情報</RouterLink></li>
        <li><RouterLink to="/settings" class="nav-link"><span class="material-symbols-rounded nav-icon">settings</span>設定</RouterLink></li>
      </ul>
      <button class="btn-logout" @click="handleLogout">ログアウト</button>
    </nav>
    <main class="content">
      <RouterView />
    </main>

    <!-- どのページでも右下に常駐するAIヘルプ（ログイン中のみ・遷移で消えない） -->
    <AiHelpWidget />
  </div>

  <!-- 未ログイン時はログイン画面のみ表示 -->
  <RouterView v-else />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { currentUser, signOut } from './lib/auth'
import { getAccountName } from './lib/account'
import { editApprovalCount, siteUnsetCount, overtimePendingCount, refreshNavBadges } from './lib/navBadges'
import { HIDE_LINE_SECTIONS } from './lib/featureFlags'
import { migrationTargetUrl, REDIRECT_SECONDS } from './lib/domainMigration'
import AiHelpWidget from './components/AiHelpWidget.vue'

// 独自ドメイン移行: 旧ドメインアクセス時のみ案内＋5秒後リダイレクト（既定オフ＝NEW_ADMIN_ORIGIN空）。
const migrationUrl = ref<string | null>(migrationTargetUrl())
const countdown    = ref(REDIRECT_SECONDS)
onMounted(() => {
  if (!migrationUrl.value) return
  const timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) { clearInterval(timer); window.location.replace(migrationUrl.value!) }
  }, 1000)
})

// ヘッダー: メイン=プロダクト名 GENLINKS 固定、サブ=会社名(account名・データ)
const accountDisplayName = ref('')

// サイト名（ブラウザタブ）= プロダクト名 GENLINKS 固定＋会社名（データ）を併記。
// fetch が解決してからセットする（未取得での空振りを避ける）。
async function refreshTitle() {
  const name = await getAccountName()
  accountDisplayName.value = name || ''
  document.title = name ? `${name}｜GENLINKS` : 'GENLINKS'
}
onMounted(refreshTitle)
// ログインユーザー（テナント）が変わったらタイトルも更新（マルチテナント）
watch(currentUser, refreshTitle)

const router = useRouter()
const route  = useRoute()

// 画面遷移したらドロワーを閉じる
const drawerOpen = ref(false)
watch(() => route.path, () => { drawerOpen.value = false })

// ── ナビ未処理バッジ（共有ストア navBadges.ts）。処理画面は refreshNavBadges() を直接呼ぶ ──
onMounted(refreshNavBadges)
watch(currentUser, refreshNavBadges)
// 画面遷移のたびに再取得（許可/紐付け/残業を処理した後にバッジが減るように）
watch(() => route.path, refreshNavBadges)

async function handleLogout() {
  await signOut()
  router.push('/login')
}
</script>

<style scoped>
.admin-shell { display: flex; min-height: 100vh; }

/* 独自ドメイン移行の案内オーバーレイ */
.domain-migrate-overlay { position: fixed; inset: 0; z-index: 9999; background: #0f172a; display: flex; align-items: center; justify-content: center; padding: 24px; }
.domain-migrate-card { background: #fff; border-radius: 16px; padding: 32px 28px; max-width: 480px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.domain-migrate-card h1 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
.domain-migrate-card p { font-size: 14px; line-height: 1.7; color: #475569; margin-bottom: 20px; word-break: break-all; }
.domain-migrate-link { display: inline-block; background: #06C755; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 700; }

/* ── モバイル用トップバー（既定は非表示）── */
.topbar { display: none; }

.sidebar {
  width: 200px; min-height: 100vh; background: #1a1a1a; color: #fff;
  display: flex; flex-direction: column; gap: 32px; padding: 24px 0; flex-shrink: 0;
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
}
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
.logo { font-size: 18px; font-weight: 900; letter-spacing: 4px; color: #06C755; display: flex; flex-direction: column; align-items: flex-start; line-height: 1.25; }
.logo-sub { font-size: 11px; letter-spacing: normal; color: #888; margin-left: 0; margin-top: 3px; font-weight: 500; }
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
/* ナビ未処理バッジ（右寄せの赤丸カウント） */
.nav-badge {
  margin-left: auto; flex-shrink: 0;
  min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  background: #ef4444; color: #fff; border-radius: 9px;
  font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
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
.content { margin-left: 200px; flex: 1; min-width: 0; padding: 32px; min-height: 100vh; }

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
  .topbar-sub { font-size: 10px; letter-spacing: normal; color: #888; margin-left: 6px; font-weight: 400; }

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
