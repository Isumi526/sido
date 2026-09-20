<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">距離の超過申請</h1>
      <HelpButton title="距離の超過申請" :items="[
        '作業員が日報で、現場マスタの既定距離（会社からの往復km）より大きい距離を入れると、理由付きでここに届きます。',
        '承認するまでは既定の距離で計上されます（未承認の超過分でガソリン按分の金額は動きません）。承認すると入力した距離に置き換わり、集計に反映されます。',
        '月次を締める前に承認待ちを残さないでください（承認後に差し替わるため、締め後に承認すると集計が変わります）。',
        '自分が出した申請は自分では承認できません。別の承認者に依頼してください。',
      ]" />
    </div>
    <p class="hint">
      現場の既定距離を超えて入力された距離の承認/却下です。
      <b>承認するまでは既定の距離で計上</b>され、承認すると申請した距離に置き換わります（却下は既定のまま）。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!pending.length" class="empty" data-testid="da-empty">承認待ちの超過申請はありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="da-pending">
        <thead>
          <tr>
            <th>日付</th>
            <th>作業員</th>
            <th>現場</th>
            <th>距離</th>
            <th>理由</th>
            <th>申請日時</th>
            <th class="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pending" :key="r.key" :data-testid="`da-row-${r.key}`">
            <td class="muted">{{ r.date }}</td>
            <td class="name">{{ r.workerName }}</td>
            <td>{{ r.siteName || '—' }}<span v-if="r.vehicleName" class="muted">（{{ r.vehicleName }}）</span></td>
            <td class="change" :data-testid="`da-change-${r.key}`">
              {{ fieldLabel(r.field) }} 既定 {{ r.overage.defaultKm }}km → <b>申請 {{ r.overage.requestedKm }}km</b>
              <span class="delta">（+{{ round1(r.overage.requestedKm - r.overage.defaultKm) }}km）</span>
            </td>
            <td class="reason">{{ r.overage.reason || '—' }}</td>
            <td class="muted">{{ fmtDateTime(r.overage.requestedAt) }}</td>
            <td class="actions-col">
              <!-- ★自分が出した申請は自分で決裁させない。EF 側でも同じ判定で塞いでいる（画面だけだと EF 直叩きで迂回できる） -->
              <span v-if="isMine(r)" class="self-approve-blocked" data-testid="da-self-blocked">自分の申請は承認できません</span>
              <template v-else>
                <button class="btn-approve" :disabled="busy === r.key" :data-testid="`da-approve-${r.key}`" @click="decide(r, 'approved')">承認</button>
                <button class="btn-reject" :disabled="busy === r.key" :data-testid="`da-reject-${r.key}`" @click="decide(r, 'rejected')">却下</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="page-header" style="margin-top:28px">
      <h2 class="section-title">承認の履歴</h2>
    </div>
    <p class="hint">誰がいつ承認/却下したかの記録です。直近50件を新しい順に表示します。</p>
    <div v-if="!decided.length" class="empty" data-testid="da-history-empty">承認/却下した記録はまだありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="da-history">
        <thead>
          <tr><th>日付</th><th>作業員</th><th>現場</th><th>距離</th><th>結果</th><th>承認/却下した人</th><th>日時</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in decided" :key="r.key" data-testid="da-history-row">
            <td class="muted">{{ r.date }}</td>
            <td class="name">{{ r.workerName }}</td>
            <td>{{ r.siteName || '—' }}</td>
            <td class="change">{{ fieldLabel(r.field) }} {{ r.overage.defaultKm }}km → {{ r.overage.requestedKm }}km</td>
            <td><span class="status" :class="r.overage.status === 'approved' ? 'ok' : 'ng'">{{ r.overage.status === 'approved' ? '承認' : '却下' }}</span></td>
            <td data-testid="da-history-approver">{{ r.overage.decidedBy || '—' }}</td>
            <td class="muted">{{ fmtDateTime(r.overage.decidedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 距離の超過申請の承認（距離Step2・2026-09-20）。
 *
 * ★申請は別テーブルではなく日報 JSON（sites[].expenses.vehicles[].overages[field]）に入っている
 *  （shared/distance-overage.ts の設計メモ参照）。一覧は daily_reports を走査して拾う＝
 *  ナビのバッジ（navBadges.ts）と同じ判定を使う（片方だけ直すと「バッジは1件・開くと空」になる）。
 * ★書き込みは EF(report-distance) 経由。権限検査・自己承認の禁止・承認者名の確定・距離の差し替えは EF 側。
 */
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentWorkerId } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'
import HelpButton from '../components/HelpButton.vue'
import { DISTANCE_FIELDS, DISTANCE_FIELD_LABELS, type DistanceField, type DistanceOverage } from '../lib/distance-overage.gen'

type Row = {
  key: string
  reportId: string
  date: string
  userId: string | null
  workerId: string | null
  workerName: string
  siteIndex: number
  vehicleIndex: number
  field: DistanceField
  siteName: string
  vehicleName: string
  overage: DistanceOverage
}

const loading = ref(true)
const busy    = ref<string | null>(null)
const pending = ref<Row[]>([])
const decided = ref<Row[]>([])

const fieldLabel = (f: DistanceField) => DISTANCE_FIELD_LABELS[f]
const round1 = (n: number) => Math.round(n * 10) / 10
function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const dt = new Date(s)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  // 直近180日の日報を走査（バッジは90日。履歴も見せるので少し広く取る）
  const since = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0]
  const [{ data: reps }, { data: users }] = await Promise.all([
    supabase.from('daily_reports').select('id, user_id, date, sites').eq('account_id', accountId).gte('date', since)
      .order('date', { ascending: false }).limit(15000),
    supabase.from('users').select('id, real_name, worker_id').eq('account_id', accountId),
  ])
  const userMap: Record<string, { name: string; workerId: string | null }> = {}
  for (const u of (users ?? []) as any[]) userMap[u.id] = { name: u.real_name ?? '（不明）', workerId: u.worker_id ?? null }

  const p: Row[] = []; const d: Row[] = []
  for (const rep of (reps ?? []) as any[]) {
    const sites = Array.isArray(rep.sites) ? rep.sites : []
    sites.forEach((site: any, si: number) => {
      const vehicles = Array.isArray(site?.expenses?.vehicles) ? site.expenses.vehicles : []
      vehicles.forEach((veh: any, vi: number) => {
        for (const field of DISTANCE_FIELDS) {
          const o = veh?.overages?.[field] as DistanceOverage | undefined
          if (!o) continue
          const u = rep.user_id ? userMap[rep.user_id] : undefined
          const row: Row = {
            key: `${rep.id}-${si}-${vi}-${field}`, reportId: rep.id, date: rep.date, userId: rep.user_id ?? null,
            workerId: u?.workerId ?? null, workerName: u?.name ?? '（不明）',
            siteIndex: si, vehicleIndex: vi, field, siteName: String(site?.siteName ?? ''), vehicleName: String(veh?.vehicleName ?? ''), overage: o,
          }
          if (o.status === 'pending') p.push(row); else d.push(row)
        }
      })
    })
  }
  pending.value = p.reverse()   // 古い順に処理する
  decided.value = d.sort((a, b) => String(b.overage.decidedAt ?? '').localeCompare(String(a.overage.decidedAt ?? ''))).slice(0, 50)
  loading.value = false
}

/** その申請を出したのが自分か（＝自己承認になるか）。worker行を持たない純オーナーは常に false */
function isMine(r: Row): boolean {
  return !!currentWorkerId.value && r.workerId === currentWorkerId.value
}

const DECIDE_ERRORS: Record<string, string> = {
  APPROVE_FORBIDDEN: '承認する権限がありません。',
  SELF_APPROVAL_FORBIDDEN: '自分が出した申請は自分では承認できません。別の承認者に依頼してください。',
  not_found: '対象の日報が見つかりません（削除された可能性があります）。',
  conflict: 'この日報は作業員が編集中です。再読み込みして確認してください。',
  unauthorized: 'ログインし直してください。',
}

async function decide(r: Row, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = r.key
  const { data, error } = await supabase.functions.invoke('report-distance', {
    body: { action: 'decide', reportId: r.reportId, siteIndex: r.siteIndex, vehicleIndex: r.vehicleIndex, field: r.field, status },
  })
  busy.value = null
  if (error || !data?.ok) {
    let code = (data as any)?.error ?? ''
    // functions.invoke は非2xxで error になり data が空。本文からコードを拾う
    if (!code && error && 'context' in (error as any)) {
      try { code = (await (error as any).context?.json?.())?.error ?? '' } catch { /* noop */ }
    }
    alert(DECIDE_ERRORS[code] ?? `更新に失敗しました${code ? `: ${code}` : ''}`)
    await load()
    return
  }
  await refreshNavBadges()
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.section-title { font-size: 17px; font-weight: 700; }
.hint { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.7; }
.empty { color: #94a3b8; font-size: 14px; padding: 20px; background: #fff; border-radius: 12px; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; white-space: nowrap; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.name { font-weight: 600; white-space: nowrap; }
.change { white-space: nowrap; }
.delta { color: #b45309; font-size: 12px; margin-left: 4px; }
.reason { color: #475569; min-width: 180px; }
.muted { color: #94a3b8; font-size: 13px; white-space: nowrap; }
.actions-col { white-space: nowrap; }
.btn-approve { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-reject { background: #fff; color: #b91c1c; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; margin-left: 8px; }
.self-approve-blocked { color: #94a3b8; font-size: 12px; }
.status { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.status.ok { color: #15803d; background: #dcfce7; }
.status.ng { color: #b91c1c; background: #fee2e2; }
</style>
