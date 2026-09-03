<template>
  <div>
    <AppNav :subtitle="$t('nav.checkin')" />
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

      <!-- ★押し間違いに気づくのはこの画面。ここから辿れないと直せない（2026-09-03）。
           「今日はもう退勤済み」＝間違って退勤を押してしまった人が最初に見る画面でもある。 -->
      <!-- ★打刻の本筋ではないので畳んで置く（入力フォーム側と同じ扱いに揃える）。
           後追い入力もここから辿れるようにする＝「打刻が思ったとおりでない」時に
           人が探す場所を1つにまとめる（2026-09-03）。 -->
      <details class="more-actions fix-slot" data-testid="more-actions">
        <summary>{{ $t('checkin.moreActions') }}</summary>
        <div class="more-actions-body">
          <LatePunchPanel :worker-id="myWorkerId" />
          <PunchCorrectionPanel :worker-id="myWorkerId" @applied="reloadPunchState()" />
        </div>
      </details>
    </div>

    <!-- 送信完了 -->
    <div v-else-if="phase === 'done'" class="center-box">
      <span class="material-symbols-rounded done-icon">check_circle</span>
      <p class="done-title">{{ $t('checkin.doneTitle', { type: attendanceType === 'checkin' ? $t('checkin.checkinLabel') : $t('checkin.checkoutLabel') }) }}</p>
      <p class="done-sub">{{ checkedAtLabel }}</p>
      <p class="done-message">
        {{ attendanceType === 'checkin' ? $t('checkin.doneMessageCheckin') : $t('checkin.doneMessageCheckout') }}
      </p>

      <!-- ★退勤したらそのまま日報へ。打刻と日報の二度手間をなくし、退勤を押す癖をつけるため
           （2026-08-10 運用者要望）。出勤打刻・代理打刻・その日の日報が既にある時は出さない。
           ★2026-08-31: 完了画面で止めると、ここで日報の動線に気づかずアプリを閉じる人が出る。
            数秒だけ見せて自動で日報へ送る（リンクは自動遷移が効かない時の逃げ道として残す）。 -->
      <NuxtLink v-if="reportLink" :to="reportLink" class="report-cta" data-testid="checkout-report-link">
        <span class="material-symbols-rounded">edit_note</span>
        {{ $t('checkin.writeReport') }}
      </NuxtLink>

      <!-- 出勤直後の次アクション。ここが空だと「打刻して終わり」に見え、
           残業申請も退勤も別の入口を探すことになる（2026-08-31 運用者指摘）。 -->
      <div v-if="attendanceType === 'checkin' && !isProxyMode" class="next-actions">
        <NuxtLink to="/overtime" class="next-action" data-testid="done-overtime">
          <span class="material-symbols-rounded">more_time</span>{{ $t('checkin.nextOvertime') }}
        </NuxtLink>
        <button class="next-action secondary" data-testid="done-checkout" @click="loadForTarget(selectedId!)">
          <span class="material-symbols-rounded">logout</span>{{ $t('checkin.nextCheckout') }}
        </button>
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

      <!-- ★押した直後に「今のは間違いだった」と気づく人が一番多い。ここに置く（2026-09-03） -->
      <!-- ★打刻の本筋ではないので畳んで置く（入力フォーム側と同じ扱いに揃える）。
           後追い入力もここから辿れるようにする＝「打刻が思ったとおりでない」時に
           人が探す場所を1つにまとめる（2026-09-03）。 -->
      <details class="more-actions fix-slot" data-testid="more-actions">
        <summary>{{ $t('checkin.moreActions') }}</summary>
        <div class="more-actions-body">
          <LatePunchPanel :worker-id="myWorkerId" />
          <PunchCorrectionPanel :worker-id="myWorkerId" @applied="reloadPunchState()" />
        </div>
      </details>
    </div>

    <!-- ★稼働有無ゲート（出勤打刻の前に1回だけ・2026-08-31）。
         休みの日に出退勤フォームを触らせないための入口。ここでの回答が稼働有無の権威で、
         日報側の稼働有無セレクタはこの答えの引き継ぎ表示になる（＝二度聞かない）。 -->
    <div v-else-if="phase === 'work-status'" class="ws-wrap" data-testid="work-status">
      <div class="ws-head">
        <div class="ws-date">
          <span class="material-symbols-rounded">event</span>{{ punchDateLabel }}
        </div>
        <p class="ws-title">{{ $t('checkin.wsTitle') }}</p>
        <p class="ws-lead">{{ $t('checkin.wsLead') }}</p>
      </div>

      <div class="ws-options">
        <button
          class="ws-option working"
          data-testid="ws-working"
          :disabled="savingStatus"
          @click="answerWorkStatus('working')"
        >
          <span class="material-symbols-rounded ws-icon">how_to_reg</span>
          <span class="ws-body">
            <span class="ws-label">{{ $t('checkin.wsWorking') }}</span>
            <span class="ws-desc">{{ $t('checkin.wsWorkingDesc') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>

        <button
          class="ws-option leave"
          data-testid="ws-paid-leave"
          :disabled="savingStatus"
          @click="answerWorkStatus('paid_leave')"
        >
          <span class="material-symbols-rounded ws-icon">beach_access</span>
          <span class="ws-body">
            <span class="ws-label">{{ $t('checkin.wsPaidLeave') }}</span>
            <span class="ws-desc">{{ $t('checkin.wsPaidLeaveDesc') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>

        <button
          class="ws-option off"
          data-testid="ws-off"
          :disabled="savingStatus"
          @click="answerWorkStatus('off')"
        >
          <span class="material-symbols-rounded ws-icon">bedtime</span>
          <span class="ws-body">
            <span class="ws-label">{{ $t('checkin.wsOff') }}</span>
            <span class="ws-desc">{{ $t('checkin.wsOffDesc') }}</span>
          </span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </button>
      </div>

      <p class="ws-note">{{ $t('checkin.wsNote') }}</p>
    </div>

    <!-- 稼働なし/有給で日報だけ出し終えた完了画面（打刻はしない） -->
    <div v-else-if="phase === 'off-done'" class="center-box" data-testid="off-done">
      <span class="material-symbols-rounded done-icon">check_circle</span>
      <p class="done-title">{{ $t('checkin.offDoneTitle') }}</p>
      <p class="done-sub">
        {{ punchDateLabel }} ／
        {{ offStatus === 'paid_leave' ? $t('checkin.wsPaidLeave') : $t('checkin.wsOff') }}
      </p>
      <p class="done-message">{{ $t('checkin.offDoneMessage') }}</p>
      <!-- 休みでも経費（移動日のガソリン等）が出ることはあるので、開く手段は残す -->
      <NuxtLink :to="`/report?date=${todayStr()}`" class="off-done-sub-link" data-testid="off-done-open-report">
        {{ $t('checkin.offDoneOpenReport') }}
      </NuxtLink>
      <!-- 気が変わって出ることになった時の逃げ道（無いと今日は一切打刻できなくなる） -->
      <button class="off-done-sub-link" data-testid="off-done-switch-working" @click="enterChecklist">
        {{ $t('checkin.offDoneSwitchWorking') }}
      </button>
    </div>

    <div v-else-if="phase === 'select-target'" class="select-wrap">
      <div class="select-header">
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
        <div class="punch-date" data-testid="punch-date">
          <span class="material-symbols-rounded">event</span>{{ $t('checkin.punchDateNote', { date: punchDateLabel }) }}
        </div>
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

      <!-- ★1画面に全部出さず、1ステップ1仕事にする（2026-09-03 運用者指摘
           「コンテンツ量が多すぎて画面を圧迫している」）。
           ルール確認 → 現在地の取得 → 記録 の順。前の条件が満たされると自動で次へ進む。 -->
      <div v-if="stepList.length > 1" class="step-bar" data-testid="step-bar">
        <div
          v-for="(st, i) in stepList"
          :key="st"
          class="step-dot"
          :class="{ done: stepIndex > i, current: stepIndex === i }"
        >
          <span class="step-num">
            <span v-if="stepIndex > i" class="material-symbols-rounded">check</span>
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="step-name">{{ stepLabel(st) }}</span>
        </div>
      </div>

      <div class="checklist-scroll">
        <!-- 済んだステップは1行に畳む。タップで開き直せる＝チェックし間違えても戻れる -->
        <button
          v-if="punchStep !== 'rules' && rules.length"
          class="step-done-row" data-testid="step-done-rules" @click="stepOverride = 'rules'"
        >
          <span class="material-symbols-rounded">check_circle</span>
          <span>{{ $t('checkin.stepRulesDone', { n: rules.length }) }}</span>
          <span class="step-reopen">{{ $t('checkin.stepReopen') }}</span>
        </button>
        <button
          v-if="punchStep === 'submit' && locationState === 'granted'"
          class="step-done-row" data-testid="step-done-location" @click="stepOverride = 'location'"
        >
          <span class="material-symbols-rounded">check_circle</span>
          <span>{{ $t('checkin.stepLocationDone') }}</span>
          <span class="step-reopen">{{ $t('checkin.stepReopen') }}</span>
        </button>

        <!-- ① 確認事項 -->
        <template v-if="punchStep === 'rules'">
          <p v-if="rules.length === 0" class="no-rules-note">{{ $t('checkin.noRulesNote') }}</p>
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
        </template>

        <!-- ② 現在地の取得。取れた／断られた時点で自動で次へ進む -->
        <div v-else-if="punchStep === 'location'" class="location-status" :class="locationState" data-testid="location-step">
          <span class="material-symbols-rounded loc-icon">
            {{ locationState === 'granted' ? 'location_on'
               : locationState === 'pending' ? 'location_searching'
               : locationState === 'idle' ? 'my_location' : 'location_off' }}
          </span>
          <span class="loc-text">
            <template v-if="locationState === 'idle'">
              <span class="loc-lead">{{ $t('checkin.locIdleIntro') }}<b>{{ $t('checkin.locIdleAllow') }}</b>{{ $t('checkin.locIdleOutro') }}</span>
              <button class="loc-get" data-testid="loc-get" @click="fetchLocation">
                <span class="material-symbols-rounded loc-get-icon">my_location</span>{{ $t('checkin.locGetCurrent') }}
              </button>
              <span class="loc-note">{{ $t('checkin.locIdleNote') }}</span>
            </template>
            <template v-else-if="locationState === 'pending'">{{ $t('checkin.locPending') }}</template>
            <template v-else-if="locationState === 'granted'">
              {{ $t('checkin.locGranted', { lat: locationLat!.toFixed(5), lng: locationLng!.toFixed(5) }) }}
            </template>
            <template v-else>
              <span class="loc-lead">{{ $t('checkin.locUnavailable') }}</span>
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

        <!-- ③ 記録するだけの画面。ここに他のものを足さないこと（足すと元の木阿弥） -->
        <p v-else class="step-ready" data-testid="step-ready">
          {{ attendanceType === 'checkin' ? $t('checkin.stepReadyCheckin') : $t('checkin.stepReadyCheckout') }}
          <!-- ★位置情報が取れなくても記録はできる（努力義務）。ここで「取得を押してから」と
               出すと、押せないのに押せと言う矛盾した表示になる（2026-09-03 実機で発覚）。 -->
          <span v-if="locationState !== 'granted'" class="step-ready-note">{{ $t('checkin.stepNoLocationNote') }}</span>
        </p>

        <!-- ★後追い入力と修正申請は打刻の本筋ではない。最後のステップでだけ、
             しかも畳んだ1行として出す（2026-09-03 運用者指摘）。 -->
        <details v-if="punchStep === 'submit'" class="more-actions" data-testid="more-actions">
          <summary>{{ $t('checkin.moreActions') }}</summary>
          <div class="more-actions-body">
            <!-- ★記録後に画面を再読込しない。再読込するとこの画面ごと作り直されてパネルが
                 unmount され、「記録しました」の表示が一瞬で消える。 -->
            <LatePunchPanel :worker-id="myWorkerId" />
            <PunchCorrectionPanel :worker-id="myWorkerId" @applied="reloadPunchState()" />
          </div>
        </details>
      </div>

      <div class="submit-area">
        <p v-if="punchStep === 'rules' && rules.length" class="submit-hint">
          {{ $t('checkin.checkedCount', { checked: checkedIds.size, total: rules.length }) }}
        </p>
        <!-- ★戻って開き直した時だけ「次へ」を出す。通常は条件が揃った時点で自動で進む -->
        <button
          v-if="stepOverride && stepDoneForOverride"
          class="btn-submit" :class="attendanceType" data-testid="step-next"
          @click="stepOverride = null"
        >{{ $t('checkin.stepNext') }}</button>
        <button
          v-else-if="punchStep === 'submit'"
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

  </div>
</template>

<script setup lang="ts">
// ★2026-08-27 出退勤モデル変更: 現場ごとの打刻をやめ、1日＝最初の出勤・最後の退勤の2回にした。
//  これに伴い現場選択('select-site')と出勤中の現場フォーカス('checked-in-focus')は不要になり削除。
//  ルートは /checkin/<siteId> のまま残す（現場に貼ってある旧QRを開いても 404 にしないため。
//  siteId は受け取るだけで打刻には使わない）。
// 'work-status' … 出勤打刻の前に「今日は稼働ありますか」を1回だけ聞く画面（2026-08-31）。
//   休みでも週7で日報を出させる運用なのに、休みの日まで出退勤フォームを触らせていたのを直す。
//   稼働なし/有給を選んだらここで日報(is_working=false)を保存して終わる＝打刻フォームに進ませない。
//   これで「稼働有無を打刻前と日報で二度聞く」重複も消える（権威はこの回答）。
// 'off-done'    … 上で日報だけ保存し終えた完了画面。
type Phase = 'loading' | 'error' | 'select-target' | 'work-status' | 'off-done' | 'checklist' | 'done' | 'already-done'

// 打刻前に聞く稼働有無。日報の 稼働あり/有給/稼働なし と 1:1 に対応させる
// （語彙をズラすと引き継ぎのたびに変換が要り、食い違いの温床になる）。
type WorkStatus = 'working' | 'paid_leave' | 'off'

type AttendanceRule = { id: string; content: string; timing: string }
type Target   = { id: string; name: string; isSelf: boolean }

import { useI18n } from 'vue-i18n'
import { todayStr } from '~/composables/schedule-core.gen'

const { t }    = useI18n()
const route    = useRoute()
const { profile, init: initLiff, getIdToken } = useLiff()
const supabase = useSupabase()
const proxy    = useProxyMode()

// LIFFが liff.init() でURLを書き換える前に、最初のURLを同期的に確保しておく
const bootSearch = typeof window !== 'undefined' ? window.location.search : ''
const bootHref   = typeof window !== 'undefined' ? window.location.href   : ''

const phase          = ref<Phase>('loading')
const errorMsg       = ref('')
const debugUrl       = ref('')
const rules          = ref<AttendanceRule[]>([])
const checkedIds     = ref(new Set<string>())
const submitting     = ref(false)
const checkedAtLabel = ref('')

// ★打刻は常に「今」を記録する（対象日を選ぶ手段は無い）が、数日分まとめて打刻する人がいて
//  「今押したらどの日の記録になるか」が画面から分からなかった（大塚さん指摘・2026-08-27）。
//  確認画面の見出しに常時表示する。
const punchDateLabel = computed(() => {
  const d = new Date()
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`
})
// 退勤打刻の完了画面に出す「日報を書く」リンク。空なら出さない（resolveReportLink 参照）
const reportLink     = ref('')
const checkinTime    = ref('')
const checkoutTime   = ref('')

// 対象作業員（自分＋代理対象）
const attendanceLog = useAttendanceLog()
const myWorkerId = ref<string | null>(null)

// 稼働有無ゲート（work-status フェーズ）
// ★composable は setup の中で解決しておく。クリックハンドラの中で useExpense() を呼ぶと
//  「Must be called at the top of a `setup` function」で保存が丸ごと失敗する（E2Eで検出・2026-08-31）。
const expense        = useExpense()
const dailyReportsApi = useDailyReportsApi()
const myUserId       = ref<string | null>(null)
const savingStatus   = ref(false)
const offStatus      = ref<WorkStatus>('off')   // off-done 画面で何を出したか表示するため


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

// ── 全件チェック済みか（ルール未設定=確認事項なし＝チェック条件は満たす扱い）──
const allChecked = computed(() =>
  rules.value.length === 0 || checkedIds.value.size === rules.value.length
)

// 位置情報の「取得を試みたか」（努力義務）。
// idle（未タップ）・pending（取得中）以外＝結果が出た状態なら送信可（拒否/失敗でも可）。
const locationResolved = computed(() =>
  locationState.value !== 'idle' && locationState.value !== 'pending'
)
const canSubmit = computed(() =>
  allChecked.value && locationResolved.value && !submitting.value
)

// ── 打刻をステップ式に出す（2026-09-03 運用者指摘「コンテンツ量が多すぎて画面を圧迫」）──
//  ルール確認 → 現在地の取得 → 記録。★状態から導出する（手で進める番号を持たない）。
//  番号を状態として持つと、途中で位置情報が失効した時などに画面と実態がずれる。
type PunchStep = 'rules' | 'location' | 'submit'
/** 済んだステップを開き直している時だけ入る。次へで解除して導出値に戻る */
const stepOverride = ref<PunchStep | null>(null)
const punchStep = computed<PunchStep>(() => {
  if (stepOverride.value) return stepOverride.value
  if (rules.value.length && !allChecked.value) return 'rules'
  if (!locationResolved.value) return 'location'
  return 'submit'
})
/** 出すステップの並び。確認事項が無い会社では2段階になる */
const stepList = computed<PunchStep[]>(() =>
  rules.value.length ? ['rules', 'location', 'submit'] : ['location', 'submit'])
const stepIndex = computed(() => Math.max(0, stepList.value.indexOf(punchStep.value)))
function stepLabel(st: PunchStep): string {
  return st === 'rules' ? t('checkin.stepRules')
    : st === 'location' ? t('checkin.stepLocation')
    : t('checkin.stepSubmit')
}
/** 開き直したステップの条件が満たされているか（「次へ」を出してよいか） */
const stepDoneForOverride = computed(() =>
  stepOverride.value === 'rules' ? allChecked.value
    : stepOverride.value === 'location' ? locationResolved.value
    : true)

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
// JST基準の年月日文字列（YYYY-MM-DD）
function jstYmd(d: Date): string {
  const jstOffset = 9 * 60
  const jst = new Date(d.getTime() + (jstOffset + d.getTimezoneOffset()) * 60000)
  return `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, '0')}-${String(jst.getDate()).padStart(2, '0')}`
}
// 指定ISO時刻がJSTで「今日」か
function isJstToday(iso: string): boolean {
  return jstYmd(new Date(iso)) === jstYmd(new Date())
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

  // ★現場は解決しない（出退勤モデル変更・2026-08-27）。1日＝出勤/退勤の2回で、
  //  どの現場かは打刻に紐づけない。旧QR経由（/checkin/<id>）で来ても現場は無視して進む。
  await proceedToPunch()
})

// ── 打刻フローの本体（現場に依存しない）──
async function proceedToPunch() {
  // 自分のworker_id・氏名取得
  // email/pw は worker_id 経由・LINEは line_user_id（単一ソース解決）
  const me = await useCurrentUser().resolve()
  if (!me?.worker_id) {
    await navigateTo('/register')
    return
  }
  myWorkerId.value = me.worker_id

  const { data: myWorker } = await supabase
    .from('workers').select('name').eq('id', me.worker_id).maybeSingle()

  // 代理対象を取得し、選択肢リストを組み立て（先頭は本人）
  await proxy.fetchProxyTargets(me.worker_id)
  const proxyTargets = proxy.proxyTargets.value
  targets.value = [
    { id: me.worker_id, name: myWorker?.name ?? t('checkin.defaultSelfName'), isSelf: true },
    ...proxyTargets.map(p => ({ id: p.id, name: p.name, isSelf: false })),
  ]

  // デフォルト選択: ホームで設定済みの代理対象があればそれ、なければ本人
  selectedId.value = proxy.proxyTarget.value?.id ?? me.worker_id

  // 代理対象がいるなら選択画面、いなければ本人で直行
  if (proxyTargets.length > 0) {
    phase.value = 'select-target'
    return
  }
  await loadForTarget(me.worker_id)
}

// ── 対象作業員を選択 ───────────────────────────────────────────
function selectTarget(id: string) {
  selectedId.value = id
  loadForTarget(id)
}

function backToSelect() {
  phase.value = 'select-target'
}

/**
 * 打刻の修正が承認された後に、出勤/退勤の判定を引き直す（2026-09-03）。
 * ★自動では呼ばない。人がパネルの「打刻の状態を更新」を押した時だけ。
 *  自動で作り直すとパネルごと unmount され、「承認されました」の表示が一瞬で消える。
 */
function reloadPunchState() {
  const id = selectedId.value ?? myWorkerId.value
  if (id) void loadForTarget(id)
}

// ── 対象作業員に対して出退勤判定・ルール取得 ──────────────────
async function loadForTarget(workerId: string) {
  phase.value = 'loading'

  // 自動判定: この作業員の「直近サイクル」で判定する。
  //  ★2026-08-27 出退勤モデル変更で現場では絞らない（1日＝最初の出勤・最後の退勤の2回）。
  //  ★夜勤の日跨ぎ対応: 当日(カレンダー日)固定だと、前日夜の出勤が拾えず翌朝の退勤ができなかった。
  //   直近20時間のログを見て「未退勤の出勤が残っていれば退勤」＝日を跨いでも退勤できる。
  //  ★EF経由。代理対象の分もEF側で代理許可を確認したうえで返る。
  const logs = await attendanceLog.recent(20, workerId) as { type: string; checked_at: string }[]
  const last = logs[logs.length - 1]

  if (last?.type === 'checkin') {
    // 出勤中・退勤未（前日夜の出勤でもここに来る）→ 退勤フォーム
    attendanceType.value = 'checkout'
    checkinTime.value = fmtTime(last.checked_at)
  } else if (last?.type === 'checkout' && isJstToday(last.checked_at)) {
    // 本日すでに退勤済み（＝直近サイクル完了）→ 完了画面。直近の出勤とセットで表示。
    const lastCheckin = [...logs].reverse().find(l => l.type === 'checkin')
    checkinTime.value  = lastCheckin ? fmtTime(lastCheckin.checked_at) : '—'
    checkoutTime.value = fmtTime(last.checked_at)
    phase.value = 'already-done'
    return
  } else {
    // 未打刻 or 前回退勤が本日でない（＝新しいシフト）→ 出勤フォーム
    attendanceType.value = 'checkin'

    // ★出勤打刻の前に「今日は稼働ありますか」を1回だけ聞く（2026-08-31）。
    //  ・本人の分だけ聞く（代理で他人の稼働有無や有給は決めさせない）
    //  ・その日の日報を既に出していれば聞かない（＝答えは出ている。二度聞かない）
    if (workerId === myWorkerId.value) {
      const rep = await fetchTodayReport()
      if (rep === null) {
        phase.value = 'work-status'
        return
      }
      // ★既に「今日は休み/有給」と出している日は、打刻フォームに入れない。
      //  ここを素通しにすると、休みと申告した日に出勤打刻が付いて
      //  admin の「出勤打刻なし」判定（日報の稼働有無で除外している）と矛盾する。
      //  気が変わった時のために、この画面から稼働ありへ切り替える導線は出す。
      if (rep && rep.is_working === false) {
        offStatus.value = rep.leave_type === 'paid_leave' ? 'paid_leave' : 'off'
        phase.value = 'off-done'
        return
      }
      // rep === undefined（判定できない）時は聞かずに従来どおり打刻へ進む。
      // 判定不能を理由に打刻を止めると、通信が不安定なだけで勤怠が付けられなくなる。
    }
  }

  // ルール取得〜確認画面は enterChecklist に集約（稼働有無ゲートからも同じ経路で入るため）。
  await enterChecklist()
}

/**
 * 自分の users.id を解決してキャッシュする（日報の読み書きは worker_id ではなく user_id が鍵）。
 */
async function resolveMyUserId(): Promise<string | null> {
  if (myUserId.value) return myUserId.value
  if (!myWorkerId.value) return null
  const { data: u } = await supabase.from('users')
    .select('id').eq('worker_id', myWorkerId.value).maybeSingle()
  myUserId.value = u?.id ?? null
  return myUserId.value
}

/**
 * 今日の日報を引く。オブジェクト=ある / null=無い / undefined=判定できなかった。
 * ★null と undefined を混ぜないこと。混ぜると「通信が不安定なだけ」で
 *  稼働有無を聞き直したり、逆に打刻を止めたりしてしまう。
 */
async function fetchTodayReport(): Promise<any | null | undefined> {
  try {
    const uid = await resolveMyUserId()
    if (!uid) return undefined
    // ★EF経由（daily_reports の直読みは他テナント分まで読めるため塞いである・2026-08-15）
    const rep = await dailyReportsApi.one(todayStr(), uid)
    return rep?.id ? rep : null
  } catch {
    return undefined
  }
}

/**
 * 稼働有無ゲートの回答を確定する。
 *  ・稼働あり → そのまま出勤打刻の確認画面へ（日報は退勤後に書く）
 *  ・有給/稼働なし → ここで日報を is_working=false で保存して終了。打刻はさせない
 *    （休みの日に出退勤フォームを触らせないのが、このゲートを入れた目的）
 */
async function answerWorkStatus(status: WorkStatus) {
  if (savingStatus.value) return

  if (status === 'working') {
    await enterChecklist()
    return
  }

  savingStatus.value = true
  errorMsg.value = ''
  try {
    const uid = await resolveMyUserId()
    if (!uid) throw new Error(t('checkin.errNoWorker'))
    await expense.saveReportById(uid, {
      date:      todayStr(),
      isWorking: false,
      sites:     [],
      // 有給は日報と同じ持ち方（leave_type='paid_leave' + leave_days=1）。
      // 半休・時間単位有給はその日働くので「稼働あり」を選ばせる（画面に注記あり）。
      leaveType: status === 'paid_leave' ? 'paid_leave' : null,
      leaveDays: status === 'paid_leave' ? 1 : null,
    })
    offStatus.value = status
    phase.value = 'off-done'
  } catch (e: any) {
    // ★保存できていないのに完了に見せない
    errorMsg.value = t('checkin.errStatusSaveFailed', { message: e?.message ?? '' })
    phase.value = 'error'
  } finally {
    savingStatus.value = false
  }
}

/**
 * 確認事項（アカウント共通ルール・出勤/退勤それぞれのタイミング分）を読んで確認画面へ入る。
 * ★現場別ルール(site_rules)から置き換え済み（2026-08-27）。現場特有の内容は
 *  「送り出し資料」の承認フローへ移したので、打刻には出さない。
 */
async function enterChecklist() {
  phase.value = 'loading'
  try {
    rules.value = await attendanceLog.rules(attendanceType.value)
  } catch {
    // ルールが引けない時に「確認事項なし」で通すと、同意記録が空のまま打刻できてしまう
    errorMsg.value = t('checkin.errNoRules')
    phase.value = 'error'
    return
  }
  checkedIds.value = new Set()   // 対象が変わったらチェックをリセット
  // ルール未設定でもシンプル出退勤として継続（確認事項なし＝allChecked が true 扱い）。
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
  // ★どの経路で抜けても必ず戻す。以前は失敗時に立てっぱなしで、
  //  エラー画面から戻っても送信ボタンが押せないままだった（独立レビュー指摘・2026-08-31）。
  //  ★打刻は追記専用の記録なので、二重送信の実害が大きい。ここのガードを外さないこと。
  try {
    await doSubmit()
  } finally {
    submitting.value = false
  }
}

async function doSubmit() {
  const target          = selectedTarget.value
  const workerIdToLog   = target?.id ?? myWorkerId.value
  // 本人なら null、代理なら操作者（自分）を記録
  const proxyOperatorId = (target && !target.isSelf) ? myWorkerId.value : null

  if (!workerIdToLog) {
    errorMsg.value = t('checkin.errNoWorker')
    phase.value = 'error'
    return
  }

  // ★EF経由。打刻の時刻はサーバが決める（クライアントに決めさせると過去日時を送って
  //  勤怠の証跡を偽造できる）。代理かどうかもEF側で worker_proxies を見て判定する。
  void proxyOperatorId
  const res = await attendanceLog.punch({
    // ★現場は送らない（出退勤モデル変更・2026-08-27）
    type: attendanceType.value as 'checkin' | 'checkout',
    targetWorkerId: workerIdToLog,
    agreedRuleTexts: rules.value.map(r => r.content),
    lat: locationLat.value,
    lng: locationLng.value,
  })

  if (!res.ok) {
    errorMsg.value = t('checkin.errInsertFailed', { message: res.error ?? '' })
    phase.value = 'error'
    return
  }

  const now = new Date()
  checkedAtLabel.value = t('checkin.dateLabel', {
    month: now.getMonth() + 1,
    day:   now.getDate(),
    time:  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  })
  await resolveReportLink(target)

  // ★退勤したら完了画面を挟まず、そのまま日報画面へ送る（2026-08-31 運用者指摘:
  //  「一旦ページ表示された時点で離脱してしまうケースがある」）。
  //  完了の手応えは遷移先の日報画面が中央のオーバーレイで出す（punched= で時刻を渡す）。
  //  ここで phase='done' を経由しないこと——一瞬でも完了画面が描画されると、
  //  そこで閉じられる余地が残る（完了画面を挟むのをやめたのが今回の主旨）。
  if (reportLink.value) {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    await navigateTo(`${reportLink.value}&from=checkout&punched=${hhmm}`)
    return
  }

  // 出勤打刻・代理打刻・その日の日報が既にある時は従来どおり完了画面を出す
  // （次にやることが日報ではないので、飛ばす先が無い）。
  phase.value = 'done'
}

/**
 * 退勤打刻のあと「日報を書く」導線を出すか決める（2026-08-10 運用者要望）。
 * 狙いは打刻と日報の二度手間をなくすことと、退勤を押す癖をつけること。
 *
 * 出さない条件:
 *  ・出勤打刻（まだ日報は書けない）
 *  ・代理打刻（他人の日報を書かせない）
 *  ・その日の日報を既に出している（二重送信を誘発しない）
 */
async function resolveReportLink(target: Target | null) {
  reportLink.value = ''
  if (attendanceType.value !== 'checkout') return
  if (target && !target.isSelf) return

  const date = todayStr()
  // ★判定できない(undefined)時も出さない。出して二重送信させるより、出さない方が安全。
  if (await fetchTodayReport() !== null) return
  // ★現場は引き継がない（打刻が現場に紐づかなくなったため）。現場は日報側で選ぶ。
  reportLink.value = `/report?date=${date}`
}
</script>

<style scoped>
/* 完了画面の中に置く修正申請パネル。center-box は中央寄せなので幅を持たせる */
.fix-slot { width: 100%; margin-top: 18px; text-align: left; }


.checkin-page {
  /* AppNav追加(2026-07-16)に伴い、下部固定ナビの高さ分を差し引く(calendar/index.vueと同型)。
     min-heightのままだと(スペーサー分+100dvh)でsubmit-areaが画面下に押し出され隠れるため height固定にする。 */
  height: calc(100dvh - var(--app-header-h, 52px) - var(--app-bottom-nav-h, 54px) - env(safe-area-inset-bottom, 0px));
  background: #f2f2f7;
  display: flex;
  flex-direction: column;
  /* ★高さ固定なので、中身が伸びた分はここでスクロールさせる。これが無いと
     はみ出した分が下部ナビの裏に潜り込んで操作できない
     （2026-09-03 修正申請パネルを足して実機で発覚）。 */
  overflow-y: auto;
}

/* ── 打刻のステップ表示（2026-09-03）── */
.step-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #f0f0f0; flex-shrink: 0;
}
.step-dot { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; opacity: .45; }
.step-dot.done, .step-dot.current { opacity: 1; }
.step-num {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; background: #e5e7eb; color: #6b7280;
}
.step-num .material-symbols-rounded { font-size: 15px; }
.step-dot.current .step-num { background: #06C755; color: #fff; }
.step-dot.done .step-num { background: #dcfce7; color: #15803d; }
.step-name { font-size: 12px; font-weight: 600; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 済んだステップの1行サマリ。タップで開き直せる */
.step-done-row {
  width: 100%; display: flex; align-items: center; gap: 8px;
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
  padding: 10px 12px; margin-bottom: 10px; font-size: 13px; color: #15803d;
  font-weight: 600; cursor: pointer; text-align: left;
}
.step-done-row .material-symbols-rounded { font-size: 18px; }
.step-reopen { margin-left: auto; font-size: 12px; color: #15803d; text-decoration: underline; }

.step-ready { font-size: 15px; font-weight: 600; color: #374151; line-height: 1.7; padding: 8px 2px; }
.step-ready-note { display: block; margin-top: 6px; font-size: 12px; font-weight: 600; color: #b45309; }

/* 後追い入力・修正申請は畳んで置く。打刻の本筋ではないので既定では見せない */
.more-actions { margin-top: 18px; }
.more-actions > summary {
  font-size: 13px; color: #6b7280; cursor: pointer; padding: 10px 2px; list-style: revert;
}
.more-actions-body { display: flex; flex-direction: column; gap: 10px; padding-top: 6px; }

/* ── センター表示 ── */
.center-box {
  flex: 1;
  min-height: 0;          /* ★flexの子がスクロールできるように（既定のautoだと縮まない） */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 24px calc(32px + env(safe-area-inset-bottom, 0px));
  text-align: center;
  overflow-y: auto;
}
/* ★justify-content:center のままスクロールさせると、はみ出た時に上側が切れて
   戻せなくなる（flexの既知の挙動）。auto マージンで「収まる時だけ中央」にする。 */
.center-box > :first-child { margin-top: auto; }
.center-box > :last-child  { margin-bottom: auto; }

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
/* 退勤後にそのまま日報へ（完了画面で一番押してほしいので主ボタン扱い） */
.report-cta {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 20px; padding: 15px 20px; width: 100%;
  background: #06C755; color: #fff; border-radius: 10px;
  font-size: 16px; font-weight: 700; text-decoration: none;
}
.report-cta:active { background: #05a648; }

/* ── チェックリスト ── */
.checklist-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
  min-height: 0;   /* ★flex の子がスクロールできるように（既定の auto だと縮まない） */
}

.checklist-header {
  padding: 18px 20px 16px;
  color: #fff;
  flex-shrink: 0;
}
.checklist-header.checkin  { background: #06C755; }
.checklist-header.checkout { background: #f59e0b; }

.site-label    { font-size: 12px; opacity: .85; margin-bottom: 4px; }
.checkin-title { font-size: 20px; font-weight: 700; }
.punch-date {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 700; margin-bottom: 6px;
  background: rgba(255,255,255,.22); border-radius: 999px; padding: 4px 12px;
}
.punch-date .material-symbols-rounded { font-size: 16px; }

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

/* ── 出勤中(未退勤)専用画面 ── */
.focus-wrap {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px 24px; text-align: center;
}
.focus-icon {
  font-size: 48px; color: #06C755;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48;
}
.focus-site { font-size: 20px; font-weight: 700; color: #111; }
.focus-tag {
  background: #06C755; color: #fff; font-size: 12px; font-weight: 700;
  border-radius: 6px; padding: 3px 10px;
}
.focus-actions {
  width: 100%; max-width: 320px; margin-top: 24px;
  display: flex; flex-direction: column; gap: 12px;
}
.focus-checkout-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; border: none; border-radius: 12px; padding: 16px;
  font-size: 16px; font-weight: 700; cursor: pointer;
  background: #f59e0b; color: #fff;
}
.focus-overtime-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; border-radius: 12px; padding: 14px;
  font-size: 15px; font-weight: 700; text-decoration: none;
  background: #fffbeb; color: #b45309; border: 1px solid #fde68a;
}
.focus-switch-link {
  margin-top: 20px; background: none; border: none;
  color: #888; font-size: 13px; text-decoration: underline; cursor: pointer;
}

/* ── 対象作業員の選択 ── */
.select-wrap {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  max-width: 480px; width: 100%; margin: 0 auto;
}
.select-header {
  flex-shrink: 0; padding: 28px 20px 20px; background: #06C755; color: #fff;
}
.select-title { font-size: 20px; font-weight: 700; }

.site-filter { flex-shrink: 0; width: 100%; box-sizing: border-box; margin: 12px 0 0; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; background: #fff; }
.site-search { flex-shrink: 0; width: 100%; box-sizing: border-box; margin: 8px 0 0; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; }
.site-empty { padding: 24px 0; text-align: center; color: #94a3b8; font-size: 14px; }
/* 現場一覧だけを内部スクロールにし、ヘッダー/フィルタは固定表示のまま
   (2026-07-20・一覧が画面より長いとページ自体がoverflow:visibleで
   はみ出し背景が途切れて見えていた不具合の修正)。 */
.target-list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 0; }
.target-row-wrap { display: flex; align-items: stretch; border-bottom: 1px solid #f0f0f0; }
.target-row {
  display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;
  padding: 18px 20px; background: #fff; border: none;
  cursor: pointer;
  text-align: left; transition: background .12s;
  -webkit-tap-highlight-color: transparent;
}
.target-row:active { background: #e8f9ee; }
.target-row-active { background: #f0fdf4; }
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
.checkedin-tag {
  background: #06C755; color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 6px; padding: 2px 8px;
}
.overtime-link {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  flex-shrink: 0; width: 72px; background: #fffbeb; color: #b45309;
  font-size: 11px; font-weight: 700; text-decoration: none;
}
.overtime-link .material-symbols-rounded { font-size: 20px; }
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

.checklist-scroll { flex: 1; overflow-y: auto; }
.no-rules-note { margin: 16px 4px; font-size: 14px; line-height: 1.7; color: #475569; }
/* ★確認事項がここだけスクロールする。以前は全体が伸びて、狭い端末（iPhone SE 375×667）で
   位置情報・送信ボタン・後追い入力が画面下に詰まり、指を置く余白が無かった（2026-08-31 指摘）。
   ヘッダーと送信エリアを固定し、余りをこの一覧に配る。 */
.rules-list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 0; }

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

.consent-list { padding: 4px 0 8px; border-top: 1px solid #ececf0; }
.consent-head { font-size: 13px; font-weight: 700; color: #888; padding: 8px 4px 2px; }
.consent-link { display: flex; align-items: center; gap: 4px; font-size: 15px; color: #1a56c4; text-decoration: none; flex: 1; }
.consent-link.disabled { color: #aaa; }
.consent-link .doc-icon { font-size: 20px; }
.consent-hint { font-size: 12px; color: #999; padding: 4px 8px 0; }

.submit-area {
  /* ★下端は safe-area ぶん余分に取る。iPhone のホームバー領域に最後の要素が
     かかると押せない（2026-09-03） */
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: #fff; border-top: 1px solid #f0f0f0;
  display: flex; flex-direction: column; gap: 10px;
  flex-shrink: 0;   /* ★縮めない。ここが縮むと送信ボタンが画面外に出る */
}

/* ── 稼働有無ゲート（出勤打刻の前に1回だけ聞く）── */
.ws-wrap { flex: 1; overflow-y: auto; padding: 20px 16px 32px; }
.ws-head { margin-bottom: 20px; }
.ws-date {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 10px;
}
.ws-date .material-symbols-rounded { font-size: 16px; }
.ws-title { margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #1f2937; }
.ws-lead  { margin: 0; font-size: 13px; line-height: 1.6; color: #6b7280; }

.ws-options { display: flex; flex-direction: column; gap: 10px; }
.ws-option {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 16px 14px; border-radius: 12px; text-align: left; cursor: pointer;
  background: #fff; border: 1px solid #e5e7eb;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04);
}
.ws-option:disabled { opacity: .5; cursor: default; }
.ws-option:active:not(:disabled) { background: #f9fafb; }
/* 一番押してほしい「稼働あり」だけ強調する（他と同じ見た目だと毎朝迷う） */
.ws-option.working { border-color: #10b981; box-shadow: 0 1px 3px rgba(16, 185, 129, .2); }
.ws-icon { font-size: 26px; flex-shrink: 0; color: #6b7280; }
.ws-option.working .ws-icon { color: #10b981; }
.ws-option.leave   .ws-icon { color: #f59e0b; }
.ws-body  { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ws-label { font-size: 15px; font-weight: 700; color: #1f2937; }
.ws-desc  { font-size: 12px; line-height: 1.5; color: #6b7280; }
.ws-note  { margin: 16px 0 0; font-size: 12px; line-height: 1.6; color: #9ca3af; }

/* 打刻後の次アクション（ここが空だと「打刻して終わり」に見える） */
.next-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 300px; margin-top: 20px; }
.next-action {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 16px; min-height: 46px; border-radius: 10px;
  background: #06C755; color: #fff; border: none; cursor: pointer;
  font-size: 14px; font-weight: 700; text-decoration: none;
}
.next-action .material-symbols-rounded { font-size: 18px; }
.next-action.secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
.next-action:active { opacity: .85; }

.off-done-sub-link {
  margin-top: 16px; font-size: 13px; color: #6b7280;
  background: none; border: none; cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px;
}

/* 位置情報ステータス */
.location-status {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 9px 11px; border-radius: 10px; font-size: 12px; font-weight: 600;
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
/* ボタンと注意書きが本文にひっついて「押せる物」に見えなかったので、
   前置き / ボタン / 注意書き を縦に積んで、ボタンだけ独立させる（2026-08-31） */
.loc-lead { display: block; }
.loc-note { display: block; margin-top: 5px; font-size: 10.5px; line-height: 1.4; font-weight: 400; opacity: .75; }

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
  display: inline-flex; align-items: center; margin-top: 8px;
  background: #fff; border: 1px solid #fca5a5; color: #ef4444;
  border-radius: 8px; padding: 8px 14px; min-height: 36px;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.loc-get {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  margin-top: 7px;
  background: #2563eb; border: none; color: #fff;
  border-radius: 8px; padding: 8px 16px; min-height: 38px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 1px 2px rgba(37, 99, 235, .3);
}
.loc-get:active { background: #1d4ed8; }
.loc-get-icon {
  font-size: 16px;
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
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
