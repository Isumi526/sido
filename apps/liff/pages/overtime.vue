<template>
  <div class="app">
    <AppNav :subtitle="$t('overtime.subtitle')" :user-name="selfUser?.real_name" :user-role="selfUser?.worker_role" />

    <main class="main">
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <template v-else>
        <p class="ot-note">{{ $t('overtime.deadlineNote') }}</p>

        <!-- 本日の状況 -->
        <section class="ot-card">
          <div class="ot-card-title">{{ $t('overtime.statusLabel') }}（{{ $t('overtime.todayLabel') }} {{ today }}）</div>

          <div v-if="todayStatus === 'approved'" class="ot-status approved"><span class="material-symbols-rounded ot-icon">check_circle</span>{{ $t('overtime.statusApproved') }}</div>
          <div v-else-if="todayStatus === 'pending'" class="ot-status pending">
            <span class="material-symbols-rounded ot-icon">pending</span>{{ $t('overtime.statusPending') }}
            <button class="ot-cancel" :disabled="busy" @click="onCancel">{{ $t('overtime.cancel') }}</button>
          </div>
          <div v-else-if="todayStatus === 'rejected'" class="ot-status rejected"><span class="material-symbols-rounded ot-icon">block</span>{{ $t('overtime.statusRejected') }}</div>

          <!-- ★締切前なら申請済みでも内容を変更・追加できる（2026-09-13 辻さん）。
               申請は1日1件（現場は複数選べる）なので、先に1現場で出した後に2現場目の残業や
               休憩の申告が出てきた時はここから足す。上書きすると再承認になる。 -->
          <div v-if="todayStatus !== 'none' && canRequestToday && !editMode" class="ot-edit-row">
            <p class="ot-edit-hint">{{ $t('overtime.editHint') }}</p>
            <button type="button" class="ot-edit" :disabled="busy" data-testid="ot-edit" @click="startEdit">{{ $t('overtime.editStart') }}</button>
          </div>

          <!-- 申請フォーム。
               ・締切前かつ未申請 → 通常の残業申請。
               ・締切前かつ申請済み＋変更モード → 申請内容の変更・追加（上書き→再承認）。
               ・締切後（16:00以降）→ 16:00締切ルールは残したまま「実績修正の申請(late)」を出す導線。
                 実際に働いた残業実績を後から申告し、承認を得て反映する（既存申請があればEFが上書き）。 -->
          <template v-if="(todayStatus === 'none' && canRequestToday) || !canRequestToday || editMode">
            <template v-if="isLateMode">
              <div class="ot-status closed"><span class="material-symbols-rounded ot-icon">lock</span>{{ $t('overtime.deadlinePassed') }}</div>
              <p class="ot-late-note">{{ $t('overtime.lateNote') }}</p>
            </template>
            <p v-else-if="editMode" class="ot-late-note" data-testid="ot-edit-note">{{ $t('overtime.editNote') }}</p>

            <label class="ot-label">{{ $t('overtime.endTimeLabel') }}</label>
            <select v-model="endTime" class="ot-input">
              <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>
            <label class="ot-label">対象現場（複数選択可・責任者へ通知）<span v-if="selectedSites.length" class="ot-sel-count">選択 {{ selectedSites.length }}件</span></label>
            <input v-if="siteOptions.length > 6" v-model="siteQuery" type="text" class="ot-input ot-site-search" placeholder="現場名で絞り込み" />
            <div class="ot-sites">
              <label v-for="s in filteredSiteOptions" :key="s" class="ot-site"><input type="checkbox" :value="s" v-model="selectedSites" /> {{ s }}</label>
              <p v-if="!siteOptions.length" class="ot-sites-empty">現場がありません</p>
              <p v-else-if="!filteredSiteOptions.length" class="ot-sites-empty">「{{ siteQuery }}」に一致する現場がありません</p>
            </div>
            <!-- ★早朝入り・休憩の申告（2026-08-10 大塚さん）。どちらも任意。
                 承認されて初めて日報の入力制限が緩む＝申請しただけでは時間は広がらない。 -->
            <label class="ot-label">{{ $t('overtime.startTimeLabel') }}</label>
            <select v-model="startTime" class="ot-input" data-testid="ot-start-time">
              <option value="">{{ $t('overtime.startTimeNone') }}</option>
              <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>
            <label class="ot-label">{{ $t('overtime.breakLabel') }}</label>
            <select v-model="breakMinutes" class="ot-input" data-testid="ot-break">
              <option value="">{{ $t('overtime.breakNone') }}</option>
              <option value="0">{{ $t('overtime.breakZero') }}</option>
              <option v-for="m in [15, 30, 45, 60, 90]" :key="m" :value="String(m)">{{ m }}分</option>
            </select>

            <label class="ot-label">{{ isLateMode ? $t('overtime.lateReasonLabel') : $t('overtime.reasonLabel') }}</label>
            <textarea v-model="reason" class="ot-input" rows="2" :placeholder="isLateMode ? $t('overtime.lateReasonPlaceholder') : $t('overtime.reasonPlaceholder')" />
            <button v-if="isLateMode" class="ot-submit" :disabled="busy" data-testid="ot-late-submit" @click="onSubmitLate">{{ busy ? $t('overtime.submitting') : $t('overtime.lateSubmit') }}</button>
            <template v-else-if="editMode">
              <button class="ot-submit" :disabled="busy" data-testid="ot-edit-submit" @click="onSubmitUpdate">{{ busy ? $t('overtime.submitting') : $t('overtime.editSubmit') }}</button>
              <button type="button" class="ot-edit-cancel" :disabled="busy" data-testid="ot-edit-cancel" @click="editMode = false">{{ $t('overtime.editCancel') }}</button>
            </template>
            <button v-else class="ot-submit" :disabled="busy" @click="onSubmit">{{ busy ? $t('overtime.submitting') : $t('overtime.submit') }}</button>
          </template>

          <p v-if="msg" class="ot-msg" :class="{ ok: msgOk }">{{ msg }}</p>
        </section>

        <!-- ★過去の日の実績修正（2026-09-14 辻さん「前日より以前の休憩を修正したい場合は？」）。
             本日の枠は 16:00 締切／当日の実績修正だけで、前日以前の休憩・終了時刻を直す入口が無かった。
             直近7日（当日を除く）から日を選び、実績修正(late)として申請する。承認すると EF がその日の
             日報の作業員行へ休憩・時刻を書き込んで工数を計算し直す（日報を開き直さなくても反映される）。 -->
        <section class="ot-card" data-testid="ot-past">
          <button type="button" class="ot-past-toggle" data-testid="ot-past-toggle" @click="showPast = !showPast">
            <span class="material-symbols-rounded ot-icon">{{ showPast ? 'expand_less' : 'expand_more' }}</span>
            {{ $t('overtime.pastTitle') }}
          </button>
          <template v-if="showPast">
            <p class="ot-late-note" data-testid="ot-past-note">{{ $t('overtime.pastNote') }}</p>

            <label class="ot-label">{{ $t('overtime.pastDateLabel') }}</label>
            <select v-model="pastDate" class="ot-input" data-testid="ot-past-date">
              <option v-for="d in pastDateOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>

            <label class="ot-label">{{ $t('overtime.pastEndTimeLabel') }}</label>
            <select v-model="pastEndTime" class="ot-input" data-testid="ot-past-end">
              <option value="">{{ $t('overtime.pastEndTimeNone') }}</option>
              <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>

            <label class="ot-label">対象現場（複数選択可・責任者へ通知）<span v-if="pastSites.length" class="ot-sel-count">選択 {{ pastSites.length }}件</span></label>
            <input v-if="siteOptions.length > 6" v-model="pastSiteQuery" type="text" class="ot-input ot-site-search" placeholder="現場名で絞り込み" data-testid="ot-past-site-search" />
            <div class="ot-sites">
              <label v-for="s in filteredPastSiteOptions" :key="s" class="ot-site"><input type="checkbox" :value="s" v-model="pastSites" /> {{ s }}</label>
              <p v-if="!siteOptions.length" class="ot-sites-empty">現場がありません</p>
              <p v-else-if="!filteredPastSiteOptions.length" class="ot-sites-empty">「{{ pastSiteQuery }}」に一致する現場がありません</p>
            </div>

            <label class="ot-label">{{ $t('overtime.startTimeLabel') }}</label>
            <select v-model="pastStartTime" class="ot-input" data-testid="ot-past-start">
              <option value="">{{ $t('overtime.startTimeNone') }}</option>
              <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>
            <label class="ot-label">{{ $t('overtime.breakLabel') }}</label>
            <select v-model="pastBreakMinutes" class="ot-input" data-testid="ot-past-break">
              <option value="">{{ $t('overtime.breakNone') }}</option>
              <option value="0">{{ $t('overtime.breakZero') }}</option>
              <option v-for="m in [15, 30, 45, 60, 90]" :key="m" :value="String(m)">{{ m }}分</option>
            </select>

            <label class="ot-label">{{ $t('overtime.lateReasonLabel') }}</label>
            <textarea v-model="pastReason" class="ot-input" rows="2" :placeholder="$t('overtime.pastReasonPlaceholder')" data-testid="ot-past-reason" />
            <button class="ot-submit" :disabled="busy" data-testid="ot-past-submit" @click="onSubmitPast">{{ busy ? $t('overtime.submitting') : $t('overtime.lateSubmit') }}</button>
            <p v-if="pastMsg" class="ot-msg" :class="{ ok: pastMsgOk }" data-testid="ot-past-msg">{{ pastMsg }}</p>
          </template>
        </section>

        <!-- 最近の申請 -->
        <section class="ot-card">
          <div class="ot-card-title">{{ $t('overtime.recentTitle') }}</div>
          <div v-if="!recent.length" class="ot-empty">{{ $t('overtime.empty') }}</div>
          <ul v-else class="ot-list">
            <li v-for="r in recent" :key="r.id" class="ot-item">
              <span class="ot-date">{{ r.date }}</span>
              <span v-if="r.requested_start_time" class="ot-end" data-testid="ot-recent-start">{{ (r.requested_start_time || '').slice(0,5) }}〜</span>
              <span v-if="r.requested_end_time" class="ot-end">〜{{ (r.requested_end_time || '').slice(0,5) }}</span>
              <span v-if="r.requested_break_minutes !== null && r.requested_break_minutes !== undefined" class="ot-end" data-testid="ot-recent-break">
                {{ r.requested_break_minutes === 0 ? $t('overtime.breakZero') : `休憩${r.requested_break_minutes}分` }}
              </span>
              <span class="ot-badge" :class="r.status">{{ statusLabel(r.status) }}</span>
              <span v-if="r.is_late" class="ot-badge late" data-testid="ot-recent-late">{{ $t('overtime.lateBadge') }}</span>
              <span v-if="r.reason" class="ot-reason">{{ r.reason }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '~/composables/schedule-core.gen'
import type { User } from '~/types'
import { useI18n } from 'vue-i18n'
import { TIME_OPTIONS } from '~/utils/workerHours'

const { t } = useI18n()
const liff = useLiff()
const overtime = useOvertimeRequest()
const route = useRoute()

const loading  = ref(true)
const busy     = ref(false)
const selfUser = ref<User | null>(null)
const workerId = computed(() => selfUser.value?.worker_id ?? null)

const today = todayStr()
const todayStatus = ref<'none' | 'pending' | 'approved' | 'rejected'>('none')
const canRequestToday = ref(false)
// 締切後（16:00以降・当日）は「実績修正の申請(late)」モードに切り替える。締切ルール自体は残す。
const isLateMode = computed(() => !canRequestToday.value)
const recent = ref<any[]>([])

const endTime = ref('18:00')
const startTime    = ref('')   // 早朝入り（空=申請しない）
const breakMinutes = ref('')   // 実際に取った休憩（空=申請しない / '0'=休憩なし）
const reason  = ref('')
const msg     = ref('')
const msgOk   = ref(false)
const siteOptions   = ref<string[]>([])   // 対象現場の候補（有効現場）
const selectedSites = ref<string[]>([])   // 選択された対象現場（責任者へ通知 #5）
const siteQuery     = ref('')             // 対象現場の絞り込み
const editMode      = ref(false)          // 締切前の申請内容の変更・追加モード（2026-09-13 辻さん）
// 絞り込み結果（選択済みは常に表示＝チェックが検索で消えないように）
const filteredSiteOptions = computed(() => {
  const q = siteQuery.value.trim().toLowerCase()
  if (!q) return siteOptions.value
  return siteOptions.value.filter(s => selectedSites.value.includes(s) || s.toLowerCase().includes(q))
})
// ── 過去の日の実績修正（直近7日・当日を除く）──
const showPast         = ref(false)
const pastDate         = ref('')
const pastEndTime      = ref('')   // 空=終了時刻は変えない（休憩だけ直す時）
const pastStartTime    = ref('')
const pastBreakMinutes = ref('')
const pastReason       = ref('')
const pastSites        = ref<string[]>([])
const pastSiteQuery    = ref('')
const pastMsg          = ref('')
const pastMsgOk        = ref(false)
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
// 昨日から7日ぶん。打刻修正申請（checkin の fixNote「直近7日」）と同じ範囲にそろえる
const pastDateOptions = computed(() => {
  const out: { value: string; label: string }[] = []
  const base = new Date(`${today}T00:00:00+09:00`)
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base.getTime() - i * 86400000)
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
    out.push({ value: `${y}-${m}-${dd}`, label: `${y}-${m}-${dd}（${WEEKDAYS_JA[d.getDay()]}）` })
  }
  return out
})
const filteredPastSiteOptions = computed(() => {
  const q = pastSiteQuery.value.trim().toLowerCase()
  if (!q) return siteOptions.value
  return siteOptions.value.filter(s => pastSites.value.includes(s) || s.toLowerCase().includes(q))
})
const supabase = useSupabase()
const { getAccountId, effectiveSlug } = useAccount()
const config = useRuntimeConfig()

function statusLabel(s: string) {
  return s === 'approved' ? t('overtime.statusApproved')
    : s === 'pending' ? t('overtime.statusPending')
    : s === 'rejected' ? t('overtime.statusRejected') : s
}

async function refresh() {
  const wid = workerId.value
  todayStatus.value   = wid ? await overtime.status(wid, today) : 'none'
  canRequestToday.value = overtime.canRequest(today)
  recent.value        = wid ? await overtime.myRecent(wid) : []
  const accountId = await getAccountId()
  if (accountId && !siteOptions.value.length) {
    // ★EF経由（sites は公開キーから読めないようにしたため）。並びはEF側でname_kana順。
    siteOptions.value = (await useSitesApi().listSafe()).map(s => s.name)
  }
}

async function onSubmit() {
  if (!workerId.value) { msg.value = t('overtime.errorNoLogin'); msgOk.value = false; return }
  busy.value = true; msg.value = ''
  const sites = [...selectedSites.value]
  const res = await overtime.requestOvertime(
    workerId.value, today, endTime.value, reason.value, sites,
    startTime.value || null,
    // ★空文字は「申請なし」、'0' は「休憩なしで通した」。潰さないこと
    breakMinutes.value === '' ? null : Number(breakMinutes.value),
  )
  busy.value = false
  if (!res.ok) {
    msg.value = res.error === 'deadline-passed' ? t('overtime.errorDeadline') : t('overtime.errorGeneric')
    msgOk.value = false
    await refresh()
    return
  }
  msg.value = t('overtime.submitted'); msgOk.value = true
  // 選択現場の責任者へメール通知（best-effort・失敗しても申請自体は成立）#5
  const efUrl = (config.public as any).edgeFunctionUrl
  // ★2026-08-30: 現場が選べていなくても通知する。職人は現場を新規作成できないので
  //  台帳に無い現場では sites が空になり、以前はここで通知自体を送っていなかった＝
  //  申請は成立しているのに誰にも気づかれないまま放置されていた。
  //  現場が無い時はEF側が会社の管理者へ回す。
  if (efUrl) {
    const slug = await effectiveSlug()
    // ハードニング後: body は照合キーのみ。通知内容はEFが overtime_requests(実在行)から導出する。
    fetch(`${efUrl}/notify-overtime`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(config.public as any).supabaseAnonKey}` },
      body: JSON.stringify({ accountSlug: slug, worker_id: workerId.value, date: today }),
    }).catch(() => {})
  }
  await refresh()
}

// 締切後の実績修正の申請。理由は必須。既存申請があればEFが上書き（再承認のためpendingに戻る）。
async function onSubmitLate() {
  if (!workerId.value) { msg.value = t('overtime.errorNoLogin'); msgOk.value = false; return }
  if (!reason.value.trim()) { msg.value = t('overtime.lateReasonRequired'); msgOk.value = false; return }
  busy.value = true; msg.value = ''
  const sites = [...selectedSites.value]
  const res = await overtime.requestLateCorrection(
    workerId.value, today, endTime.value, reason.value, sites,
    startTime.value || null,
    // ★空文字は「申請なし」、'0' は「休憩なしで通した」。潰さないこと
    breakMinutes.value === '' ? null : Number(breakMinutes.value),
  )
  busy.value = false
  if (!res.ok) {
    msg.value = res.error === 'reason-required' ? t('overtime.lateReasonRequired') : t('overtime.errorGeneric')
    msgOk.value = false
    await refresh()
    return
  }
  msg.value = t('overtime.lateSubmitted'); msgOk.value = true
  // 選択現場の責任者へメール通知（best-effort・通常申請と同じ経路）
  const efUrl = (config.public as any).edgeFunctionUrl
  // ★2026-08-30: 現場が選べていなくても通知する。職人は現場を新規作成できないので
  //  台帳に無い現場では sites が空になり、以前はここで通知自体を送っていなかった＝
  //  申請は成立しているのに誰にも気づかれないまま放置されていた。
  //  現場が無い時はEF側が会社の管理者へ回す。
  if (efUrl) {
    const slug = await effectiveSlug()
    fetch(`${efUrl}/notify-overtime`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(config.public as any).supabaseAnonKey}` },
      body: JSON.stringify({ accountSlug: slug, worker_id: workerId.value, date: today }),
    }).catch(() => {})
  }
  await refresh()
}

// 申請済みの中身をフォームに入れ直して変更モードに入る（現場の追加・終了時刻の変更・休憩の追加申告）
async function startEdit() {
  if (!workerId.value) return
  busy.value = true; msg.value = ''
  const cur = await overtime.activeRequest(workerId.value, today)
  busy.value = false
  if (cur) {
    if (cur.endTime) endTime.value = cur.endTime
    startTime.value = cur.startTime ?? ''
    breakMinutes.value = (cur.breakMinutes === null || cur.breakMinutes === undefined) ? '' : String(cur.breakMinutes)
    reason.value = cur.reason ?? ''
    // 台帳に無い現場名は候補に出ないので、候補にあるものだけ復元（消えた現場は選び直し）
    selectedSites.value = (cur.siteNames ?? []).filter(n => siteOptions.value.includes(n))
  }
  editMode.value = true
}

// 締切前の変更・追加。EFが有効申請を上書きして pending に戻す（再承認）。
async function onSubmitUpdate() {
  if (!workerId.value) { msg.value = t('overtime.errorNoLogin'); msgOk.value = false; return }
  busy.value = true; msg.value = ''
  const sites = [...selectedSites.value]
  const res = await overtime.updateRequest(
    workerId.value, today, endTime.value, reason.value, sites,
    startTime.value || null,
    // ★空文字は「申請なし」、'0' は「休憩なしで通した」。潰さないこと
    breakMinutes.value === '' ? null : Number(breakMinutes.value),
  )
  busy.value = false
  if (!res.ok) {
    msg.value = res.error === 'deadline-passed' ? t('overtime.errorDeadline') : t('overtime.errorGeneric')
    msgOk.value = false
    await refresh()
    return
  }
  editMode.value = false
  msg.value = t('overtime.editSubmitted'); msgOk.value = true
  // 責任者/管理者へ再通知（best-effort・通常申請と同じ経路。内容はEFが実在行から導出）
  const efUrl = (config.public as any).edgeFunctionUrl
  if (efUrl) {
    const slug = await effectiveSlug()
    fetch(`${efUrl}/notify-overtime`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(config.public as any).supabaseAnonKey}` },
      body: JSON.stringify({ accountSlug: slug, worker_id: workerId.value, date: today }),
    }).catch(() => {})
  }
  await refresh()
}

// 過去の日の実績修正。EF の overtime-late-request は未来日以外を受けるので、日付を差し替えるだけで
// 当日の late 申請と同じ経路に乗る（既存の有効申請があれば上書き→再承認）。
async function onSubmitPast() {
  if (!workerId.value) { pastMsg.value = t('overtime.errorNoLogin'); pastMsgOk.value = false; return }
  if (!pastDate.value) { pastMsg.value = t('overtime.pastDateRequired'); pastMsgOk.value = false; return }
  if (!pastReason.value.trim()) { pastMsg.value = t('overtime.lateReasonRequired'); pastMsgOk.value = false; return }
  // 何も直す内容が無い申請は弾く（承認者が困る）
  if (!pastEndTime.value && !pastStartTime.value && pastBreakMinutes.value === '') {
    pastMsg.value = t('overtime.pastNothingToFix'); pastMsgOk.value = false; return
  }
  busy.value = true; pastMsg.value = ''
  const date = pastDate.value
  const res = await overtime.requestLateCorrection(
    workerId.value, date, pastEndTime.value || null, pastReason.value, [...pastSites.value],
    pastStartTime.value || null,
    // ★空文字は「申請なし」、'0' は「休憩なしで通した」。潰さないこと
    pastBreakMinutes.value === '' ? null : Number(pastBreakMinutes.value),
  )
  busy.value = false
  if (!res.ok) {
    pastMsg.value = res.error === 'reason-required' ? t('overtime.lateReasonRequired') : t('overtime.errorGeneric')
    pastMsgOk.value = false
    return
  }
  pastMsg.value = t('overtime.lateSubmitted'); pastMsgOk.value = true
  pastReason.value = ''; pastEndTime.value = ''; pastStartTime.value = ''; pastBreakMinutes.value = ''; pastSites.value = []
  // 責任者/管理者へ通知（best-effort・当日の申請と同じ経路。内容はEFが実在行から導出）
  const efUrl = (config.public as any).edgeFunctionUrl
  if (efUrl) {
    const slug = await effectiveSlug()
    fetch(`${efUrl}/notify-overtime`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(config.public as any).supabaseAnonKey}` },
      body: JSON.stringify({ accountSlug: slug, worker_id: workerId.value, date }),
    }).catch(() => {})
  }
  await refresh()
}

async function onCancel() {
  if (!workerId.value) return
  busy.value = true; msg.value = ''
  const res = await overtime.cancelRequest(workerId.value, today)
  busy.value = false
  if (res.ok) { msg.value = t('overtime.canceled'); msgOk.value = true }
  await refresh()
}

onMounted(async () => {
  await liff.init()
  selfUser.value = await useCurrentUser().resolve()
  if (!selfUser.value) { await navigateTo('/no-account'); return }
  await refresh()
  pastDate.value = pastDateOptions.value[0]?.value ?? ''
  // 出退勤画面(出勤中の現場行)からの導線で ?site=<現場名> が付いていれば自動選択する
  // (ユーザーが現場を選び直す手間をなくす・2026-07-20)。
  const presetSite = route.query.site
  const presetName = typeof presetSite === 'string' ? presetSite : undefined
  if (presetName && siteOptions.value.includes(presetName) && !selectedSites.value.includes(presetName)) {
    selectedSites.value.push(presetName)
  }
  loading.value = false
})
</script>

<style scoped>
.app { min-height: 100dvh; background: #f2f2f7; }
.main { max-width: 480px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.state-screen { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px 0; }
.spinner { width: 32px; height: 32px; border: 3px solid #e0e0e0; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { color: #888; }
.ot-note { font-size: 13px; line-height: 1.7; color: #475569; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 14px; }
.ot-edit-row { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 4px; }
.ot-edit-hint { font-size: 12px; color: #64748b; margin: 0; line-height: 1.6; }
.ot-edit { align-self: flex-start; background: #fff; color: #0f766e; border: 1px solid #99f6e4; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 700; }
.ot-edit-cancel { width: 100%; margin-top: 8px; background: #fff; color: #64748b; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; font-size: 13px; }
.ot-past-toggle { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; padding: 0; font-size: 14px; font-weight: 700; color: #1e293b; text-align: left; }
.ot-late-note { font-size: 13px; line-height: 1.7; color: #9a3412; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; margin: 10px 0 0; }
.ot-card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.ot-card-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 12px; }
.ot-status { font-size: 14px; font-weight: 700; padding: 10px 12px; border-radius: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ot-status.approved { background: #ecfdf5; color: #047857; }
.ot-status.pending  { background: #fffbeb; color: #b45309; }
.ot-status.rejected { background: #fef2f2; color: #b91c1c; }
.ot-status.closed   { background: #f1f5f9; color: #64748b; }
.ot-icon { font-size: 16px; }
.ot-label { display: block; font-size: 12px; color: #64748b; margin: 12px 0 4px; font-weight: 700; }
.ot-sel-count { color: #06C755; margin-left: 6px; }
.ot-site-search { margin-bottom: 6px; }
.ot-sites { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; background: #fafafa; }
.ot-site { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.ot-sites-empty { color: #94a3b8; font-size: 13px; margin: 0; }
.ot-input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 15px; }
.ot-submit { width: 100%; margin-top: 14px; background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 700; }
.ot-submit:disabled { background: #94d8ad; }
.ot-cancel { background: #fff; border: 1px solid #fca5a5; color: #b91c1c; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 700; }
.ot-msg { margin-top: 10px; font-size: 13px; color: #b91c1c; }
.ot-msg.ok { color: #047857; }
.ot-empty { color: #94a3b8; font-size: 13px; }
.ot-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ot-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
.ot-date { font-weight: 700; color: #1e293b; }
.ot-end { color: #64748b; }
.ot-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
.ot-badge.approved { background: #ecfdf5; color: #047857; }
.ot-badge.pending  { background: #fffbeb; color: #b45309; }
.ot-badge.rejected { background: #fef2f2; color: #b91c1c; }
.ot-badge.late     { background: #ffedd5; color: #9a3412; }
.ot-reason { color: #94a3b8; font-size: 12px; flex-basis: 100%; }
</style>
