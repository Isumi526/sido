<template>
  <header class="app-nav no-print">
    <!-- 代理入力バナー -->
    <div v-if="proxy.isProxyMode.value" class="proxy-banner">
      <span class="material-symbols-rounded proxy-banner-icon">swap_horiz</span>
      <span class="proxy-banner-text">{{ $t('nav.proxyEditing') }}<strong>{{ proxy.proxyTarget.value?.name }}</strong></span>
      <button class="proxy-banner-exit" @click="proxy.clearProxy()">{{ $t('nav.exit') }}</button>
    </div>
    <div ref="navInnerRef" class="app-nav-inner">
      <button v-if="showBack" class="app-back" :aria-label="$t('nav.back')" @click="router.back()">
        <span class="material-symbols-rounded">arrow_back</span>
        <span v-if="unreadBadge" class="app-back-badge" data-testid="app-back-unread-badge">{{ unreadBadge }}</span>
      </button>
      <span v-else class="app-back-spacer" />
      <span class="app-title-col" :class="{ 'app-title-col-left': titleAlign === 'left' }">
        <span class="app-title">{{ subtitle }}</span>
        <span class="app-brand-name">{{ brandName }}</span>
      </span>
      <slot name="actions" />
      <button class="app-hamburger" @click="open = true" :aria-label="$t('nav.openMenu')">
        <span class="app-bar" />
        <span class="app-bar" />
        <span class="app-bar" />
      </button>
    </div>
  </header>
  <div class="app-nav-spacer" :style="{ height: navHeight + 'px' }" />

  <!-- 下部固定ナビ（本文末尾の余白はbody.paddingBottomをJS側で付与＝ページ側のDOM構造に依存しない） -->
  <nav v-if="showBottomNav" ref="bottomNavRef" class="app-bottom-nav no-print">
    <NuxtLink v-for="item in bottomNavItems" :key="item.path" class="bottom-nav-item" :class="{ active: isNavActive(item.path) }" :to="item.path" :data-testid="`bottom-nav-${item.testId}`">
      <span class="bottom-nav-icon-wrap">
        <span class="material-symbols-rounded bottom-nav-icon">{{ item.icon }}</span>
        <span v-if="item.badge > 0" class="bottom-nav-badge" :data-testid="`bottom-nav-badge-${item.testId}`">{{ item.badge }}</span>
      </span>
      <span class="bottom-nav-label">{{ item.label }}</span>
    </NuxtLink>
  </nav>

  <Teleport to="body">
    <Transition name="nav-fade">
      <div v-if="open" class="app-overlay" @click="open = false" />
    </Transition>
    <Transition name="nav-slide">
      <div v-if="open" class="app-drawer">
        <!-- ユーザー情報 -->
        <div class="drawer-head">
          <div v-if="userName" class="drawer-user">
            <div class="drawer-avatar">{{ userName.charAt(0) }}</div>
            <div>
              <div class="drawer-name">{{ userName }}</div>
              <div class="drawer-role">{{ roleLabel }}</div>
            </div>
          </div>
          <button class="drawer-close" @click="open = false">✕</button>
        </div>

        <!-- ナビゲーション（ホーム画面と共通定義＝useNavItems・セクション階層化はHOMEと同じ構成） -->
        <nav class="drawer-nav">
          <NuxtLink class="drawer-item" to="/" @click="open = false">
            <span class="drawer-item-icon material-symbols-rounded">home</span>
            <span>{{ $t('nav.home') }}</span>
          </NuxtLink>

          <div class="drawer-section">{{ $t('nav.secDaily') }}</div>
          <template v-for="item in bySection.daily" :key="item.path">
            <NuxtLink class="drawer-item" :to="item.path" :data-testid="item.testId" @click="open = false">
              <span class="drawer-item-icon material-symbols-rounded">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
              <span v-if="item.path === '/chats' && unreadChatCount > 0" class="drawer-item-badge" data-testid="drawer-chat-badge">{{ unreadChatCount }}</span>
            </NuxtLink>
          </template>

          <div class="drawer-section">{{ $t('nav.secPlan') }}</div>
          <template v-for="item in bySection.plan" :key="item.path">
            <NuxtLink class="drawer-item" :to="item.path" :data-testid="item.testId" @click="open = false">
              <span class="drawer-item-icon material-symbols-rounded">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
              <span v-if="item.path === '/calendar' && unreadScheduleCount > 0" class="drawer-item-badge" data-testid="drawer-schedule-badge">{{ unreadScheduleCount }}</span>
            </NuxtLink>
          </template>

          <div class="drawer-section">{{ $t('nav.secInfo') }}</div>
          <template v-for="item in bySection.info" :key="item.path">
            <NuxtLink class="drawer-item" :to="item.path" :data-testid="item.testId" @click="open = false">
              <span class="drawer-item-icon material-symbols-rounded">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </NuxtLink>
          </template>
          <button type="button" class="drawer-item" @click="openInBrowser">
            <span class="drawer-item-icon material-symbols-rounded">open_in_new</span>
            <span>{{ $t('nav.openInBrowser') }}</span>
          </button>
        </nav>

        <!-- 言語切替 -->
        <div class="drawer-lang">
          <span class="drawer-lang-icon material-symbols-rounded">language</span>
          <div class="drawer-lang-toggle">
            <button
              v-for="l in locales"
              :key="l"
              type="button"
              class="drawer-lang-btn"
              :class="{ active: locale === l }"
              @click="setLocale(l)"
            >{{ l === 'ja' ? $t('common.langJa') : $t('common.langEn') }}</button>
          </div>
        </div>

        <!-- 代理入力セクション -->
        <div v-if="proxy.canProxy.value" class="drawer-proxy">
          <div class="drawer-proxy-header">
            <span class="material-symbols-rounded drawer-proxy-icon">swap_horiz</span>
            <span class="drawer-proxy-title">{{ $t('nav.proxyInput') }}</span>
            <button
              v-if="proxy.isProxyMode.value"
              class="drawer-proxy-clear"
              @click="proxy.clearProxy()"
            >{{ $t('nav.exit') }}</button>
          </div>
          <div class="drawer-proxy-list">
            <button
              v-for="w in proxy.proxyTargets.value"
              :key="w.id"
              class="drawer-proxy-row"
              :class="{ selected: proxy.proxyTarget.value?.id === w.id }"
              @click="selectProxy(w)"
            >
              <div class="drawer-proxy-avatar">{{ w.name.charAt(0) }}</div>
              <div class="drawer-proxy-info">
                <div class="drawer-proxy-name">{{ w.name }}</div>
                <div class="drawer-proxy-role">{{ w.worker_role === 'factory' ? $t('common.roleFactory') : $t('common.roleSite') }}</div>
              </div>
              <span v-if="proxy.proxyTarget.value?.id === w.id" class="material-symbols-rounded drawer-proxy-check">check_circle</span>
            </button>
          </div>
        </div>

        <!-- ログアウト（常時表示・ドロワー末尾）-->
        <button type="button" class="drawer-item drawer-item--logout" @click="logout">
          <span class="drawer-item-icon material-symbols-rounded">logout</span>
          <span>{{ $t('nav.logout') }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
// ページ遷移時、新ページのAppNavがmount(padding-bottomを正しくセット)→旧ページのAppNavが
// unmount、の順で起こりうる（Vueは新をmountしてから旧をunmountする）。unmount側が無条件に
// padding-bottomを空へクリアすると、直後の新側の設定が消えてナビと本文が被る(2026-07-17実機で発覚)。
// モジュールスコープ(全AppNavインスタンス共有)の参照カウントで「最後の1個がunmountされる時だけ」
// クリアするようにし、page→page遷移(常に1件は生き残る)では絶対にクリアさせない。
let appNavInstanceCount = 0
</script>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  subtitle:  string
  userName?: string
  userRole?: 'factory' | 'site'
  unreadBadge?: number   // 戻るアイコンに表示する未読件数バッジ(現場チャット等・任意)
  titleAlign?: 'center' | 'left'   // タイトルの寄せ(既定center・現場チャットのみLINE風に左詰め)
}>()

const { t } = useI18n()
const { locale, setLocale, locales } = useLocale()
// ブランド表示は「身元のスラッグ」(resolvedSlug)優先・未解決時のみ env フォールバック
// （env だと別テナント作業員でも SIDO 等と出てしまうため）。テナント確認用の安全表示のため
// ヘッダー簡素化(2026-07-16)後もタイトル直下に残す（liff.tenant-*.spec.ts が検証）。
const { slug, resolvedSlug, resetAccount } = useAccount()
const brandName = computed(() => (resolvedSlug.value || slug).toUpperCase())
const proxy = useProxyMode()
const config = useRuntimeConfig()
const { authMode } = useLiff()

// ヘッダー: 戻るボタン(左・ホームでは非表示)＋タイトル(中央)＋ハンバーガー(右)。position:fixed化に
// 伴い、直後にヘッダー実高さ分のスペーサーを置いてページ本文が隠れないようにする(2026-07-16)。
const router = useRouter()
const route = useRoute()
const showBack = computed(() => route.path !== '/')
// 現場チャットの個別スレッド(/site-chat/:id)・アカウント全体チャット(/account-chat)は
// 全画面表示のメッセージ入力欄と競合するため、タブ遷移先である一覧画面(/chats)とは別に
// 下部固定ナビを非表示にする(drill-in詳細画面の慣例)。
const showBottomNav = computed(() => !route.path.startsWith('/site-chat/') && route.path !== '/account-chat')

const navInnerRef   = ref<HTMLElement | null>(null)
const bottomNavRef  = ref<HTMLElement | null>(null)
const navHeight     = ref(52)   // ヘッダー実高さ(スペーサーdiv用・素直にflowへ反映できる)

// 下部固定ナビは各ページ独自のルート要素の先頭にAppNavが置かれる都合上、ページ末尾に
// スペーサーdivを置けない（ページごとにDOM構造が違うため）。実測した高さをCSS変数として
// documentElementに公開し、bodyのpadding-bottomと各ページ側の固定要素(FAB等)から共通参照する。
function measureHeights() {
  if (navInnerRef.value) navHeight.value = navInnerRef.value.getBoundingClientRect().height
  if (typeof document === 'undefined') return
  const bottomH = showBottomNav.value && bottomNavRef.value ? bottomNavRef.value.getBoundingClientRect().height : 0
  document.documentElement.style.setProperty('--app-bottom-nav-h', `${bottomH}px`)
  // ヘッダー実高さ(スペーサーと同じ値)もCSS変数化。ヘッダー+下部ナビ両方を差し引いて
  // 高さ計算したいページ(checkin等)向け(2026-07-16)。
  document.documentElement.style.setProperty('--app-header-h', `${navHeight.value}px`)
  document.body.style.paddingBottom = bottomH > 0 ? 'calc(var(--app-bottom-nav-h) + env(safe-area-inset-bottom, 0px))' : ''
}
onMounted(() => {
  appNavInstanceCount++
  measureHeights()
  window.addEventListener('resize', measureHeights)
})
onUnmounted(() => {
  appNavInstanceCount--
  window.removeEventListener('resize', measureHeights)
  // 他のAppNavインスタンス(次ページ側。新→旧の順でmount/unmountされるため既にmount済み)が
  // 残っている間はクリアしない＝その生存インスタンスが設定した正しい値を消さない。
  if (appNavInstanceCount <= 0 && typeof document !== 'undefined') document.body.style.paddingBottom = ''
})
watch(() => proxy.isProxyMode.value, () => nextTick(measureHeights))   // バナー表示切替で高さが変わる
watch(showBottomNav, () => nextTick(measureHeights))                   // site-chat遷移でナビ表示が切り替わる

const open = ref(false)
// ハンバーガーを開くたびにバッジを再取得（/calendar等で既読化した直後でも最新件数を反映・2026-07-13）。
// ※ @click ハンドラ内で直接呼ぶと useSchedules() 内の useI18n() が「setup外」判定で例外になり
//   サイレントに失敗する(コンポーネントinstance文脈が無いDOMイベントハンドラのため)。
//   watchはVueのeffectスコープ内で実行されinstance文脈が保持されるためここに書く。
watch(open, (isOpen) => { if (isOpen) refreshScheduleNotifBadge() })

// ホーム画面(pages/index.vue)と共通のナビ項目定義（composables/useNavItems.ts）。
// 表記・並び・表示条件(パスワード変更等)のズレを防ぐ（2026-07-10）。
const { bySection } = useNavItems(() => authMode.value)

// 予定管理ナビの未読バッジ（#予定通知バッジ・2026-07-11）
onMounted(() => { refreshScheduleNotifBadge() })
// チャット一覧ナビの未読バッジ（2026-07-14・現場情報ナビの未読メンションバッジから移設・集約）
onMounted(() => { refreshSiteChatListBadge() })

// 下部固定ナビ（2026-07-20整理: 残業申請は出退勤画面からの導線に一本化し除外、
//  ホームを中央(デフォルト選択位置)に。出退勤/チャット/ホーム/日報登録/予定管理の5項目）
const bottomNavItems = computed(() => [
  { path: '/checkin',   icon: 'how_to_reg',      label: t('nav.checkin'),        testId: 'checkin',  badge: 0 },
  { path: '/chats',     icon: 'forum',           label: t('nav.chats'),          testId: 'chats',    badge: unreadChatCount.value },
  { path: '/',          icon: 'home',           label: t('nav.home'),           testId: 'home',     badge: 0 },
  { path: '/report',    icon: 'edit_note',       label: t('nav.reportRegister'), testId: 'report',   badge: 0 },
  { path: '/calendar',  icon: 'calendar_month',  label: t('nav.schedule'),       testId: 'calendar', badge: unreadScheduleCount.value },
])
// '/checkin/[[siteId]]'のような任意サブパスも「そのタブが選択中」として扱う(ホームだけは完全一致のみ)
function isNavActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}

// 現在の画面を外部ブラウザで開く（LINEの⋮メニューに依存せず常に開けるようにする）
async function openInBrowser() {
  open.value = false
  // 開発モードは LIFF 未接続なのでそのまま新規タブ
  if (config.public.appEnv === 'development') {
    window.open(window.location.href, '_blank')
    return
  }
  try {
    const liff = (await import('@line/liff')).default
    // 同じ画面の共有用URL。クエリ付き等で失敗したら現在URLにフォールバック
    let url = window.location.href
    try { url = liff.permanentLink.createUrl() } catch { /* keep window.location.href */ }
    liff.openWindow({ url, external: true })
  } catch (e) {
    console.error('[AppNav] openInBrowser failed:', e)
    window.open(window.location.href, '_blank')
  }
}

const roleLabel = computed(() => {
  if (!props.userRole) return ''
  return props.userRole === 'factory' ? t('common.roleFactory') : t('common.roleSite')
})

function selectProxy(w: import('~/composables/useProxyMode').ProxyWorker) {
  if (proxy.proxyTarget.value?.id === w.id) {
    proxy.clearProxy()
  } else {
    proxy.setProxy(w)
  }
  open.value = false
}

// ログアウト：Supabaseセッション破棄＋テナント/代理キャッシュ破棄→ /login へ。
// LINEモードは best-effort で liff.logout も呼び自動再開を防ぐ（dev は LIFF 未接続なのでスキップ）。
// ★先に /login へ遷移してから身元状態(liff.reset())を破棄する（#ログアウトローディング停止対策）。
//   app.vue のスプラッシュは「非exemptルート ＆ liff未初期化」の時に出る。/login は exempt のため
//   影響しないが、reset()を先に行うと遷移完了前の一瞬(非exemptルートのまま)にスプラッシュへ入り、
//   そのまま復帰しなくなるケースがあった。遷移を先に済ませてから状態を破棄すれば発生しない。
const supabase = useSupabase()
async function logout() {
  open.value = false
  proxy.clearProxy()
  try { await supabase.auth.signOut() } catch { /* セッション無し等は無視 */ }
  await navigateTo('/login')
  resetAccount()
  useLiff().reset()   // 身元状態を破棄（次のユーザーが前のユーザーとして解決されるのを防ぐ）
  if (config.public.appEnv !== 'development') {
    try {
      const liff = (await import('@line/liff')).default
      if (liff.isLoggedIn?.()) liff.logout()
    } catch { /* LIFF未接続等は無視 */ }
  }
}
</script>

<style scoped>
.app-nav {
  background: #fff;
  border-bottom: 1px solid #E0E0E0;
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.app-nav-inner {
  max-width: 840px;
  margin: 0 auto;
  padding: 0 16px;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* position:fixed化した分、本文がヘッダー裏に隠れないよう実測高さ分のスペーサーを置く */
.app-nav-spacer { width: 100%; }
.app-back, .app-back-spacer {
  width: 36px; height: 36px; flex-shrink: 0;
}
.app-back {
  display: flex; align-items: center; justify-content: center; position: relative;
  background: transparent; border: none; color: #333; cursor: pointer;
  border-radius: 8px; transition: background .15s;
}
.app-back:hover { background: #f5f5f5; }
.app-back .material-symbols-rounded { font-size: 22px; }
.app-back-badge {
  position: absolute; top: 2px; right: 2px; background: #ef4444; color: #fff;
  font-size: 10px; font-weight: 700; border-radius: 8px; min-width: 15px; height: 15px;
  display: flex; align-items: center; justify-content: center; padding: 0 3px; line-height: 1;
}
.app-title-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
  overflow: hidden;
}
.app-title-col-left { align-items: flex-start; }
.app-title-col-left .app-title { text-align: left; }
.app-title {
  max-width: 100%; text-align: center; font-size: 15px; font-weight: 700; color: #111;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* テナント確認用の安全表示（タイトル直下・小さく）。liff.tenant-*.spec.tsが検証 */
.app-brand-name { font-size: 10px; font-weight: 800; letter-spacing: 2px; color: #06C755; margin-top: 1px; }

/* ハンバーガーボタン */
.app-hamburger {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-shrink: 0;
  gap: 5px;
  width: 36px;
  height: 36px;
  padding: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 8px;
  transition: background .15s;
}
.app-hamburger:hover { background: #f5f5f5; }
.app-bar {
  display: block;
  width: 100%;
  height: 2px;
  background: #333;
  border-radius: 2px;
}

/* オーバーレイ */
.app-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 200;
}
.nav-fade-enter-active,
.nav-fade-leave-active  { transition: opacity .2s; }
.nav-fade-enter-from,
.nav-fade-leave-to      { opacity: 0; }

/* ドロワー */
.app-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 260px;
  background: #fff;
  z-index: 201;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0,0,0,.12);
  overflow-y: auto;           /* 項目が画面より長い時もスクロールで下（言語/ログアウト）に届く */
  -webkit-overflow-scrolling: touch;
}
.nav-slide-enter-active,
.nav-slide-leave-active  { transition: transform .22s ease; }
.nav-slide-enter-from,
.nav-slide-leave-to      { transform: translateX(100%); }

/* ドロワーヘッダー */
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 16px;
  border-bottom: 1px solid #E0E0E0;
  min-height: 80px;
}
.drawer-user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #06C755;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.drawer-name { font-size: 14px; font-weight: 700; color: #111; }
.drawer-role { font-size: 11px; color: #888; margin-top: 2px; }
.drawer-close {
  background: transparent;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  flex-shrink: 0;
  margin-left: 4px;
}
.drawer-close:hover { background: #f5f5f5; color: #333; }

/* ナビ項目 */
.drawer-nav {
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.drawer-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 12px;
  border-radius: 10px;
  text-decoration: none;
  color: #111;
  font-size: 15px;
  font-weight: 600;
  transition: background .15s;
}
.drawer-item-badge {
  margin-left: auto;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}
.drawer-section {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  margin: 14px 12px 4px;
  letter-spacing: .04em;
}
.drawer-section:first-of-type { margin-top: 6px; }
button.drawer-item {
  width: 100%;
  appearance: none;
  background: none;
  border: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.drawer-item:hover,
.drawer-item.router-link-active { background: #f0fdf4; color: #06C755; }
.drawer-item--logout {
  margin-top: 8px;
  border-top: 1px solid #eee;
  border-radius: 0 0 10px 10px;
  color: #d23b3b;
}
.drawer-item--logout:hover { background: #fdf0f0; color: #c01f1f; }
.drawer-item-icon {
  font-size: 22px;
  width: 24px; text-align: center;
  color: #666;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
  flex-shrink: 0;
}
.drawer-item.router-link-active .drawer-item-icon {
  color: #06C755;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

/* 言語切替 */
.drawer-lang {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid #E0E0E0;
}
.drawer-lang-icon {
  font-size: 20px; color: #666;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
  flex-shrink: 0;
}
.drawer-lang-toggle {
  display: flex; gap: 4px; flex: 1;
  background: #f3f4f6; border-radius: 8px; padding: 3px;
}
.drawer-lang-btn {
  flex: 1; border: none; background: transparent; cursor: pointer;
  padding: 6px 8px; border-radius: 6px;
  font-size: 13px; font-weight: 700; color: #666;
  font-family: inherit; transition: all .15s;
}
.drawer-lang-btn.active { background: #fff; color: #06C755; box-shadow: 0 1px 3px rgba(0,0,0,.1); }

/* 代理入力バナー */
.proxy-banner {
  background: #dc2626;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px;
  font-size: 13px; color: #fff;
}
.proxy-banner-icon {
  font-size: 18px;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
  flex-shrink: 0;
}
.proxy-banner-text { flex: 1; }
.proxy-banner-exit {
  background: rgba(255,255,255,.2);
  border: none; border-radius: 6px;
  color: #fff; font-size: 12px; font-weight: 700;
  padding: 3px 10px; cursor: pointer; flex-shrink: 0;
}
.proxy-banner-exit:active { background: rgba(255,255,255,.35); }

/* 代理入力セクション */
.drawer-proxy {
  border-top: 1px solid #E0E0E0;
  padding: 12px 8px 16px;
}
.drawer-proxy-header {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px 8px;
}
.drawer-proxy-icon {
  font-size: 18px; color: #dc2626;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
  flex-shrink: 0;
}
.drawer-proxy-title {
  font-size: 11px; font-weight: 800; letter-spacing: 1.5px;
  text-transform: uppercase; color: #888; flex: 1;
}
.drawer-proxy-clear {
  background: #fee2e2; color: #dc2626;
  border: none; border-radius: 6px;
  padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
}
.drawer-proxy-clear:active { background: #fecaca; }

.drawer-proxy-list { display: flex; flex-direction: column; gap: 2px; }
.drawer-proxy-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 10px; border-radius: 10px;
  background: transparent; border: none; cursor: pointer;
  text-align: left; width: 100%; transition: background .12s;
}
.drawer-proxy-row:active,
.drawer-proxy-row.selected { background: #fef2f2; }
.drawer-proxy-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: #e5e7eb; color: #555;
  font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.drawer-proxy-row.selected .drawer-proxy-avatar { background: #dc2626; color: #fff; }
.drawer-proxy-info { flex: 1; }
.drawer-proxy-name { font-size: 14px; font-weight: 600; color: #111; }
.drawer-proxy-role { font-size: 11px; color: #888; margin-top: 1px; }
.drawer-proxy-check {
  color: #dc2626; font-size: 20px;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
  flex-shrink: 0;
}

/* 下部固定ナビ（2026-07-16） */
.app-bottom-nav {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  z-index: 100;
  display: flex;
  background: #fff;
  border-top: 1px solid #E0E0E0;
  box-shadow: 0 -1px 4px rgba(0,0,0,.06);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.bottom-nav-item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 7px 2px 6px;
  text-decoration: none;
  color: #888;
}
.bottom-nav-icon-wrap { position: relative; }
.bottom-nav-icon {
  font-size: 22px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
}
.bottom-nav-label {
  font-size: 10px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bottom-nav-item.active { color: #06C755; }
.bottom-nav-item.active .bottom-nav-icon {
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
.bottom-nav-badge {
  position: absolute;
  top: -4px; right: -8px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
@media print {
  .no-print { display: none !important; }
}
</style>
