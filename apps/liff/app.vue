<template>
  <!-- LIFF初期化中はスプラッシュ画面を表示（業者ポータル /p/ ・ログイン /login はLIFFを経由しない） -->
  <div v-if="!isExempt && !liff.initialized.value" class="splash">
    <div class="splash-logo">SIDO</div>
    <div class="splash-spinner"></div>
  </div>
  <NuxtPage v-else />
</template>

<script setup lang="ts">
const liff = useLiff()
const route = useRoute()
// 業者向けトークンポータル(/p/:token)・email/pwログイン(/login)は LINE ログイン誘導を行わない。
const isPortal = computed(() => route.path.startsWith('/p/'))
const isLogin  = computed(() => route.path.startsWith('/login'))
const isExempt = computed(() => isPortal.value || isLogin.value)

// サイト名（ブラウザタブ／共有タイトル）を会社名ベースで動的に設定。
// accounts.name 取得前は '管理システム' をフォールバック表示。
// ★ /login は全テナント共通の入口＝ログイン前に env(デプロイ)のテナント名を出さない（誤誘導防止）。
const { getAccountId, accountName } = useAccount()
useHead({
  title: () => isLogin.value
    ? '作業員ログイン'
    : (accountName.value ? `${accountName.value}｜管理システム` : '管理システム'),
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
