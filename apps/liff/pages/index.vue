<template>
  <div class="home-page">
    <AppNav :subtitle="t('home.subtitle')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <div class="home-body">

      <!-- PWA化(ホーム画面追加)の案内: Safari等ブラウザで直接開いている時だけ表示。
           既にホーム画面追加済み(standalone表示)のユーザーには出さない。 -->
      <div v-if="showPwaHint" class="pwa-hint-card">
        <span class="material-symbols-rounded pwa-hint-icon">add_to_home_screen</span>
        <div class="pwa-hint-body">
          <div class="pwa-hint-title">{{ t('home.pwaHintTitle') }}</div>
          <div class="pwa-hint-sub">{{ t('home.pwaHintSub') }}</div>
        </div>
        <button type="button" class="pwa-hint-close" :aria-label="t('common.close')" @click="dismissPwaHint">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      <!-- ★お知らせ/やることのカードはホームに出さない（2026-08-30 ユーザー指示）。
           ヘッダーのベルが合計件数のバッジを出しており、カードは重複でホームが混む。
           気づく入口はベル1つに集約し、内訳は /notifications のタブで見る。 -->

      <!-- 日を跨いでも未提出が残っている時の割り込み。閉じられるが、解消するまで開くたびに出る。 -->
      <div v-if="overdueModal" class="overdue-overlay" data-testid="home-overdue-modal">
        <div class="overdue-modal">
          <span class="material-symbols-rounded overdue-icon">assignment_late</span>
          <p class="overdue-title">{{ t('home.overdueTitle', { count: today.backlogDates.length }) }}</p>
          <p class="overdue-sub">{{ t('home.overdueSub', { date: formatMd(overdueModal) }) }}</p>
          <div class="overdue-actions">
            <NuxtLink :to="`/report?date=${overdueModal}`" class="overdue-btn primary" data-testid="overdue-write">
              {{ t('home.overdueWrite') }}
            </NuxtLink>
            <button class="overdue-btn" data-testid="overdue-later" @click="dismissOverdue">
              {{ t('home.overdueLater') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ★今日のステータスと次の1アクション（2026-08-31 運用者指摘:
           「今出勤中なのか、今日まだ出勤が押されてないとか…次のアクションだったり動線が分かりやすいように」）。
           判定は useTodayStatus に集約（起動時の割り込みと同じソース）。

           ★高さを最初から確保する（2026-08-31 運用者指摘:
            「時間差で表示されるので、ナビゲーションを押そうとした時に位置がずれて、
              別の意図しないボタンをタップしてしまう」）。
            読み込み中はスケルトンを同じ高さで出し、下のメニューを一切動かさない。
            そのため中身の行数は固定にしてある——可変の情報（予定・溜まっている未提出）は
            行を増やさず、説明文への追記かアクションボタンとして横に並べること。 -->
      <div class="today-slot">
        <!-- ★カードは1つだけ。読み込み中も「実カードそのもの」を描画し、文字を伏せて
             帯を重ねるだけにする。スケルトンを別DOMで作ると高さが必ずズレる
             （同じ骨格に揃えても本番で18px→26pxとズレ続けた・2026-09-01）。
             同じDOMなら高さは定義上一致する。 -->
        <div
          v-if="today.phase !== 'unknown' || !homeReady"
          class="today-card"
          :class="[homeReady ? today.phase : 'skeleton']"
          :data-testid="homeReady ? 'home-today-card' : 'home-today-skeleton'"
          :aria-hidden="!homeReady || undefined"
        >
          <div class="today-head">
            <span class="material-symbols-rounded today-icon">{{ todayView.icon }}</span>
            <div class="today-texts">
              <div class="today-title" :data-testid="homeReady ? 'home-today-title' : undefined">{{ todayView.title }}</div>
              <div class="today-sub">{{ todayView.sub }}</div>
            </div>
          </div>
          <div class="today-actions">
            <NuxtLink
              v-for="a in todayView.actions"
              :key="a.to"
              :to="a.to"
              class="today-action"
              :class="{ primary: a.primary }"
              :data-testid="a.testId"
            >
              <span class="material-symbols-rounded">{{ a.icon }}</span>{{ a.label }}
            </NuxtLink>
            <!-- 溜まっている未提出。★行を足さずアクションとして横に並べる（高さを変えないため）。
                 主アクションが2つある時は出さない——3つ並べると375px幅で文字が切れて
                 「未提出 ⟨」のように読めなくなる（2026-08-31 iPhone SE 幅で確認）。
                 件数はナビのバッジに出ており、起動時の割り込みもあるので落としてよい。 -->
            <NuxtLink
              v-if="today.backlogDates.length && todayView.actions.length <= 1"
              to="/history"
              class="today-action sub"
              data-testid="home-today-backlog"
            >
              <span class="material-symbols-rounded">history</span>{{ t('home.todayBacklogShort', { count: today.backlogDates.length }) }}
            </NuxtLink>
          </div>
        </div>

        <!-- 判定できなかった時は空のまま。高さは today-slot が持っているのでズレない -->
      </div>

      <!-- 経費申請 締切案内。
           ★枠は「締切が近い期間かどうか」だけで先に決める。これは日付から同期的に分かるので、
            読み込みを待たずに高さを確保できる。中身（実際に出すか）はデータが来てから決まるが、
            枠が先にあるので下のメニューは動かない。
            ここを条件付きで生やしていた時、9/1（締切前）に本番でメニューが77px跳ねた（2026-09-01 実測）。
            締切前の3〜4日だけ空枠になることはあるが、誤タップを出すよりよい。 -->
      <div v-if="deadlineWindowOpen" class="deadline-slot">
      <NuxtLink v-if="homeReady && deadlineBanner" class="deadline-card" to="/expense/download">
        <span class="material-symbols-rounded deadline-icon">schedule</span>
        <div class="deadline-body">
          <div class="deadline-title">{{ t('home.deadlineTitle', { period: periodShort(deadlineBanner.periodKey) }) }}</div>
          <div class="deadline-sub">{{ t('home.deadlineSub', { label: deadlineBanner.label }) }}</div>
        </div>
        <span class="material-symbols-rounded alert-arrow">chevron_right</span>
      </NuxtLink>
      </div>

      <!-- メニュー（記録／予定・連絡／情報・設定 に整理／ハンバーガーメニューと共通定義＝useNavItems） -->
      <div class="menu-section">{{ t('nav.secDaily') }}</div>
      <div class="menu-grid">
        <NuxtLink v-for="item in navBySection.daily" :key="item.path" class="menu-card" :to="item.path">
          <span class="menu-icon-wrap">
            <span class="material-symbols-rounded menu-icon" :style="{ color: navIconColor(item.path) }">{{ item.icon }}</span>
            <span v-if="item.path === '/chats' && unreadChatCount > 0" class="menu-card-badge" data-testid="home-chat-badge">{{ unreadChatCount }}</span>
          </span>
          <span class="menu-label">{{ item.label }}</span>
        </NuxtLink>
      </div>

      <div class="menu-section">{{ t('nav.secPlan') }}</div>
      <div class="menu-grid">
        <NuxtLink v-for="item in navBySection.plan" :key="item.path" class="menu-card" :to="item.path">
          <span class="menu-icon-wrap">
            <span class="material-symbols-rounded menu-icon" :style="{ color: navIconColor(item.path) }">{{ item.icon }}</span>
            <span v-if="item.path === '/calendar' && unreadScheduleCount > 0" class="menu-card-badge" data-testid="home-schedule-badge">{{ unreadScheduleCount }}</span>
            <span v-if="item.path === '/notifications' && totalBadgeCount > 0" class="menu-card-badge" data-testid="home-notif-badge">{{ totalBadgeCount }}</span>
          </span>
          <span class="menu-label">{{ item.label }}</span>
        </NuxtLink>
      </div>

      <div class="menu-section">{{ t('nav.secInfo') }}</div>
      <div class="menu-grid">
        <NuxtLink v-for="item in navBySection.info" :key="item.path" class="menu-card" :to="item.path" :data-testid="item.testId">
          <span class="material-symbols-rounded menu-icon" :style="{ color: navIconColor(item.path) }">{{ item.icon }}</span>
          <span class="menu-label">{{ item.label }}</span>
        </NuxtLink>
        <!-- 代理操作者のみ表示（遷移先ではなくモーダル起動のためnav定義の対象外） -->
        <button v-if="proxy.canProxy.value" class="menu-card proxy-btn" @click="openProxyModal">
          <span class="material-symbols-rounded menu-icon" style="color:#dc2626">swap_horiz</span>
          <span class="menu-label">{{ t('nav.proxyInput') }}</span>
        </button>
      </div>

    </div>

    <!-- 代理入力 ユーザー選択モーダル -->
    <div v-if="proxyModalOpen" class="proxy-overlay" @click.self="proxyModalOpen = false">
      <div class="proxy-modal">
        <div class="proxy-modal-head">
          <span class="proxy-modal-title">{{ t('home.proxyModalTitle') }}</span>
          <button class="proxy-modal-close" @click="proxyModalOpen = false">{{ t('home.proxyModalClose') }}</button>
        </div>
        <div class="proxy-modal-body">
          <div v-if="proxy.isProxyMode.value" class="proxy-current">
            <span>{{ t('home.proxyCurrentPrefix') }}<strong>{{ proxy.proxyTarget.value?.name }}</strong></span>
            <button class="proxy-clear-btn" @click="proxy.clearProxy(); proxyModalOpen = false">{{ t('home.proxyClear') }}</button>
          </div>
          <div v-if="proxyLoading" class="proxy-loading">{{ t('home.proxyLoading') }}</div>
          <template v-else>
            <div
              v-for="w in proxy.proxyTargets.value"
              :key="w.id"
              class="proxy-user-row"
              :class="{ selected: proxy.proxyTarget.value?.id === w.id }"
              @click="selectProxy(w)"
            >
              <div class="proxy-user-avatar">{{ w.name.charAt(0) }}</div>
              <div class="proxy-user-info">
                <div class="proxy-user-name">{{ w.name }}</div>
                <div class="proxy-user-role">{{ w.worker_role === 'factory' ? t('common.roleFactory') : t('common.roleSite') }}</div>
              </div>
              <span v-if="proxy.proxyTarget.value?.id === w.id" class="material-symbols-rounded proxy-check">check_circle</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'
import { recentPeriodKeys, deadlineForPeriod, deadlineLabel, effectiveStatus, isInDeadlineAlertWindow } from '~/composables/useExpense'
// ★明示import: 自動importだと jstDateOf が useExpense 版(戻り string|null)に解決され型が合わないため、
//  文字列を返す attendance-punch.gen 版を明示的に使う。
import { jstDateOf, jstTimeOf, toMinutes } from '~/composables/attendance-punch.gen'

const { t }       = useI18n()
const { profile, authMode } = useLiff()
const supabase    = useSupabase()
const config      = useRuntimeConfig()
const proxy       = useProxyMode()
const expense     = useExpense()
// ★コンポーザブルは setup 同期文脈で取得する（onMounted の await 後に呼ぶと注入が効かず例外になる）
const schedulesApi   = useSchedules()
const attendanceApi  = useAttendanceLog()
// 今日どこまで済んでいるか（ホームのステータスカードと起動時の割り込みが同じ判定を使う）
const { status: today, refresh: refreshToday } = useTodayStatus()

// ハンバーガーメニュー(AppNav.vue)と共通のナビ項目定義（2026-07-10）
const { resolveRole: resolveWorkerPerm, canApplyPersonalExpense } = useWorkerPermission()
onMounted(() => { void resolveWorkerPerm() })
const { bySection: navBySection } = useNavItems(() => authMode.value, () => canApplyPersonalExpense.value)
const NAV_ICON_COLORS: Record<string, string> = {
  '/checkin': '#10b981', '/report': '#06C755', '/history': '#3b82f6', '/overtime': '#f59e0b',
  '/notifications': '#e11d48', '/calendar': '#f59e0b', '/groups': '#8b5cf6', '/subcontractors': '#0ea5e9',
  '/sites': '#22c55e', '/expense/download': '#ef4444', '/expense/personal': '#d946ef', '/rules': '#0d9488', '/password': '#64748b',
}
function navIconColor(path: string): string { return NAV_ICON_COLORS[path] ?? '#64748b' }

const currentUser      = ref<User | null>(null)
const accountId        = ref<string | null>(null)
const proxyModalOpen   = ref(false)
const proxyLoading     = ref(false)
const deadlineBanner   = ref<{ periodKey: string; label: string } | null>(null)
// 打刻を促すプロンプト（今日の勤務予定の開始/終了時刻が来ているのに未打刻なら出す）。
// ★カードは廃止し、今日のステータスの説明文に畳んだ（2026-08-31）。
//  同じ「打刻して」を2枚出していた重複であり、後から生えて下のメニューを押し下げていたため。
const punchPrompt      = ref<{ kind: 'checkin' | 'checkout'; title: string } | null>(null)
// ホームの可変領域（ステータス・締切）の読み込みが済んだか。
// ★これが false の間は同じ高さのスケルトンを出す。後から生やすと下のメニューが動いて
//  押そうとしたものと別のボタンを押してしまう（運用者指摘・2026-08-31）。
const homeReady        = ref(false)

/**
 * 締切案内が出うる期間か。★データではなく日付だけで決まるので、読み込み前に確定できる。
 * これで枠の高さを先に確保でき、あとからカードが生えてもメニューが動かない。
 */
const deadlineWindowOpen = computed(() => recentPeriodKeys().some(k => isInDeadlineAlertWindow(k)))

/** 'YYYY-MM-DD' → 'M/D（曜）' */
function formatMd(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]}）`
}

/**
 * 今日のステータス → 見出し・説明・次アクション。
 * ★「次に押すもの」を必ず1つ以上返す。ここが空だと画面は状態を告げるだけで、
 *  結局ユーザーが入口を探すことになる（それが今回の指摘の元）。
 */
const todayView = computed(() => {
  // 読み込み中は「未出勤」の見た目を借りる。実在する文言なので行数・高さが実物と同じになる
  if (!homeReady.value) {
    return {
      icon: 'how_to_reg',
      title: t('home.todayNotPunched'),
      sub: t('home.todayNotPunchedSub'),
      actions: [{ to: '/checkin', label: t('home.actCheckin'), icon: 'login', primary: true, testId: undefined }],
    }
  }
  const s = today.value
  const reportTo = `/report?date=${todayStr()}`
  switch (s.phase) {
    case 'working':
      return {
        icon: 'work_history',
        title: t('home.todayWorking'),
        // 予定の終了が過ぎているなら、その現場名を添える（旧・打刻カードの情報をここへ畳んだ）
        sub: punchPrompt.value?.kind === 'checkout'
          ? t('home.todayWorkingSubSched', { time: s.checkinTime ?? '—', title: punchPrompt.value.title })
          : t('home.todayWorkingSub', { time: s.checkinTime ?? '—' }),
        actions: [
          { to: '/checkin', label: t('home.actCheckout'), icon: 'logout', primary: true, testId: 'today-act-checkout' },
          { to: '/overtime', label: t('home.actOvertime'), icon: 'more_time', primary: false, testId: 'today-act-overtime' },
        ],
      }
    case 'report-due':
      return {
        icon: 'edit_note',
        title: t('home.todayReportDue'),
        sub: t('home.todayReportDueSub', { time: s.checkoutTime ?? '—' }),
        actions: [{ to: reportTo, label: t('home.actWriteReport'), icon: 'edit_note', primary: true, testId: 'today-act-report' }],
      }
    case 'off':
      return {
        icon: s.isPaidLeave ? 'beach_access' : 'bedtime',
        title: s.isPaidLeave ? t('home.todayPaidLeave') : t('home.todayOff'),
        sub: t('home.todayOffSub'),
        actions: [{ to: '/history', label: t('home.actHistory'), icon: 'history', primary: false, testId: 'today-act-history' }],
      }
    case 'done':
      return {
        icon: 'task_alt',
        title: t('home.todayDone'),
        sub: t('home.todayDoneSub', { checkin: s.checkinTime ?? '—', checkout: s.checkoutTime ?? '—' }),
        actions: [{ to: '/history', label: t('home.actHistory'), icon: 'history', primary: false, testId: 'today-act-history' }],
      }
    default:   // not-punched
      return {
        icon: 'how_to_reg',
        title: t('home.todayNotPunched'),
        // 予定の開始が近い/過ぎているなら、その現場名を添える（旧・打刻カードの情報をここへ畳んだ）
        sub: punchPrompt.value?.kind === 'checkin'
          ? t('home.todayNotPunchedSubSched', { title: punchPrompt.value.title })
          : t('home.todayNotPunchedSub'),
        actions: [{ to: '/checkin', label: t('home.actCheckin'), icon: 'login', primary: true, testId: 'today-act-checkin' }],
      }
  }
})

// PWA化(ホーム画面追加)案内: Safari等ブラウザで直接開いている(standalone表示でない)
// ユーザーにだけ表示する。一度閉じたら再表示しない(localStorageにdismiss状態を保持)。
const PWA_HINT_DISMISSED_KEY = 'pwa_hint_dismissed'
const showPwaHint = ref(false)
function isStandaloneDisplay(): boolean {
  if (import.meta.server) return true
  const mql = window.matchMedia?.('(display-mode: standalone)')
  return !!mql?.matches || (navigator as any).standalone === true
}
function dismissPwaHint() {
  showPwaHint.value = false
  try { localStorage.setItem(PWA_HINT_DISMISSED_KEY, '1') } catch { /* quota超過等は無視 */ }
}

/** period_key → '◯月前半/後半' */
function periodShort(key: string): string {
  const [, month, half] = key.split('-')
  return half === 'first'
    ? t('home.periodFirstHalf', { month: parseInt(month) })
    : t('home.periodSecondHalf', { month: parseInt(month) })
}

/** 締切未到来かつ未申請/差し戻しの期のうち、締切が最も近いものをバナー表示 */
async function refreshDeadlineBanner() {
  const uid = currentUser.value?.id
  if (!uid) { deadlineBanner.value = null; return }
  const keys = recentPeriodKeys().slice(0, 3)
  const settlements = await expense.getSettlements(uid, keys)
  const byKey: Record<string, any> = Object.fromEntries(settlements.map((s: any) => [s.period_key, s]))
  const now = new Date()
  const pending = keys
    // 申請受付〜締切のアラート期間内のみ（first=15日〜18日10:00 / second=翌月1日〜3日10:00）
    .filter(k => isInDeadlineAlertWindow(k, now))
    .filter(k => { const st = effectiveStatus(byKey[k], k, now); return st === '未申請' || st === '差し戻し' })
    .sort((a, b) => deadlineForPeriod(a).getTime() - deadlineForPeriod(b).getTime())
  deadlineBanner.value = pending.length
    ? { periodKey: pending[0], label: deadlineLabel(pending[0]) }
    : null
}

/** 今日の自分の勤務予定で、開始時刻を過ぎたのに出勤打刻が無い（or 終了時刻を過ぎたのに退勤が無い）なら
 *  ホームで打刻を促す。LINE/メールは当てにできないので「ホームを開いた時に見える」ことを狙う（cron・外部送信なし）。
 *  開始の30分前から出す。
 *  ★2026-08-27 出退勤モデル変更: 打刻が現場に紐づかなくなった（1日＝出勤/退勤の2回）ので、
 *   判定も現場単位ではなく「その日に出勤打刻があるか／退勤打刻があるか」で行う。 */
async function refreshPunchPrompt(workerId: string) {
  punchPrompt.value = null
  try {
    const nowIso = new Date().toISOString()
    const today  = jstDateOf(nowIso)
    const nowMin = toMinutes(jstTimeOf(nowIso)) ?? 0
    await schedulesApi.fetchSchedules(today, today, undefined, workerId)
    // 今日・自分の勤務予定（現場と開始時刻があるもの）
    const mine = schedulesApi.schedules.value.filter(s =>
      s.worker_id === workerId && s.category === 'work' && s.start_date === today && s.site_id && s.start_time)
    if (!mine.length) return
    // DBの time 値は "HH:MM:SS" のことがあるので HH:MM に丸めてから分に変換する
    const hhmm = (t: string | null | undefined) => toMinutes((t ?? '').slice(0, 5))
    // 打刻の取得は失敗しても促しは止めない（取れなければ「未打刻」とみなして安全側に促す）
    let punches: { type: string; checked_at: string }[] = []
    try { punches = await attendanceApi.recent(24, workerId) } catch { punches = [] }
    // その日（JST）の打刻だけを見る。現場では絞らない。
    const todayPunches = punches.filter(p => jstDateOf(p.checked_at) === today)
    const hasCheckin  = todayPunches.some(p => p.type === 'checkin')
    const hasCheckout = todayPunches.some(p => p.type === 'checkout')
    // 出勤の促し（最も早い開始の30分前〜）を優先。無ければ退勤の促し（最も遅い終了〜）。
    if (!hasCheckin) {
      for (const s of mine) {
        const startMin = hhmm(s.start_time)
        if (startMin != null && nowMin >= startMin - 30) {
          punchPrompt.value = { kind: 'checkin', title: s.title || '現場' }; return
        }
      }
    } else if (!hasCheckout) {
      for (const s of mine) {
        const endMin = hhmm(s.end_time)
        if (endMin != null && nowMin >= endMin) {
          punchPrompt.value = { kind: 'checkout', title: s.title || '現場' }; return
        }
      }
    }
  } catch { /* 促しは best-effort。失敗してもホームは出す */ }
}

async function openProxyModal() {
  proxyModalOpen.value = true
  proxyLoading.value = false
}

async function selectProxy(worker: import('~/composables/useProxyMode').ProxyWorker) {
  proxy.setProxy(worker)
  proxyModalOpen.value = false
}

onMounted(() => {
  let dismissed = false
  try { dismissed = localStorage.getItem(PWA_HINT_DISMISSED_KEY) === '1' } catch { /* ignore */ }
  showPwaHint.value = !dismissed && !isStandaloneDisplay()
})

onMounted(async () => {
  // LIFFプロファイルが取得されるまで待機
  let tries = 0
  while (!profile.value?.userId && tries++ < 20) {
    await new Promise(r => setTimeout(r, 300))
  }
  const lineUserId = profile.value?.userId
  if (!lineUserId) return

  // account は身元優先で解決（認証時は env で上書きしない＝テナント分離）
  const { getAccountId } = useAccount()
  const accId = await getAccountId()
  if (!accId) return
  accountId.value = accId

  // セッション種別で「自分=どの作業員か」を解決（email/pw は worker_id 経由・LINEは従来）
  const user = await useCurrentUser().resolve()
  if (user) {
    currentUser.value = user as User
    if (user.worker_id) await proxy.fetchProxyTargets(user.worker_id)
    await refreshDeadlineBanner()
    if (user.worker_id) await refreshPunchPrompt(user.worker_id)
    // 今日のステータス。取れてから割り込み（未提出モーダル）の判定に進む
    await refreshToday()
    maybeInterrupt()
  }
  // ★成否にかかわらず必ず立てる。ここを通らないとスケルトンが出たままになる
  homeReady.value = true
})

// ── 退勤済みなのに日報が未提出の人への割り込み（2026-08-31）──
//  段階: 当日はホームのカードとナビのバッジまで。日を跨いでも未提出なら起動時にモーダル。
//  ★ブロックはしない（2026-08-10 逐語「そこの制限は、そこまで厳しくできない」）。
//   「後で」で閉じられるが、未提出が解消するまで開くたびに出る。
const overdueModal = ref<string | null>(null)   // 対象日（未提出のうち最も古い過去日）
// ★「開くたび」＝アプリを開くたび。ホームに戻るたびではない。
//  ルート移動のたびに出すと、閉じても閉じてもすぐ出てきて他の操作を邪魔する
//  （実際ハンバーガーを塞いだ）。閉じたらそのセッション中は出さず、次の起動でまた出す。
const OVERDUE_DISMISSED_KEY = 'overdue_report_dismissed'
function maybeInterrupt() {
  const s = today.value
  if (s.phase === 'unknown') return          // 判定できない時は割り込まない
  if (!s.backlogDates.length) return         // 今日の分だけならカードとバッジで足りる
  try { if (sessionStorage.getItem(OVERDUE_DISMISSED_KEY)) return } catch { /* 使えなければ出す */ }
  overdueModal.value = s.backlogDates[0]
}
function dismissOverdue() {
  overdueModal.value = null
  try { sessionStorage.setItem(OVERDUE_DISMISSED_KEY, '1') } catch { /* quota超過等は無視 */ }
}

// 予定管理ナビの未読バッジ（#予定通知バッジ・2026-07-11）
onMounted(() => { refreshNotifBadge(); refreshPendingDocBadge() })
// チャット一覧ナビの未読バッジ（2026-07-14・現場情報ナビの未読メンションバッジから移設・集約）
onMounted(() => { refreshSiteChatListBadge() })

</script>

<style scoped>
.home-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f2f2f7; overflow-x: hidden; }

.home-body { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* PWA化案内 */
.pwa-hint-card {
  background: #ecfdf5; border-radius: 12px;
  padding: 12px 14px; display: flex; align-items: center; gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  border-left: 4px solid #06A050;
}
.pwa-hint-icon { color: #06A050; font-size: 24px; flex-shrink: 0; }
.pwa-hint-body { flex: 1; }
.pwa-hint-title { font-size: 13px; font-weight: 700; color: #111; }
.pwa-hint-sub { font-size: 11px; color: #666; margin-top: 2px; }
.pwa-hint-close {
  background: none; border: none; color: #999; flex-shrink: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 4px;
}

/* お知らせ/締切カード共通の矢印（未送信アラートは廃止したが .alert-arrow は notif/deadline で継続利用） */
.alert-arrow { color: #ccc; font-size: 22px; flex-shrink: 0; }
/* 実測でカードは90px（2行の文言＋余白）。枠をそれに合わせる */
.deadline-slot { min-height: 90px; margin-bottom: 12px; box-sizing: border-box; }
.deadline-card {
  background: #fff; border-radius: 12px;
  padding: 14px 16px; display: flex; align-items: center; gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  border-left: 4px solid #ef4444; cursor: pointer; text-decoration: none;
}
.deadline-card:active { background: #fef2f2; }
.deadline-icon { color: #ef4444; font-size: 26px; flex-shrink: 0;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
.deadline-body { flex: 1; }
.deadline-title { font-size: 14px; font-weight: 700; color: #111; }
.deadline-sub   { font-size: 12px; color: #ef4444; margin-top: 2px; font-weight: 600; }


/* 打刻を促すカード（出勤/退勤）。緑=出勤系の色に合わせる */
/* ── 今日のステータスカード ──
   ★高さを固定する。読み込み後に生えると下のメニューが押し下がり、
    押そうとしたものと別のボタンをタップしてしまう（運用者指摘・2026-08-31）。
    可変の情報は行を増やさず、説明文への追記かアクションの横並びで吸収すること。 */
/* ★box-sizing を明示する。既定の content-box だと min-height に padding+border が
   加算され、スケルトン（中身が小さい方）だけ30px高くなってページが跳ねた
   （2026-09-01 本番スモークで実測）。枠と中身の両方に効かせる。 */
.today-slot { min-height: 142px; margin-bottom: 12px; box-sizing: border-box; }
.today-card {
  /* ★高さは「最低142px」。固定＋overflow:hidden にしていたら、アクションが3つに
     なった時（出勤中＋溜まっている未提出）に見出しとボタンが切れた（2026-08-31 実機で発覚）。
     ずれを防ぐことより中身が読めることが優先。最低値を確保しておけば
     通常の状態では下のメニューは動かない。 */
  min-height: 142px;
  box-sizing: border-box;
  background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #9ca3af;
  border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; justify-content: center;
}
.today-card.working    { border-left-color: #10b981; }
.today-card.done       { border-left-color: #9ca3af; }
.today-card.off        { border-left-color: #f59e0b; }
/* ★未提出だけは目立たせる。他と同じ見た目だと素通りされる（それが今回の指摘） */
.today-card.report-due { border-left-color: #ef4444; background: #fef2f2; border-color: #fecaca; }
.today-card.not-punched{ border-left-color: #3b82f6; }

.today-head { display: flex; align-items: flex-start; gap: 10px; }
.today-icon { font-size: 24px; color: #6b7280; flex-shrink: 0; }
.today-card.report-due .today-icon { color: #ef4444; }
.today-card.working .today-icon    { color: #10b981; }
.today-texts { flex: 1; min-width: 0; }
/* ★高さを固定する。フォントやアイコンの読み込み状態で行の高さが変わると、
   カード全体が伸び縮みして下のメニューが動く（本番で26px・2026-09-01）。 */
.today-title {
  font-size: 15px; font-weight: 700; color: #1f2937; line-height: 1.4;
  height: 21px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.today-card.report-due .today-title { color: #b91c1c; }
.today-sub {
  margin-top: 3px; font-size: 12px; line-height: 1.5; color: #6b7280;
  /* ★常に2行ぶんの高さを占める。1行/2行で高さが変わると下がずれる */
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  height: 36px;
}

.today-actions { display: flex; flex-wrap: nowrap; gap: 8px; margin-top: 12px; height: 40px; }
.today-action {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 0 12px; height: 40px; border-radius: 8px;
  background: #fff; border: 1px solid #d1d5db; color: #374151;
  font-size: 13px; font-weight: 700; text-decoration: none;
  /* ★横1行に収める。折り返すとカードが伸びて下のメニューが動く。
     入り切らない時は縮めて省略する（ボタンが消えるより見えている方がよい） */
  flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.today-action .material-symbols-rounded { flex-shrink: 0; }
/* 未提出への導線は補助なので、主アクションより先に縮める */
.today-action.sub { font-weight: 600; color: #b45309; border-color: #fcd34d; background: #fffbeb; flex-shrink: 3; }
.today-action .material-symbols-rounded { font-size: 17px; }
.today-action.primary { background: #06C755; border-color: #06C755; color: #fff; }
.today-card.report-due .today-action.primary { background: #ef4444; border-color: #ef4444; }
.today-action:active { opacity: .85; }

/* 読み込み中：実カードのまま文字と色だけ伏せ、帯を絶対配置で重ねる。
   レイアウトに影響する要素を一切足さないので、高さは実カードと必ず一致する。 */
.today-card.skeleton { border-left-color: #e5e7eb; pointer-events: none; }
.today-card.skeleton .today-icon { color: #eef0f2; }
.today-card.skeleton .today-title,
.today-card.skeleton .today-sub,
.today-card.skeleton .today-action { color: transparent; position: relative; }
.today-card.skeleton .today-action { background: #fafbfc; border-color: #f1f3f5; }
.today-card.skeleton .today-action .material-symbols-rounded { color: transparent; }
.today-card.skeleton .today-title::before,
.today-card.skeleton .today-sub::before,
.today-card.skeleton .today-action::before {
  content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
  border-radius: 4px; background: #eef0f2;
  animation: skPulse 1.2s ease-in-out infinite;
}
.today-card.skeleton .today-title::before  { width: 56%; }
.today-card.skeleton .today-sub::before    { width: 88%; top: 8%; bottom: 46%; }
.today-card.skeleton .today-action::before { left: 12px; right: 12px; width: auto; }
.today-card.skeleton .today-icon { animation: skPulse 1.2s ease-in-out infinite; }
@keyframes skPulse { 0%, 100% { opacity: 1 } 50% { opacity: .55 } }

/* ── 未提出の割り込み（閉じられるが解消するまで開くたび出る） ── */
.overdue-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.overdue-modal {
  background: #fff; border-radius: 14px; padding: 24px 20px;
  width: 100%; max-width: 320px; text-align: center;
}
.overdue-icon { font-size: 40px; color: #ef4444; }
.overdue-title { margin: 10px 0 0; font-size: 16px; font-weight: 700; color: #1f2937; }
.overdue-sub   { margin: 6px 0 0; font-size: 13px; color: #6b7280; }
.overdue-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
.overdue-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 16px; min-height: 44px; border-radius: 10px;
  background: #fff; border: 1px solid #d1d5db; color: #374151;
  font-size: 14px; font-weight: 700; text-decoration: none; cursor: pointer;
}
.overdue-btn.primary { background: #ef4444; border-color: #ef4444; color: #fff; }


/* メニューグリッド */
.menu-section {
  font-size: 12px; font-weight: 700; color: #94a3b8;
  margin: 18px 2px 8px; letter-spacing: .04em;
}
.menu-section:first-of-type { margin-top: 4px; }
.menu-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.menu-grid + .menu-section { margin-top: 18px; }
.menu-card {
  background: #fff; border-radius: 14px;
  padding: 20px 12px 16px; text-decoration: none;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  transition: background .15s;
}
.menu-card:active { background: #f5f5f5; }
.menu-icon-wrap { position: relative; display: inline-flex; }
.menu-icon {
  font-size: 32px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 32;
}
.menu-card-badge {
  position: absolute; top: -4px; right: -8px;
  background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
  min-width: 16px; height: 16px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; padding: 0 4px;
}
.menu-label { font-size: 12px; font-weight: 600; color: #333; text-align: center; }
.proxy-btn { background: #fff3f3; border: none; cursor: pointer; }
.proxy-btn:active { background: #ffe4e4; }

/* 代理入力モーダル */
.proxy-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 300;
  display: flex; align-items: flex-end;
}
.proxy-modal {
  background: #fff; width: 100%; border-radius: 20px 20px 0 0;
  max-height: 70dvh; display: flex; flex-direction: column;
}
.proxy-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 20px 12px; border-bottom: 1px solid #f0f0f0;
}
.proxy-modal-title { font-size: 15px; font-weight: 700; }
.proxy-modal-close {
  background: #f5f5f5; border: none; border-radius: 50%;
  width: 28px; height: 28px; font-size: 13px; cursor: pointer; color: #555;
}
.proxy-modal-body { overflow-y: auto; padding: 8px 0 20px; }
.proxy-current {
  display: flex; align-items: center; justify-content: space-between;
  margin: 8px 16px 4px; padding: 10px 14px;
  background: #fff3f3; border-radius: 10px; font-size: 13px; color: #dc2626;
}
.proxy-clear-btn {
  background: #dc2626; color: #fff; border: none; border-radius: 6px;
  padding: 4px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.proxy-loading { padding: 24px; text-align: center; color: #888; font-size: 14px; }
.proxy-user-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; cursor: pointer; transition: background .12s;
}
.proxy-user-row:active, .proxy-user-row.selected { background: #f0fdf4; }
.proxy-user-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: #e5e7eb; color: #555; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.proxy-user-row.selected .proxy-user-avatar { background: #06C755; color: #fff; }
.proxy-user-info { flex: 1; }
.proxy-user-name { font-size: 15px; font-weight: 600; color: #111; }
.proxy-user-role { font-size: 12px; color: #888; margin-top: 2px; }
.proxy-check {
  color: #06C755; font-size: 22px;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 22;
}
</style>
