<template>
  <div class="app">
    <AppNav :subtitle="$t('history.subtitle')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="main">
      <!-- ★差し戻し。日報一覧より前・空状態でも出す。
           これが無かった頃は差し戻しても作業員側は「承認待ちバッジが黙って消える」だけで、
           承認との区別すらつかなかった（＝差し戻し運用が成立していなかった）。 -->
      <div v-for="r in rejected" :key="r.id" class="rejected-card" data-testid="history-rejected">
        <div class="rejected-head">
          <span class="material-symbols-rounded rejected-icon">undo</span>
          <span class="rejected-title">{{ $t('history.rejectedTitle') }}</span>
          <span class="rejected-date">{{ formatDate(r.date) }}</span>
        </div>
        <p v-if="r.reason" class="rejected-reason" data-testid="history-rejected-reason">
          <span class="rejected-reason-label">{{ $t('history.rejectedReasonLabel') }}</span>{{ r.reason }}
        </p>
        <p class="rejected-lead">{{ $t('history.rejectedLead') }}</p>
        <p v-if="r.reviewedBy" class="rejected-by">{{ $t('history.rejectedReviewedBy', { name: r.reviewedBy }) }}</p>
        <div class="rejected-actions">
          <NuxtLink :to="`/report?edit=${r.date}`" class="btn-rejected-fix" data-testid="history-rejected-fix">
            {{ $t('history.rejectedFix') }}
          </NuxtLink>
          <button class="btn-rejected-ack" data-testid="history-rejected-ack" @click="ackRejected(r.id)">
            {{ $t('history.rejectedAck') }}
          </button>
        </div>
      </div>

      <!-- ローディング -->
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <!-- 空 -->
      <div v-else-if="reports.length === 0" class="empty-state">
        <div class="material-symbols-rounded empty-icon">list_alt</div>
        <p class="empty-text">{{ $t('history.emptyText') }}</p>
        <NuxtLink to="/report" class="btn-primary">{{ $t('history.enterReport') }}</NuxtLink>
      </div>

      <!-- 一覧 -->
      <div v-else class="report-list">

        <template v-for="(group, ym) in grouped" :key="ym">
          <div class="month-label">{{ ym }}</div>
          <template v-for="rep in group" :key="rep.date">
          <!-- ★まだ日報が無い（期限切れで提出し承認待ちの）日。日付順の位置に出す。
               Vue3 は同一要素だと v-if が v-for より先に評価されるので template で包む。
               ★カードの中身は普通の日報と同じ描画を流用する（日付と一文だけでは
               「何を送ったのか」が分からなかった）。承認待ちであることは枠と注記で示す。 -->
          <div
            class="report-card"
            :class="{ 'pending-only': rep._pendingOnly }"
            :data-testid="rep._pendingOnly ? 'history-pending-only' : undefined"
          >
            <div class="report-card-top">
              <div class="report-date">{{ formatDate(rep.date) }}</div>
              <span :class="['status-badge', rep.leave_type === 'paid_leave' ? 'badge-paid-leave' : rep.is_working ? 'badge-working' : 'badge-off']">
                {{ rep.leave_type === 'paid_leave' ? $t('history.badgePaidLeave') : rep.is_working ? $t('history.badgeWorking') : $t('history.badgeOff') }}
              </span>
              <!-- ★編集を申請済み。表示中の内容は承認前（＝今有効な値）であることを示す -->
              <span v-if="rep._pendingOnly || pendingDates.has(rep.date)" class="status-badge badge-pending" data-testid="history-pending">
                {{ $t('history.pendingApproval') }}
              </span>
            </div>

            <!-- 承認待ちの説明。編集の承認待ち（日報が既にある）と、まだ日報が無い新規提出とで
                 「今出ている内容が何なのか」が違うので、文言を分ける（取り違え防止）。 -->
            <p v-if="rep._pendingOnly" class="pending-note" data-testid="history-pending-note-new">
              {{ $t('history.pendingOnlyNote') }}
            </p>
            <p v-else-if="pendingDates.has(rep.date)" class="pending-note" data-testid="history-pending-note-edit">
              {{ $t('history.pendingEditNote') }}
            </p>

            <p v-if="rep.note" class="report-note full">{{ rep.note }}</p>

            <!-- 詳細（常時表示・LINE通知と同粒度）-->
            <div class="detail">
              <div v-if="rep.leave_type === 'paid_leave'" class="detail-leave">{{ $t('history.detailPaidLeave') }}</div>
              <div v-else-if="!rep.is_working" class="detail-leave">{{ $t('history.detailNoWork') }}</div>
              <template v-else>
                <div v-for="(s, i) in detailMap[rep.date]" :key="i" class="detail-site">
                  <div class="detail-site-name"><span class="material-symbols-rounded detail-icon">location_on</span>{{ s.name }}</div>
                  <div v-if="s.contractor" class="detail-contractor"><span class="material-symbols-rounded detail-icon">apartment</span>{{ s.contractor }}</div>
                  <!-- ★その日その現場の実打刻。表示専用（人件費は日報の作業時刻がマスタ）。
                       打刻が無ければ行ごと出さない＝0:00 のように見せない。 -->
                  <div v-if="punchOf(rep.date)" class="detail-punch" data-testid="history-punch">
                    <span class="material-symbols-rounded detail-icon">how_to_reg</span>
                    {{ $t('history.punchLabel') }}
                    {{ punchOf(rep.date)?.checkin ?? '—' }} 〜 {{ punchOf(rep.date)?.checkout ?? '—' }}
                  </div>

                  <ul v-if="s.workers.length" class="detail-list">
                    <li v-for="(w, wi) in s.workers" :key="wi">
                      <span class="dl-main">{{ w.name }}</span>
                      <span class="dl-sub">
                        <template v-if="w.hours">{{ w.hours }}</template>
                        <template v-if="w.hours && w.time"> ・ </template>
                        <template v-if="w.time">{{ w.time }}</template>
                        <template v-if="!w.hours && !w.time">—</template>
                      </span>
                    </li>
                  </ul>

                  <ul v-if="s.expenses.length" class="detail-list expense">
                    <li v-for="(e, ei) in s.expenses" :key="ei"><span class="material-symbols-rounded detail-icon">payments</span>{{ e }}</li>
                  </ul>

                  <ul v-if="s.subs.length" class="detail-list sub">
                    <li v-for="(sub, sbi) in s.subs" :key="sbi"><span class="material-symbols-rounded detail-icon">handshake</span>{{ sub }}</li>
                  </ul>

                  <p v-if="s.note" class="detail-note"><span class="material-symbols-rounded detail-icon">edit_note</span>{{ s.note }}</p>
                </div>
                <div v-if="!detailMap[rep.date] || !detailMap[rep.date].length" class="detail-empty">{{ $t('history.detailNoSites') }}</div>
              </template>
            </div>

            <div class="report-card-footer">
              <!-- 承認待ちの新規提出はまだ日報が無く updated_at を持たないので出さない -->
              <span v-if="!rep._pendingOnly" class="updated-at">{{ $t('history.updatedAt', { time: formatUpdatedAt(rep.updated_at) }) }}</span>
              <span v-else class="updated-at"></span>
              <!-- ★解錠の許可申請は廃止（2026-08-03）。過去日もそのまま編集でき、
                   理由必須＋内容の承認待ちになる。二段承認をやめたため常に編集導線を出す。 -->
              <NuxtLink :to="`/report?edit=${rep.date}`" class="btn-edit">{{ $t('history.editReport') }}</NuxtLink>
            </div>
          </div>
          </template>
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'
import { computeWorkerHours, calcBreakMinutes, effectiveBreakMinutes, effectiveBreakWindows, parseMin } from '~/utils/workerHours'

const { t } = useI18n()

const liff    = useLiff()
const expense = useExpense()
const proxy   = useProxyMode()

const loading     = ref(true)
const reports     = ref<any[]>([])
// ★承認待ちの日。保留テーブルは anon から読めないので EF から日付だけ受け取る。
//   出さないと「申請したのに履歴に無く、何日を出したのか分からない」状態になる。
const pendingDates = ref<Set<string>>(new Set())
// まだ日報が無い＝期限切れの新規提出。★payload（送信内容）も持つ。
// 日付と一文だけだと「何を送ったのか」が分からず、普通の日報カードと情報量が違いすぎた。
const pendingOnly = ref<{ date: string; payload: any }[]>([])
// ★未確認の差し戻し。保留テーブルは anon から読めないので EF 経由で本人の分だけ受け取る。
type RejectedNotice = { id: string; date: string; reason: string | null; reviewedBy: string | null }
const rejected = ref<RejectedNotice[]>([])

/** report-edit-log を呼ぶ（身元は EF 側で検証される。ここでは名乗らない） */
async function callEditLog(payload: Record<string, unknown>): Promise<any | null> {
  const cfg = useRuntimeConfig()
  const efUrl = cfg.public.edgeFunctionUrl
  if (!efUrl) return null
  const anonKey = cfg.public.supabaseAnonKey as string
  const { data: { session } } = await useSupabase().auth.getSession()
  const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
  const devLineUserId = cfg.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
  const res = await fetch(`${efUrl}/report-edit-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey,
               Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
    body: JSON.stringify({ ...payload, line_id_token: lineIdToken, dev_line_user_id: devLineUserId }),
  })
  return await res.json().catch(() => null)
}

async function loadPendingDates() {
  try {
    const j = await callEditLog({ action: 'pending-dates' })
    if (!j?.ok) return
    pendingDates.value = new Set((j.dates ?? []).map((d: any) => d.date))
    pendingOnly.value = (j.dates ?? [])
      .filter((d: any) => d.kind === 'late_new')
      .map((d: any) => ({ date: d.date, payload: d.payload ?? null }))
    rejected.value = (j.rejected ?? []).map((r: any) => ({
      id: r.id, date: r.date, reason: r.reason ?? null, reviewedBy: r.reviewedBy ?? null,
    }))
    // 承認待ちの分も明細を組み立て直す（取得が日報本体より後に返ることがあるため）
    rebuildDetails()
  } catch (e) { console.error('[history] 承認待ちの取得に失敗:', e) }
}

/** 差し戻しを既読にする。★先に画面から消してから送る（押した手応えを待たせない）。
 *  失敗したら戻す＝「消えたのにまた出る」より「消えない」方が実害が小さい。 */
async function ackRejected(id: string) {
  const before = rejected.value
  rejected.value = before.filter((r) => r.id !== id)
  const j = await callEditLog({ action: 'ack-rejected', pendingId: id }).catch(() => null)
  if (!j?.ok) rejected.value = before
}
const selfUser    = ref<User | null>(null)

// 各日報の明細（常時表示用・読み込み時に一括で組み立て）
const detailMap = ref<Record<string, SiteDetail[]>>({})

function rebuildDetails() {
  const map: Record<string, SiteDetail[]> = {}
  for (const rep of reports.value) map[rep.date] = buildDetail(rep)
  // ★承認待ち（まだ日報が無い）分も同じ組み立てを通す。payload は daily_reports と
  //   同じ構造（承認時にそのまま入る）なので、日報カードの描画をそのまま流用できる。
  for (const p of pendingOnly.value) if (p.payload) map[p.date] = buildDetail(p.payload)
  detailMap.value = map
}

// 代理中は代理先の情報を表示
const currentUser = computed(() => {
  const t = proxy.proxyTarget.value
  if (t) {
    return {
      ...selfUser.value,
      real_name:   t.name,
      worker_role: t.worker_role,
    } as User
  }
  return selfUser.value
})

// ── 過去3日編集ロック ──
//  ★「解錠の許可申請」は廃止済み（2026-08-03）。過去日もそのまま編集でき、
//   理由必須＋内容の承認待ちになる二段構えに置き換わった。
//   申請まわりの状態・関数はテンプレートから一度も参照されない死にコードになっていたため
//   2026-08-15 に削除（report_edit_grants を公開キーから締め出すのに合わせて）。
// ロック判定に使う作業員: 代理中は代理先、通常は自分（worker_id基準）
const effectiveWorkerId = computed<string | null>(() => {
  const t = proxy.proxyTarget.value
  if (t) return (t as any).id ?? null
  return (selfUser.value as any)?.worker_id ?? null
})

async function loadReports() {
  const uid = liff.profile.value?.userId
  if (!uid) return

  const proxyT = proxy.proxyTarget.value
  if (proxyT) {
    const { data: proxyUserData } = await useSupabase()
      .from('users').select('id').eq('worker_id', proxyT.id).maybeSingle()
    if (proxyUserData) {
      reports.value = await expense.getReportsById(proxyUserData.id)
    } else {
      reports.value = []
    }
  } else {
    reports.value = await expense.getReports(uid)
  }
  rebuildDetails()
}

onMounted(async () => {
  await liff.init()
  const uid = liff.profile.value?.userId
  if (uid) {
    selfUser.value = await expense.getUser(uid)
    if (!selfUser.value) { await navigateTo('/register'); return }
    await loadReports()
    void loadPendingDates()   // 描画は待たせない
    void loadPunches()        // 実打刻も後追い（取れなくても履歴は読める）
  }
  loading.value = false
})

watch(() => proxy.proxyTarget.value, async () => {
  if (!selfUser.value) return
  loading.value = true
  await loadReports()
  loading.value = false
  void loadPunches()
})

// ── 実打刻（2026-08-10 大塚さん「日報の中に実際打った打刻時間も出てくればいい」）──
//  ★表示専用。人件費は日報の作業時刻がマスタのまま。
const punches = usePunches()
async function loadPunches() {
  const list = reports.value
  if (!list.length) return
  // 代理中は代理先の打刻を見る（その人の日報を見ているため）
  const workerId = proxy.proxyTarget.value?.id ?? selfUser.value?.worker_id ?? null
  const dates = list.map((r: any) => r.date).sort()
  await punches.loadRange(workerId, dates[0], dates[dates.length - 1])
  punchWorkerId.value = workerId
}
const punchWorkerId = ref<string | null>(null)
// ★現場は取らない（2026-08-27 出退勤モデル変更で打刻が現場に紐づかなくなった）
function punchOf(date: string) {
  return punches.punchFor(punchWorkerId.value, date)
}

// 月ごとにグループ化
const grouped = computed(() => {
  const map: Record<string, any[]> = {}
  // ★まだ日報になっていない（期限切れで提出し承認待ちの）日も、日付順の位置に混ぜる。
  //   先頭固定にすると件数が増えた時に「いつの分か」を探しづらく、
  //   日付順に並んでいること自体が「何日を申請したか分かる」という目的そのもの。
  const merged = [
    ...reports.value,
    // payload を展開して日報と同じ形にする＝カードの描画をそのまま流用できる
    ...pendingOnly.value.map((p) => ({ ...(p.payload ?? {}), date: p.date, _pendingOnly: true })),
  ].sort((a: any, b: any) => b.date.localeCompare(a.date))
  for (const rep of merged) {
    const [year, month] = rep.date.split('-')
    const key = t('history.monthLabel', { year, month: parseInt(month, 10) })
    if (!map[key]) map[key] = []
    map[key].push(rep)
  }
  return map
})

const WEEKDAY_KEYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat']

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return t('history.dateLabel', {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: t(`history.${WEEKDAY_KEYS[d.getDay()]}`),
  })
}

function formatUpdatedAt(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}


// ── 詳細表示（LINE通知と同粒度）────────────────────────────
interface WorkerLine { name: string; time: string; hours: string }
interface SiteDetail { name: string; contractor: string; workers: WorkerLine[]; expenses: string[]; subs: string[]; note: string }

function yen(n: number): string { return Number(n).toLocaleString() }

function siteDisplayName(site: any): string {
  // ★'__unset__'（現場未設定）は内部値。そのまま出すと履歴に「__unset__」と並ぶ（2026-08-27 発覚）
  if (site.siteName === '__unset__') return t('report.siteUnset')
  return site.siteName === '__other__' ? (site.customSiteName || t('history.newSite')) : (site.siteName || '')
}

/** startTime/endTime から料率別工数を再計算（送信時と同じロジック・現場跨ぎ累積対応）*/
function computeHoursForReport(rep: any): Record<string, any> {
  const isSunday = new Date(rep.date + 'T00:00:00').getDay() === 0
  const list: { si: number; wi: number; w: any }[] = []
  ;(rep.sites || []).forEach((site: any, si: number) =>
    (site.workers || []).forEach((w: any, wi: number) => { if (w.workerName) list.push({ si, wi, w }) }))
  list.sort((a, b) => parseMin(a.w.startTime || '08:00') - parseMin(b.w.startTime || '08:00'))

  const accum: Record<string, number> = {}
  const map: Record<string, any> = {}
  for (const { si, wi, w } of list) {
    const key = w.workerId || w.workerName
    const wins = effectiveBreakWindows(w)
    const { workedMin, ...bd } = computeWorkerHours(
      w.startTime, w.endTime, wins ? 0 : effectiveBreakMinutes(w), isSunday, accum[key] ?? 0, wins)
    accum[key] = workedMin
    map[`${si}-${wi}`] = bd
  }
  return map
}

/** 工数オブジェクト → 「8h + 残業2h」形式（buildReportMessage と同じ表記）*/
function hoursParts(h: any): string {
  if (!h) return ''
  const p: string[] = []
  if (h.hoursNormal)        p.push(t('history.hoursNormal', { h: h.hoursNormal }))
  if (h.hoursSunday)        p.push(t('history.hoursSunday', { h: h.hoursSunday }))
  if (h.hoursOT)            p.push(t('history.hoursOT', { h: h.hoursOT }))
  if (h.hoursNight)         p.push(t('history.hoursNight', { h: h.hoursNight }))
  if (h.hoursOTNight)       p.push(t('history.hoursOTNight', { h: h.hoursOTNight }))
  if (h.hoursSundayOT)      p.push(t('history.hoursSundayOT', { h: h.hoursSundayOT }))
  if (h.hoursSundayNight)   p.push(t('history.hoursSundayNight', { h: h.hoursSundayNight }))
  if (h.hoursSundayOTNight) p.push(t('history.hoursSundayOTNight', { h: h.hoursSundayOTNight }))
  return p.join(' + ')
}

/** 経費を LINE通知と同じ表記の行配列に整形 */
function expenseLines(exp: any): string[] {
  const out: string[] = []
  if (!exp) return out
  if (exp.carpool) {
    out.push(t('history.expCarpool'))
  } else {
    for (const v of (exp.vehicles || [])) {
      if (!v) continue
      const p: string[] = []
      if (v.vehicleName) p.push(v.vehicleName)
      if (v.distanceKm)  p.push(t('history.expRoundTrip', { km: v.distanceKm }))
      if (v.dieselKm)    p.push(t('history.expDiesel', { km: v.dieselKm }))
      if (v.parkingYen)  p.push(t('history.expParking', { yen: yen(v.parkingYen) }))
      if (v.highwayYen)  p.push(t('history.expHighway', { yen: yen(v.highwayYen) }))
      if (v.etcUsed)     p.push(t('history.expEtc', { card: v.etcCard || '' }))
      if (p.length) out.push(p.join(' '))
    }
  }
  for (const p of (exp.parkings || [])) if (p?.yen) out.push(t('history.expParking', { yen: yen(p.yen) }))
  for (const h of (exp.highways || [])) if (h?.yen) out.push(`${t('history.expHighway', { yen: yen(h.yen) })}${h.etcCard ? ` ${t('history.expEtc', { card: h.etcCard })}` : ''}`)
  for (const tr of (exp.trains || [])) if (tr?.yen) out.push(t('history.expWithYen', { label: tr.label || t('history.expTrainDefault'), yen: yen(tr.yen) }))
  for (const o of (exp.others || [])) if (o?.yen) out.push(t('history.expWithYen', { label: o.label || t('history.expOtherDefault'), yen: yen(o.yen) }))
  // 宿泊費: 新形式 hotels[]（複数）。旧スカラーは hotels[] に金額が無い時だけ（二重計上防止）。
  for (const ho of (exp.hotels || [])) if (ho?.yen) out.push(t('history.expWithYen', { label: ho.label || t('history.expHotelDefault'), yen: yen(ho.yen) }))
  const _hasHotelsArr = (exp.hotels || []).some((h: any) => h?.yen)
  if (exp.hotelYen     && !_hasHotelsArr) out.push(t('history.expWithYen', { label: exp.hotelName || t('history.expHotelDefault'), yen: yen(exp.hotelYen) }))
  if (exp.leopalaceYen && !_hasHotelsArr) out.push(t('history.expWithYen', { label: exp.leopalaceName || t('history.expLeopalaceDefault'), yen: yen(exp.leopalaceYen) }))
  for (const e of (exp.entertainments || [])) if (e?.yen) out.push(t('history.expWithYen', { label: e.label || t('history.expMiscDefault'), yen: yen(e.yen) }))
  if (exp.entertainmentYen && !(exp.entertainments || []).some((e: any) => e?.yen)) out.push(t('history.expWithYen', { label: exp.entertainmentLabel || t('history.expMiscDefault'), yen: yen(exp.entertainmentYen) }))
  if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
    const g: string[] = []
    if (exp.garbageFactoryM3) g.push(t('history.expGarbageWood', { m3: exp.garbageFactoryM3 }))
    if (exp.garbageSiteM3)    g.push(t('history.expGarbageMixed', { m3: exp.garbageSiteM3 }))
    out.push(t('history.expGarbage', { detail: g.join(' ') }))
  }
  return out
}

/** 1日報 → 現場ごとの明細（展開時にキャッシュ）*/
function buildDetail(rep: any): SiteDetail[] {
  const hoursMap = computeHoursForReport(rep)
  return (rep.sites || []).map((site: any, si: number): SiteDetail => ({
    name: siteDisplayName(site),
    contractor: site.contractorName === '__other__' ? (site.customContractorName || '') : (site.contractorName || ''),
    workers: (site.workers || [])
      .map((w: any, wi: number) => ({ w, wi }))
      .filter(({ w }: any) => w.workerName)
      .map(({ w, wi }: any): WorkerLine => ({
        name: w.workerName,
        time: (w.startTime && w.endTime) ? `${w.startTime}〜${w.endTime}` : '',
        hours: hoursParts(hoursMap[`${si}-${wi}`]) || hoursParts(w),
      })),
    expenses: expenseLines(site.expenses),
    subs: (site.subcontractors || [])
      .filter((s: any) => s.subcontractorName)
      .map((s: any) => {
        const nm = s.subcontractorName === '__other__' ? (s.customSubcontractorName || t('history.newSub')) : s.subcontractorName
        return t('history.subCount', { name: nm, count: s.count || 1 })
      }),
    note: site.siteNote || '',
  })).filter((s: SiteDetail) => s.name)
}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #EFEFEF; --surface: #fff; --border: #E0E0E0;
  --accent: #06C755; --text: #111; --text2: #888; --radius: 12px;
  --font: 'Noto Sans JP', -apple-system, sans-serif;
}
html, body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; -webkit-font-smoothing: antialiased; }
</style>

<style scoped>
.main { max-width: 640px; margin: 0 auto; padding: 16px 16px 80px; }

.state-screen {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 20px; gap: 16px; text-align: center;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { font-size: 14px; color: var(--text2); }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 20px; gap: 16px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 15px; color: var(--text2); }
.btn-primary {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 13px 28px; font-size: 15px; font-weight: 700; font-family: var(--font);
  cursor: pointer; text-decoration: none; display: inline-block;
}

.report-list { display: flex; flex-direction: column; gap: 8px; }

.month-label {
  font-size: 11px; font-weight: 800; letter-spacing: 2px;
  color: var(--text2); padding: 12px 4px 4px;
}

.report-card {
  background: #fff; border-radius: var(--radius);
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}

.report-card-top {
  display: flex; align-items: center; justify-content: space-between;
}
.report-date { font-size: 16px; font-weight: 700; color: var(--text); }

.badge-pending { background: #dbeafe; color: #1e40af; }
/* 承認待ち（まだ日報が無い新規提出）。中身は通常の日報カードと同じ描画で、枠だけ変えて区別する */
.report-card.pending-only { border: 1px dashed #7ea8dd; background: #f5f9ff; }
.pending-note { font-size: 12px; color: #1e4f8a; margin: 6px 0 0; line-height: 1.6; }
.detail-punch { font-size: 12px; color: #475569; margin-top: 2px; }

/* 差し戻し。承認待ち（青）とは別物なので赤系で、一覧の先頭に出す */
.rejected-card {
  background: #fff5f5; border: 1px solid #f0a3a3; border-radius: var(--radius);
  padding: 14px 16px; margin-bottom: 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.rejected-head { display: flex; align-items: center; gap: 6px; }
.rejected-icon { font-size: 20px; color: #c0392b; }
.rejected-title { font-size: 14px; font-weight: 700; color: #c0392b; }
.rejected-date { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--text); }
.rejected-reason {
  margin: 2px 0 0; font-size: 14px; line-height: 1.6; color: var(--text);
  background: #fff; border-radius: 8px; padding: 8px 10px;
}
.rejected-reason-label {
  display: inline-block; font-size: 11px; font-weight: 700; color: #c0392b;
  margin-right: 6px;
}
.rejected-lead { margin: 0; font-size: 12px; color: var(--text2); line-height: 1.6; }
.rejected-by { margin: 0; font-size: 11px; color: var(--text2); }
.rejected-actions { display: flex; gap: 8px; margin-top: 4px; }
.btn-rejected-fix {
  flex: 1; text-align: center; text-decoration: none;
  background: #c0392b; color: #fff; font-size: 13px; font-weight: 700;
  border-radius: 8px; padding: 10px 12px;
}
.btn-rejected-ack {
  background: #fff; color: var(--text2); border: 1px solid #ddd;
  font-size: 13px; border-radius: 8px; padding: 10px 14px; cursor: pointer;
}
.status-badge {
  font-size: 11px; font-weight: 700; border-radius: 20px; padding: 3px 10px;
}
.badge-working    { background: #e8f9ef; color: #06C755; }
.badge-off        { background: #f5f5f5; color: var(--text2); }
.badge-paid-leave { background: #fff3e0; color: #e67e22; }

.site-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.site-chip {
  font-size: 12px; color: #06C755; background: #e8f9ef;
  border-radius: 6px; padding: 3px 8px;
}

.report-note {
  font-size: 13px; color: var(--text2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.report-note.full { white-space: normal; overflow: visible; }

/* ── 詳細（展開）── */
.detail {
  border-top: 1px dashed var(--border);
  padding-top: 12px; margin-top: 2px;
  display: flex; flex-direction: column; gap: 14px;
}
.detail-leave { font-size: 14px; font-weight: 700; color: var(--text); }
.detail-site { display: flex; flex-direction: column; gap: 6px; }
.detail-site-name { font-size: 14px; font-weight: 700; color: var(--text); }
.detail-contractor { font-size: 13px; font-weight: 600; color: #6b4eff; }
.detail-icon { font-size: 14px; vertical-align: -2px; margin-right: 2px; }
.btn-icon { font-size: 14px; vertical-align: -2px; margin-right: 2px; }
.detail-list { list-style: none; display: flex; flex-direction: column; gap: 4px; padding: 0; margin: 0; }
.detail-list li {
  font-size: 13px; color: #444; line-height: 1.5;
  display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline;
}
.detail-list .dl-main { font-weight: 600; color: var(--text); }
.detail-list .dl-sub  { color: var(--text2); font-size: 12px; }
.detail-list.expense li { color: #555; }
.detail-list.sub li { color: #555; }
.detail-note {
  font-size: 12px; color: var(--text2);
  background: #f7f7f7; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap;
}
.detail-empty { font-size: 13px; color: var(--text2); }

.report-card-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 4px;
}
.updated-at { font-size: 11px; color: #bbb; }
.btn-edit {
  font-size: 13px; font-weight: 700; color: #06C755;
  text-decoration: none; background: transparent; border: 1px solid #06C755;
  border-radius: 6px; padding: 6px 14px; cursor: pointer;
  transition: background .15s, color .15s;
}
.btn-edit:hover { background: var(--accent); color: #fff; }
.btn-unlock {
  font-size: 13px; font-weight: 700; color: #b45309;
  background: #fef3c7; border: 1px solid #fcd34d;
  border-radius: 6px; padding: 6px 14px; cursor: pointer;
}
.btn-unlock:disabled { opacity: .6; cursor: default; }
.lock-pending { font-size: 12px; font-weight: 700; color: #92400e; }
.btn-cancel-unlock {
  font-size: 13px; font-weight: 700; color: #92400e;
  background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 6px; padding: 6px 14px; cursor: pointer;
}
.btn-cancel-unlock:disabled { opacity: .6; cursor: default; }
.req-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
.req-modal { background: #fff; border-radius: 14px; padding: 20px; width: 100%; max-width: 420px; }
.req-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #111827; }
.req-sub { font-size: 12px; color: #6b7280; margin: 0 0 10px; line-height: 1.5; }
.req-textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 14px; resize: vertical; }
.req-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.req-cancel { font-size: 14px; color: #64748b; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 16px; cursor: pointer; }
.req-submit { font-size: 14px; font-weight: 700; color: #fff; background: #06C755; border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; }
.req-submit:disabled { opacity: .6; cursor: default; }
</style>
