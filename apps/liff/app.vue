<template>
  <!-- 独自ドメイン移行: 旧ドメイン直アクセス時のみ案内＋自動リダイレクト（NEW_LIFF_ORIGIN未設定なら出ない） -->
  <div v-if="migrationUrl" class="domain-migrate-overlay">
    <div class="domain-migrate-card">
      <h1>ページが移行しました</h1>
      <p>新しいURL（<b>{{ migrationUrl }}</b>）へ <b>{{ migrationCountdown }}</b> 秒後に自動で移動します。</p>
      <a :href="migrationUrl" class="domain-migrate-link">今すぐ移動する</a>
    </div>
  </div>
  <!-- LIFF初期化中はスプラッシュ画面を表示（業者ポータル /p/ ・ログイン /login はLIFFを経由しない） -->
  <div v-else-if="!isExempt && !liff.initialized.value" class="splash">
    <div class="splash-logo">SIDO</div>
    <div class="splash-spinner"></div>
  </div>
  <NuxtPage v-else />
</template>

<script setup lang="ts">
const liff = useLiff()
const route = useRoute()

// 独自ドメイン移行: 旧ドメイン直アクセス時のみ案内＋5秒後リダイレクト（既定オフ＝NEW_LIFF_ORIGIN空）。
const migrationUrl       = ref<string | null>(liffMigrationTargetUrl())
const migrationCountdown = ref(REDIRECT_SECONDS)
onMounted(() => {
  if (!migrationUrl.value) return
  const timer = setInterval(() => {
    migrationCountdown.value -= 1
    if (migrationCountdown.value <= 0) { clearInterval(timer); window.location.replace(migrationUrl.value!) }
  }, 1000)
})
// 業者向けトークンポータル(/p/:token)・email/pwログイン(/login)・現場チャット非ユーザー招待
// (/chat-invite/:token) は LINE ログイン誘導を行わない（LIFF未登録者がブラウザで直接開くため）。
const isPortal      = computed(() => route.path.startsWith('/p/'))
const isLogin       = computed(() => route.path.startsWith('/login'))
const isChatInvite  = computed(() => route.path.startsWith('/chat-invite/'))
const isExempt = computed(() => isPortal.value || isLogin.value || isChatInvite.value)

// サイト名（ブラウザタブ／共有タイトル）= プロダクト名 GENLINKS 固定＋会社名（データ）を併記。
// accounts.name 取得前は 'GENLINKS' をフォールバック表示。
// ★ /login は全テナント共通の入口＝ログイン前に env(デプロイ)のテナント名を出さない（誤誘導防止）。
const { getAccountId, accountName } = useAccount()
useHead({
  title: () => isLogin.value
    ? '作業員ログイン｜GENLINKS'
    : (accountName.value ? `${accountName.value}｜GENLINKS` : 'GENLINKS'),
})

onMounted(() => {
  // 会社名は LIFF init に依存しない（Supabase anon クエリのみ）。
  // /login では env テナントを解決・表示しない（ログイン後に身元のアカウントで解決される）。
  if (!isLogin.value) getAccountId()
})

// 非exemptなルートに居る/遷移した時に LIFF（またはemail/pwセッション）初期化を行う。
// /login(exempt)→/(非exempt) のクライアント遷移でも初期化が走るよう watch で監視
// （onMounted は初回しか発火しないため、ログイン後の遷移で splash が残るのを防ぐ）。
watch(isExempt, async (exempt) => {
  if (!exempt && !liff.initialized.value) {
    await liff.init()
    await routeFromLiffState()
  }
}, { immediate: true })

// 現場QR(本番 = liff.line.me/<LIFF_ID>/checkin/<id>)を LINE外ブラウザ(email/pw作業員等)で開くと
// エンドポイントには /?liff.state=/checkin/<id> の形で着地する。email/pwセッションは init で
// 早期returnし LIFF SDK を通らない＝liff.state が消費されずホームに留まるため、ここで同一オリジンの
// パスへ自前で遷移させる。LINE経由で既に目的パスへ replaceState 済みなら route.path が '/' でなく no-op。
async function routeFromLiffState() {
  if (typeof window === 'undefined') return
  if (route.path !== '/') return
  const raw = new URLSearchParams(window.location.search).get('liff.state')
  if (!raw) return
  const target = decodeURIComponent(raw)
  // オープンリダイレクト防止：URLコンストラクタで現オリジン基準に解決し、オリジン一致＝内部パスのみ許可。
  // これで '//host'・'/\\host'（バックスラッシュ正規化）・'https://host' 等の外部遷移を漏れなく弾く。
  let resolved: URL
  try { resolved = new URL(target, window.location.origin) } catch { return }
  if (resolved.origin !== window.location.origin) return
  const path = resolved.pathname + resolved.search + resolved.hash
  if (!path.startsWith('/')) return
  await navigateTo(path)
}
</script>

<style scoped>
.domain-migrate-overlay { position: fixed; inset: 0; z-index: 10000; background: #0f172a; display: flex; align-items: center; justify-content: center; padding: 24px; }
.domain-migrate-card { background: #fff; border-radius: 16px; padding: 32px 28px; max-width: 480px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.domain-migrate-card h1 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
.domain-migrate-card p { font-size: 14px; line-height: 1.7; color: #475569; margin-bottom: 20px; word-break: break-all; }
.domain-migrate-link { display: inline-block; background: #06C755; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 700; }
.splash {
  position: fixed; inset: 0;
  background: #fff;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 32px; z-index: 9999;
}
.splash-logo {
  font-size: 32px; font-weight: 900;
  letter-spacing: 8px; color: #06C755;
}
.splash-spinner {
  width: 36px; height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #06C755;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
