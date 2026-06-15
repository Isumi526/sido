<template>
  <div class="checkin-page">

    <!-- ローディング -->
    <div v-if="phase === 'loading'" class="center-box">
      <div class="spinner" />
      <p class="loading-text">{{ $t('common.loading') }}</p>
    </div>

    <!-- エラー -->
    <div v-else-if="phase === 'error'" class="center-box">
      <span class="material-symbols-rounded error-icon">error</span>
      <p class="error-title">{{ $t('checkin.errorTitle') }}</p>
      <p class="error-msg">{{ errorMsg }}</p>
      <p v-if="debugUrl" class="error-debug">{{ debugUrl }}</p>
    </div>

    <!-- 本日分完了済み -->
    <div v-else-if="phase === 'already-done'" class="center-box">
      <span class="material-symbols-rounded already-icon">task_alt</span>
      <p class="already-title">{{ $t('checkin.alreadyTitle') }}</p>
      <p class="already-sub">{{ siteName }}</p>
      <div class="already-logs">
        <div class="already-row">
          <span class="material-symbols-rounded log-icon checkin-icon">login</span>
          <span>{{ $t('checkin.checkinLabel') }} {{ checkinTime }}</span>
        </div>
        <div class="already-row">
          <span class="material-symbols-rounded log-icon checkout-icon">logout</span>
          <span>{{ $t('checkin.checkoutLabel') }} {{ checkoutTime }}</span>
        </div>
      </div>

      <div v-if="otherTargets.length" class="next-targets">
        <p class="next-label">{{ $t('checkin.continueOthers') }}</p>
        <button
          v-for="t in otherTargets"
          :key="t.id"
          class="next-row"
          @click="selectTarget(t.id)"
        >
          <span class="material-symbols-rounded next-icon">
            {{ t.isSelf ? 'person' : 'switch_account' }}
          </span>
          <span class="next-name">
            {{ t.name }}<span v-if="t.isSelf" class="self-tag">{{ $t('checkin.selfTag') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>
      </div>
    </div>

    <!-- 送信完了 -->
    <div v-else-if="phase === 'done'" class="center-box">
      <span class="material-symbols-rounded done-icon">check_circle</span>
      <p class="done-title">{{ $t('checkin.doneTitle', { type: attendanceType === 'checkin' ? $t('checkin.checkinLabel') : $t('checkin.checkoutLabel') }) }}</p>
      <p class="done-sub">{{ siteName }} &nbsp;/&nbsp; {{ checkedAtLabel }}</p>
      <p class="done-message">
        {{ attendanceType === 'checkin' ? $t('checkin.doneMessageCheckin') : $t('checkin.doneMessageCheckout') }}
      </p>

      <div v-if="otherTargets.length" class="next-targets">
        <p class="next-label">{{ $t('checkin.continueOthers') }}</p>
        <button
          v-for="t in otherTargets"
          :key="t.id"
          class="next-row"
          @click="selectTarget(t.id)"
        >
          <span class="material-symbols-rounded next-icon">
            {{ t.isSelf ? 'person' : 'switch_account' }}
          </span>
          <span class="next-name">
            {{ t.name }}<span v-if="t.isSelf" class="self-tag">{{ $t('checkin.selfTag') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>
      </div>
    </div>

    <!-- 対象作業員の選択（代理対象がいる場合のみ） -->
    <div v-else-if="phase === 'select-target'" class="select-wrap">
      <div class="select-header">
        <div class="site-label">{{ siteName }}</div>
        <div class="select-title">{{ $t('checkin.selectTargetTitle') }}</div>
      </div>
      <div class="target-list">
        <button
          v-for="t in targets"
          :key="t.id"
          class="target-row"
          @click="selectTarget(t.id)"
        >
          <span class="material-symbols-rounded target-icon">
            {{ t.isSelf ? 'person' : 'switch_account' }}
          </span>
          <span class="target-name">
            {{ t.name }}<span v-if="t.isSelf" class="self-tag">{{ $t('checkin.selfTag') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>
      </div>
    </div>

    <!-- チェックリスト -->
    <div v-else class="checklist-wrap">
      <div class="checklist-header" :class="attendanceType">
        <div class="site-label">{{ siteName }}</div>
        <div class="checkin-title">
          {{ attendanceType === 'checkin' ? $t('checkin.checkinConfirmTitle') : $t('checkin.checkoutConfirmTitle') }}
        </div>
        <div v-if="isProxyMode" class="proxy-badge">
          <span class="material-symbols-rounded proxy-icon">swap_horiz</span>
          {{ $t('checkin.registerAs', { name: proxyTargetName }) }}
        </div>
        <button v-if="canChangeTarget" class="change-target" @click="backToSelect">
          <span class="material-symbols-rounded">cached</span>{{ $t('checkin.changeTarget') }}
        </button>
      </div>

      <div class="rules-list">
        <div
          v-for="rule in rules"
          :key="rule.id"
          class="rule-row"
          :class="{ checked: checkedIds.has(rule.id) }"
          @click="toggle(rule.id)"
        >
          <span
            class="material-symbols-rounded check-icon"
            :class="{ active: checkedIds.has(rule.id) }"
          >
            {{ checkedIds.has(rule.id) ? 'check_box' : 'check_box_outline_blank' }}
          </span>
          <span class="rule-text">{{ rule.content }}</span>
        </div>
      </div>

      <div class="submit-area">
        <!-- 位置情報ステータス -->
        <div class="location-status" :class="locationState">
          <span class="material-symbols-rounded loc-icon">
            {{ locationState === 'granted' ? 'location_on'
               : locationState === 'pending' ? 'location_searching'
               : locationState === 'idle' ? 'my_location' : 'location_off' }}
          </span>
          <span class="loc-text">
            <template v-if="locationState === 'idle'">
              {{ $t('checkin.locIdleIntro') }}<b>{{ $t('checkin.locIdleAllow') }}</b>{{ $t('checkin.locIdleOutro') }}
              <button class="loc-get" @click="fetchLocation">{{ $t('checkin.locGetCurrent') }}</button>
              <span class="loc-note">{{ $t('checkin.locIdleNote') }}</span>
            </template>
            <template v-else-if="locationState === 'pending'">{{ $t('checkin.locPending') }}</template>
            <template v-else-if="locationState === 'granted'">
              {{ $t('checkin.locGranted', { lat: locationLat!.toFixed(5), lng: locationLng!.toFixed(5) }) }}
            </template>
            <template v-else>
              {{ $t('checkin.locUnavailable') }}
              <button class="loc-retry" @click="fetchLocation">{{ $t('checkin.locRetry') }}</button>
              <details class="loc-help">
                <summary>{{ $t('checkin.locHelpSummary') }}</summary>
                <ol class="loc-steps">
                  <li>{{ $t('checkin.locHelpStep1') }}</li>
                  <li>{{ $t('checkin.locHelpStep2Intro') }}<b>{{ $t('checkin.locHelpStep2Bold') }}</b>{{ $t('checkin.locHelpStep2Outro') }}</li>
                  <li>{{ $t('checkin.locHelpStep3') }}</li>
                </ol>
              </details>
            </template>
          </span>
        </div>

        <p class="submit-hint">
          {{ $t('checkin.checkedCount', { checked: checkedIds.size, total: rules.length }) }}
          <template v-if="allChecked && !locationResolved">
            <br><span class="submit-warn">{{ $t('checkin.submitWarn') }}</span>
          </template>
        </p>
        <button
          class="btn-submit"
          :class="attendanceType"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ submitting ? $t('checkin.submitting') : (attendanceType === 'checkin' ? $t('checkin.submitCheckin') : $t('checkin.submitCheckout')) }}
        </button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
type Phase = 'loading' | 'error' | 'select-target' | 'checklist' | 'done' | 'already-done'

type SiteRule = { id: string; content: string; timing: string }
type Target   = { id: string; name: string; isSelf: boolean }

import { useI18n } from 'vue-i18n'

const { t }    = useI18n()
const route    = useRoute()
const { profile, init: initLiff } = useLiff()
const supabase = useSupabase()
const proxy    = useProxyMode()

// LIFFが liff.init() でURLを書き換える前に、最初のURLを同期的に確保しておく
const bootSearch = typeof window !== 'undefined' ? window.location.search : ''
const bootHref   = typeof window !== 'undefined' ? window.location.href   : ''

const phase          = ref<Phase>('loading')
const errorMsg       = ref('')
const debugUrl       = ref('')
const siteId         = ref('')
const siteName       = ref('')
const rules          = ref<SiteRule[]>([])
const checkedIds     = ref(new Set<string>())
const submitting     = ref(false)
const checkedAtLabel = ref('')
const checkinTime    = ref('')
const checkoutTime   = ref('')

// 対象作業員（自分＋代理対象）
const myWorkerId = ref<string | null>(null)
const targets    = ref<Target[]>([])
const selectedId = ref<string | null>(null)

// 'checkin' | 'checkout' — 自動判定後にセット
const attendanceType = ref<'checkin' | 'checkout'>('checkin')

// 位置情報
//  pending   : 取得中
//  granted   : 取得済み
//  retryable : タイムアウト/取得不可など → 「再取得」で再度ダイアログが出せる
//  blocked   : ハッキリ拒否（ブロック）済み → JSからは再表示不可。設定からの許可が必要
// idle      : 未取得（ユーザーのタップ待ち。iOS LINEは自動要求だとダイアログ無しで拒否されるため）
type LocState = 'idle' | 'pending' | 'granted' | 'retryable' | 'blocked'
const locationState = ref<LocState>('idle')
const locationLat   = ref<number | null>(null)
const locationLng   = ref<number | null>(null)

async function fetchLocation() {
  locationState.value = 'pending'

  // geolocation API 自体が無い（＝WebViewが非対応）ケースを切り分け
  if (!('geolocation' in navigator)) {
    locationState.value = 'retryable'
    return
  }

  // ※ Permissions API は使わない（iOS/LINE内ブラウザで前回の拒否を引きずるため）。
  //   常に実際の取得を試み、その結果だけで判定する。
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0,
      })
    })
    locationLat.value   = pos.coords.latitude
    locationLng.value   = pos.coords.longitude
    locationState.value = 'granted'
  } catch (e: any) {
    // code 1=PERMISSION_DENIED(拒否), 2=POSITION_UNAVAILABLE, 3=TIMEOUT
    if (import.meta.dev) console.warn('[geolocation]', e?.code, e?.message)
    locationState.value = (e?.code === 1) ? 'blocked' : 'retryable'
  }
}

// ── 代理モード ───────────────────────────────────────────────
const selectedTarget  = computed(() => targets.value.find(t => t.id === selectedId.value) ?? null)
const isProxyMode      = computed(() => !!selectedTarget.value && !selectedTarget.value.isSelf)
const proxyTargetName  = computed(() => selectedTarget.value?.name ?? '')
const canChangeTarget  = computed(() => targets.value.length > 1)
// 完了画面で「続けて登録」できる、今登録した人以外の対象
const otherTargets     = computed(() => targets.value.filter(t => t.id !== selectedId.value))

// ── 全件チェック済みか ───────────────────────────────────────
const allChecked = computed(() =>
  rules.value.length > 0 && checkedIds.value.size === rules.value.length
)

// 位置情報の「取得を試みたか」（努力義務）。
// idle（未タップ）・pending（取得中）以外＝結果が出た状態なら送信可（拒否/失敗でも可）。
const locationResolved = computed(() =>
  locationState.value !== 'idle' && locationState.value !== 'pending'
)
const canSubmit = computed(() =>
  allChecked.value && locationResolved.value && !submitting.value
)

function toggle(id: string) {
  const next = new Set(checkedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checkedIds.value = next
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// site_id を堅牢に解決する。
// LIFFは liff.init() 内で liff.state を history.replaceState で復元するため、
// Vue Router の route.query が追随せず空になることがある。
// → route.query / 生のlocation.search / liff.state の順に探す。
function parseFromSearch(search: string): string | undefined {
  if (!search) return undefined
  const sp = new URLSearchParams(search)

  const direct = sp.get('site_id')
  if (direct) return direct

  // liff.state=%2Fcheckin%3Fsite_id%3Dxxx のように包まれているケース
  const liffState = sp.get('liff.state')
  if (liffState) {
    const decoded = decodeURIComponent(liffState)
    const qIndex  = decoded.indexOf('?')
    const qs      = qIndex >= 0 ? decoded.slice(qIndex + 1) : decoded
    const sid     = new URLSearchParams(qs).get('site_id')
    if (sid) return sid
  }
  return undefined
}

function resolveSiteId(): string | undefined {
  // ① パスパラメータ /checkin/<site_id>（liff.line.meはパスを確実に転送する）
  const fromParam = route.params.siteId
  const paramVal  = Array.isArray(fromParam) ? fromParam[0] : fromParam
  if (paramVal) return paramVal

  // ② 後方互換: クエリ ?site_id=xxx（liff.line.meが値を落とすことがあるためフォールバック）
  const fromRoute = route.query.site_id as string | undefined
  if (fromRoute) return fromRoute
  if (typeof window === 'undefined') return undefined
  return parseFromSearch(window.location.search) ?? parseFromSearch(bootSearch)
}

// 今日（JST）の開始・終了タイムスタンプ
function todayRange() {
  const now   = new Date()
  const jstOffset = 9 * 60
  const jstNow = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000)
  const ymd = `${jstNow.getFullYear()}-${String(jstNow.getMonth() + 1).padStart(2, '0')}-${String(jstNow.getDate()).padStart(2, '0')}`
  return { from: `${ymd}T00:00:00+09:00`, to: `${ymd}T23:59:59+09:00` }
}

// ── 初期化 ──────────────────────────────────────────────────
onMounted(async () => {
  await initLiff()
  let tries = 0
  while (!profile.value?.userId && tries++ < 20) {
    await new Promise(r => setTimeout(r, 300))
  }

  const lineUserId = profile.value?.userId
  if (!lineUserId) {
    errorMsg.value = t('checkin.errLineLogin')
    phase.value = 'error'
    return
  }

  const resolved = resolveSiteId()
  if (!resolved) {
    errorMsg.value = t('checkin.errNoSiteId')
    debugUrl.value = bootHref || (typeof window !== 'undefined' ? window.location.href : '')
    phase.value = 'error'
    return
  }
  siteId.value = resolved

  // 現場名取得
  const { data: siteData } = await supabase
    .from('sites').select('name').eq('id', siteId.value).single()
  if (!siteData) {
    errorMsg.value = t('checkin.errNoSite')
    phase.value = 'error'
    return
  }
  siteName.value = siteData.name

  // 自分のworker_id・氏名取得
  const { data: userData } = await supabase
    .from('users').select('worker_id').eq('line_user_id', lineUserId).maybeSingle()
  if (!userData?.worker_id) {
    await navigateTo('/register')
    return
  }
  myWorkerId.value = userData.worker_id

  const { data: myWorker } = await supabase
    .from('workers').select('name').eq('id', userData.worker_id).maybeSingle()

  // 代理対象を取得し、選択肢リストを組み立て（先頭は本人）
  await proxy.fetchProxyTargets(userData.worker_id)
  const proxyTargets = proxy.proxyTargets.value
  targets.value = [
    { id: userData.worker_id, name: myWorker?.name ?? t('checkin.defaultSelfName'), isSelf: true },
    ...proxyTargets.map(p => ({ id: p.id, name: p.name, isSelf: false })),
  ]

  // デフォルト選択: ホームで設定済みの代理対象があればそれ、なければ本人
  selectedId.value = proxy.proxyTarget.value?.id ?? userData.worker_id

  // 代理対象がいるなら選択画面、いなければ本人で直行
  if (proxyTargets.length > 0) {
    phase.value = 'select-target'
    return
  }
  await loadForTarget(userData.worker_id)
})

// ── 対象作業員を選択 ───────────────────────────────────────────
function selectTarget(id: string) {
  selectedId.value = id
  loadForTarget(id)
}

function backToSelect() {
  phase.value = 'select-target'
}

// ── 対象作業員に対して出退勤判定・ルール取得 ──────────────────
async function loadForTarget(workerId: string) {
  phase.value = 'loading'

  // 自動判定: 今日×この現場×この作業員のログを確認
  const { from, to } = todayRange()
  const { data: todayLogs } = await supabase
    .from('attendance_logs')
    .select('type, checked_at')
    .eq('site_id', siteId.value)
    .eq('worker_id', workerId)
    .gte('checked_at', from)
    .lte('checked_at', to)
    .order('checked_at')

  const hasCheckin  = todayLogs?.some(l => l.type === 'checkin')
  const hasCheckout = todayLogs?.some(l => l.type === 'checkout')

  if (hasCheckin && hasCheckout) {
    // 出退勤どちらも済み
    checkinTime.value  = fmtTime(todayLogs!.find(l => l.type === 'checkin')!.checked_at)
    checkoutTime.value = fmtTime(todayLogs!.find(l => l.type === 'checkout')!.checked_at)
    phase.value = 'already-done'
    return
  }

  // 出勤済み・退勤未 → 退勤フォーム / 両方なし → 出勤フォーム
  attendanceType.value = hasCheckin ? 'checkout' : 'checkin'

  // ルール取得（タイミングでフィルタ）
  const timings = attendanceType.value === 'checkin'
    ? ['checkin', 'both']
    : ['checkout', 'both']

  const { data: ruleData } = await supabase
    .from('site_rules')
    .select('id, content, timing')
    .eq('site_id', siteId.value)
    .in('timing', timings)
    .order('sort_order')

  rules.value      = (ruleData ?? []) as SiteRule[]
  checkedIds.value = new Set()   // 対象が変わったらチェックをリセット

  if (rules.value.length === 0) {
    errorMsg.value = t('checkin.errNoRules')
    phase.value = 'error'
    return
  }

  phase.value = 'checklist'

  // 位置情報は自動取得しない。
  // iOS LINE内ブラウザは「タップ等のユーザー操作なし」の自動要求を
  // ダイアログ無しで即拒否(code=1)しドメイン単位で記憶してしまうため、
  // 必ずユーザーのタップ（下のボタン）から要求する。
  locationState.value = 'idle'
}

// ── 送信 ────────────────────────────────────────────────────
async function submit() {
  if (!canSubmit.value) return
  submitting.value = true

  const target          = selectedTarget.value
  const workerIdToLog   = target?.id ?? myWorkerId.value
  // 本人なら null、代理なら操作者（自分）を記録
  const proxyOperatorId = (target && !target.isSelf) ? myWorkerId.value : null

  if (!workerIdToLog) {
    errorMsg.value = t('checkin.errNoWorker')
    phase.value = 'error'
    return
  }

  const { error } = await supabase
    .from('attendance_logs')
    .insert({
      site_id:           siteId.value,
      worker_id:         workerIdToLog,
      type:              attendanceType.value,
      agreed_rule_texts: rules.value.map(r => r.content),
      location_lat:      locationLat.value,
      location_lng:      locationLng.value,
      proxy_worker_id:   proxyOperatorId,
    })

  if (error) {
    errorMsg.value = t('checkin.errInsertFailed', { message: error.message })
    phase.value = 'error'
    return
  }

  const now = new Date()
  checkedAtLabel.value = t('checkin.dateLabel', {
    month: now.getMonth() + 1,
    day:   now.getDate(),
    time:  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  })
  phase.value = 'done'
  submitting.value = false
}
</script>

<style scoped>
.checkin-page {
  min-height: 100dvh;
  background: #f2f2f7;
  display: flex;
  flex-direction: column;
}

/* ── センター表示 ── */
.center-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px 24px;
  text-align: center;
}

.spinner {
  width: 40px; height: 40px;
  border: 4px solid #e0e0e0;
  border-top-color: #06C755;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { color: #888; font-size: 14px; }

.error-icon {
  font-size: 56px; color: #ef4444;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48;
}
.error-title { font-size: 17px; font-weight: 700; color: #111; }
.error-msg   { font-size: 13px; color: #666; max-width: 280px; line-height: 1.6; }
.error-debug {
  font-size: 10px; color: #999; max-width: 300px; word-break: break-all;
  background: #f5f5f5; border-radius: 6px; padding: 8px 10px; line-height: 1.5;
}

/* 完了済み */
.already-icon {
  font-size: 64px; color: #06C755;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48;
}
.already-title { font-size: 18px; font-weight: 700; color: #111; }
.already-sub   { font-size: 13px; color: #888; }
.already-logs {
  background: #f9f9f9; border-radius: 12px;
  padding: 16px 24px; display: flex; flex-direction: column; gap: 10px;
  margin-top: 8px; width: 100%; max-width: 280px;
}
.already-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; font-weight: 600; color: #333;
}
.log-icon {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}
.checkin-icon  { color: #06C755; }
.checkout-icon { color: #f59e0b; }

/* 登録完了 */
.done-icon {
  font-size: 72px; color: #06C755;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48;
}
.done-title { font-size: 20px; font-weight: 700; color: #111; }
.done-sub   { font-size: 13px; color: #888; }
.done-message { font-size: 15px; font-weight: 600; color: #06C755; margin-top: 8px; }

/* ── チェックリスト ── */
.checklist-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
  padding: 0 0 32px;
}

.checklist-header {
  padding: 28px 20px 20px;
  color: #fff;
}
.checklist-header.checkin  { background: #06C755; }
.checklist-header.checkout { background: #f59e0b; }

.site-label    { font-size: 12px; opacity: .85; margin-bottom: 4px; }
.checkin-title { font-size: 20px; font-weight: 700; }

.proxy-badge {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 10px; background: rgba(255,255,255,.2);
  border-radius: 20px; padding: 4px 12px;
  font-size: 12px; font-weight: 600;
}
.proxy-icon {
  font-size: 16px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16;
}

.change-target {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 12px; background: rgba(255,255,255,.18);
  border: none; border-radius: 20px; padding: 5px 12px;
  color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
}
.change-target .material-symbols-rounded {
  font-size: 15px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 16;
}

/* ── 対象作業員の選択 ── */
.select-wrap {
  flex: 1; display: flex; flex-direction: column;
  max-width: 480px; width: 100%; margin: 0 auto;
}
.select-header {
  padding: 28px 20px 20px; background: #06C755; color: #fff;
}
.select-title { font-size: 20px; font-weight: 700; }

.target-list { padding: 12px 0; }
.target-row {
  display: flex; align-items: center; gap: 14px; width: 100%;
  padding: 18px 20px; background: #fff; border: none;
  border-bottom: 1px solid #f0f0f0; cursor: pointer;
  text-align: left; transition: background .12s;
  -webkit-tap-highlight-color: transparent;
}
.target-row:active { background: #e8f9ee; }
.target-icon {
  font-size: 26px; color: #06C755; flex-shrink: 0;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
.target-name {
  flex: 1; font-size: 16px; font-weight: 600; color: #222;
  display: flex; align-items: center; gap: 8px;
}
.self-tag {
  background: #06C755; color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 6px; padding: 2px 8px;
}
.chev {
  font-size: 22px; color: #ccc; flex-shrink: 0;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
}

/* ── 完了画面: 続けて他の人を登録 ── */
.next-targets {
  width: 100%; max-width: 320px; margin-top: 24px;
  display: flex; flex-direction: column; gap: 8px;
}
.next-label {
  font-size: 12px; font-weight: 600; color: #888;
  text-align: left; margin: 0 0 2px 2px;
}
.next-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 14px 16px; background: #fff; border: 1px solid #e8e8ed;
  border-radius: 12px; cursor: pointer; text-align: left;
  transition: background .12s;
  -webkit-tap-highlight-color: transparent;
}
.next-row:active { background: #f0fdf4; }
.next-icon {
  font-size: 22px; color: #06C755; flex-shrink: 0;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
.next-name {
  flex: 1; font-size: 15px; font-weight: 600; color: #222;
  display: flex; align-items: center; gap: 8px;
}

.rules-list { flex: 1; padding: 12px 0; overflow-y: auto; }

.rule-row {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 16px 20px; background: #fff;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer; transition: background .12s;
  -webkit-tap-highlight-color: transparent;
}
.rule-row.checked { background: #f0fdf4; }
.rule-row:active  { background: #e8f9ee; }

.check-icon {
  font-size: 26px; color: #ccc; flex-shrink: 0; margin-top: 1px;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  transition: color .15s;
}
.check-icon.active { color: #06C755; }

.rule-text { font-size: 15px; line-height: 1.6; color: #222; flex: 1; }

.submit-area {
  padding: 16px 20px 20px; background: #fff; border-top: 1px solid #f0f0f0;
  display: flex; flex-direction: column; gap: 12px;
}

/* 位置情報ステータス */
.location-status {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px; font-size: 12px; font-weight: 600;
}
.location-status.idle      { background: #eff6ff; color: #1d4ed8; }
.location-status.pending   { background: #f5f5f5; color: #888; }
.location-status.granted   { background: #f0fdf4; color: #166534; }
.location-status.retryable,
.location-status.blocked   { background: #fffbeb; color: #92400e; }

.loc-icon {
  font-size: 18px; flex-shrink: 0;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
}
.loc-text { flex: 1; line-height: 1.5; }
.loc-note { font-weight: 400; opacity: .8; }

.loc-help { margin-top: 8px; font-weight: 400; }
.loc-help summary {
  cursor: pointer; font-size: 11px; font-weight: 600;
  text-decoration: underline; opacity: .85; list-style: none;
}
.loc-help summary::-webkit-details-marker { display: none; }
.loc-steps {
  margin: 8px 0 0; padding-left: 18px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 11px; line-height: 1.5; color: #92400e;
}

.loc-retry {
  display: inline-block; margin-left: 8px;
  background: none; border: 1px solid #fca5a5; color: #ef4444;
  border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.loc-get {
  display: inline-block; margin-left: 8px;
  background: #2563eb; border: none; color: #fff;
  border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
}

.submit-hint {
  font-size: 12px; color: #888; text-align: center; margin: 0; line-height: 1.6;
}
.submit-warn { color: #d97706; font-weight: 600; }
.btn-submit {
  width: 100%; border: none; border-radius: 12px; padding: 16px;
  font-size: 16px; font-weight: 700; cursor: pointer; color: #fff;
  transition: opacity .15s;
}
.btn-submit.checkin  { background: #06C755; }
.btn-submit.checkout { background: #f59e0b; }
.btn-submit:disabled { opacity: .35; cursor: default; }
</style>
