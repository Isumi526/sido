<template>
  <!-- 独自ドメイン移行: 旧ドメインアクセス時のみ案内＋自動リダイレクト（NEW_ADMIN_ORIGIN未設定なら出ない） -->
  <div v-if="migrationUrl" class="domain-migrate-overlay">
    <div class="domain-migrate-card">
      <h1>ページが移行しました</h1>
      <p>新しいURL（<b>{{ migrationUrl }}</b>）へ <b>{{ countdown }}</b> 秒後に自動で移動します。</p>
      <a :href="migrationUrl" class="domain-migrate-link">今すぐ移動する</a>
    </div>
  </div>
  <!-- 権限解決待ち（ロックアウト/素通しを防ぐためフリッカー回避） -->
  <div v-if="currentUser && !roleResolved" class="access-gate">
    <div class="gate-card"><div class="gate-spinner" /></div>
  </div>
  <!-- 現場管理者・作業員は管理画面の利用不可 -->
  <div v-else-if="currentUser && !isAdminAllowed" class="access-gate">
    <div class="gate-card">
      <span class="material-symbols-rounded gate-icon">block</span>
      <h1 class="gate-title">この画面を利用する権限がありません</h1>
      <p class="gate-text">管理画面はオーナー・役員・経理のみ利用できます。<br>作業員の方は下のボタンから作業員アプリをご利用ください。</p>
      <a class="gate-liff" :href="liffUrl">作業員アプリを開く →</a>
      <button class="gate-logout-link" @click="handleLogout">ログアウト</button>
    </div>
  </div>
  <div v-else-if="currentUser" class="admin-shell">
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
      <div class="sidebar-user" data-testid="sidebar-user">
        <div class="sidebar-user-avatar">{{ (currentWorkerName || currentUser?.email || '?').charAt(0) }}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">{{ currentWorkerName || currentUser?.email || '—' }}</div>
          <div class="sidebar-user-role">{{ roleLabel(currentRole) }}</div>
        </div>
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
        <li><RouterLink to="/paid-leave" class="nav-link"><span class="material-symbols-rounded nav-icon">beach_access</span>有給管理<span v-if="pendingGrantCount" class="nav-badge">{{ pendingGrantCount }}</span></RouterLink></li>

        <li class="nav-section">見積・発注</li>
        <li><RouterLink to="/estimate-list" class="nav-link"><span class="material-symbols-rounded nav-icon">calculate</span>見積もり</RouterLink></li>
        <li><RouterLink to="/estimates" class="nav-link"><span class="material-symbols-rounded nav-icon">description</span>見積書（受領）</RouterLink></li>
        <li><RouterLink to="/purchase-orders" class="nav-link"><span class="material-symbols-rounded nav-icon">assignment</span>注文書発行</RouterLink></li>
        <li><RouterLink to="/drawing-materials" class="nav-link"><span class="material-symbols-rounded nav-icon">architecture</span>実施図面 材料抽出(AI)</RouterLink></li>

        <li class="nav-section">経費・請求</li>
        <li><RouterLink to="/expenses" class="nav-link"><span class="material-symbols-rounded nav-icon">receipt_long</span>経費管理</RouterLink></li>
        <li><RouterLink to="/expenses-daily" class="nav-link"><span class="material-symbols-rounded nav-icon">calendar_view_day</span>経費 日毎集計</RouterLink></li>
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
        <li v-if="!HIDE_AI_HELP_SECTIONS"><RouterLink to="/ai-help" class="nav-link"><span class="material-symbols-rounded nav-icon">support_agent</span>AIヘルプ</RouterLink></li>
        <li v-if="!HIDE_AI_HELP_SECTIONS"><RouterLink to="/faq" class="nav-link"><span class="material-symbols-rounded nav-icon">quiz</span>FAQナレッジ</RouterLink></li>
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
    <AiHelpWidget v-if="!HIDE_AI_HELP_SECTIONS" />
  </div>

  <!-- 未ログイン時はログイン画面のみ表示 -->
  <RouterView v-else />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { currentUser, currentRole, currentWorkerName, signOut, isAdminAllowed, roleResolved, roleLabel } from './lib/auth'
import { liffAppUrl } from './lib/links'
import { getAccountName } from './lib/account'
import { editApprovalCount, siteUnsetCount, overtimePendingCount, pendingGrantCount, refreshNavBadges } from './lib/navBadges'
import { HIDE_LINE_SECTIONS, HIDE_AI_HELP_SECTIONS } from './lib/featureFlags'
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

// 権限ガード拒否画面から作業員アプリ(LIFF)へ誘導するURL（環境差を吸収）
const liffUrl = liffAppUrl()

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

/* 権限ガード画面（現場担当者・職人 / 解決待ち） */
.access-gate { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f1f5f9; padding: 24px; }
.gate-card { background: #fff; border-radius: 16px; padding: 36px 32px; max-width: 420px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
.gate-icon { font-size: 48px; color: #ef4444; }
.gate-title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 12px 0 8px; }
.gate-text { font-size: 13px; color: #64748b; line-height: 1.8; margin: 0 0 20px; }
.gate-liff { display: inline-block; background: #06C755; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 28px; font-size: 15px; font-weight: 700; }
.gate-logout-link { display: block; margin: 14px auto 0; background: none; border: none; color: #94a3b8; font-size: 13px; text-decoration: underline; cursor: pointer; }
.gate-spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #06C755; border-radius: 50%; animation: gate-spin .8s linear infinite; margin: 0 auto; }
@keyframes gate-spin { to { transform: rotate(360deg); } }

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
.sidebar-user { display: flex; align-items: center; gap: 10px; padding: 10px 20px; margin: -16px 0; }
.sidebar-user-avatar { flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; background: #06C755; color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.sidebar-user-info { min-width: 0; }
.sidebar-user-name { font-size: 13px; font-weight: 700; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-user-role { font-size: 11px; color: #888; }
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
