<template>
  <div>
    <h1 class="page-title">日報一覧</h1>

    <div class="filters">
      <input v-model="search" class="input" placeholder="作業員名で検索..." />
      <input v-model="dateFrom" type="date" class="input" />
      <span>〜</span>
      <input v-model="dateTo" type="date" class="input" />
      <button class="btn-search" @click="load">検索</button>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="reports.length === 0" class="empty">日報が見つかりません</div>

    <div v-else class="report-list">
      <div v-for="r in reports" :key="r.id" class="report-card">
        <div class="report-header" @click="selected = r">
          <span class="report-date">{{ r.date }}</span>
          <span class="report-worker">{{ r.worker_name ?? '—' }}</span>
          <span class="badge" :class="r.is_working ? 'working' : 'off'">{{ r.is_working ? '稼働' : '休み' }}</span>
          <span class="detail-hint">詳細 →</span>
        </div>
        <div v-if="r.is_working && r.sites?.length" class="sites" @click="selected = r">
          <div v-for="(site, i) in r.sites" :key="i" class="site-row">
            <span class="site-name">{{ resolveSiteName(site) }}</span>
            <span class="worker-count">作業員 {{ site.workers?.length ?? 0 }}名</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-delete-sm" @click.stop="confirmDelete(r)">削除</button>
        </div>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head">
          <div>
            <div class="modal-date">{{ selected.date }}</div>
            <div class="modal-worker">
              {{ selected.worker_name }}
              <span v-if="selected.sites?.[0]?.workers?.[0]?.workerRole" class="worker-role-inline">
                / {{ selected.sites[0].workers[0].workerRole === 'factory' ? '工場' : '現場' }}
              </span>
            </div>
          </div>
          <div class="modal-head-right">
            <span class="badge" :class="selected.is_working ? 'working' : 'off'">
              {{ selected.is_working ? '稼働' : '休み' }}
            </span>
            <button class="btn-delete" @click="confirmDelete(selected)">削除</button>
            <button class="btn-close" @click="selected = null">✕</button>
          </div>
        </div>

        <div v-if="!selected.is_working" class="off-note">この日は休みです</div>

        <div v-else>
          <div v-for="(site, si) in selected.sites" :key="si" class="site-block">
            <div class="site-block-title">{{ resolveSiteName(site) }}</div>

            <!-- 作業員 -->
            <div v-if="site.workers?.length" class="section">
              <div class="section-label">稼働</div>
              <table class="inner-table">
                <thead>
                  <tr><th>開始</th><th>終了</th><th>通常</th><th>残業</th><th>深夜</th></tr>
                </thead>
                <tbody>
                  <template v-for="(w, wi) in site.workers" :key="wi">
                    <tr>
                      <td>{{ w.startTime }}</td>
                      <td>{{ w.endTime }}</td>
                      <template v-if="w.startTime && w.endTime">
                        <td>{{ calcHours(w, selected.date).normal }}</td>
                        <td>{{ calcHours(w, selected.date).ot }}</td>
                        <td>{{ calcHours(w, selected.date).night }}</td>
                      </template>
                      <template v-else>
                        <td>—</td><td>—</td><td>—</td>
                      </template>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <!-- 下請け業者 -->
            <div v-if="site.subcontractors?.filter((s: any) => s.subcontractorName).length" class="section">
              <div class="section-label">下請け業者</div>
              <div v-for="(s, si2) in site.subcontractors.filter((s: any) => s.subcontractorName)" :key="si2" class="sub-row">
                <span>{{ s.subcontractorName }}</span>
                <span class="muted">{{ s.count }}名</span>
              </div>
            </div>

            <!-- 経費 -->
            <div v-if="hasExpenses(site.expenses)" class="section">
              <div class="section-label">経費</div>
              <div v-for="(veh, vi) in site.expenses?.vehicles?.filter((v: any) => v.vehicleName)" :key="'v'+vi" class="expense-row">
                <span class="exp-cat">車両</span>
                <span>{{ veh.vehicleName }}</span>
                <span v-if="veh.distanceKm" class="muted">ガソリン {{ veh.distanceKm }}km</span>
                <span v-if="veh.dieselKm" class="muted">軽油 {{ veh.dieselKm }}km</span>
                <span v-if="veh.parkingYen" class="muted">駐車 ¥{{ veh.parkingYen.toLocaleString() }}</span>
                <span v-if="veh.highwayYen" class="muted">高速 ¥{{ veh.highwayYen.toLocaleString() }}</span>
              </div>
              <div v-for="(tr, ti) in site.expenses?.trains?.filter((t: any) => t.yen)" :key="'t'+ti" class="expense-row">
                <span class="exp-cat">電車</span>
                <span>{{ tr.label }}</span>
                <span class="muted">¥{{ tr.yen?.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.hotelYen" class="expense-row">
                <span class="exp-cat">宿泊</span>
                <span>{{ site.expenses.hotelName }}</span>
                <span class="muted">¥{{ site.expenses.hotelYen.toLocaleString() }}</span>
              </div>
              <div v-for="(ot, oi) in site.expenses?.others?.filter((o: any) => o.yen)" :key="'o'+oi" class="expense-row">
                <span class="exp-cat">その他</span>
                <span>{{ ot.label }}</span>
                <span class="muted">¥{{ ot.yen?.toLocaleString() }}</span>
              </div>
            </div>
          </div>

          <!-- 備考 -->
          <div v-if="selected.note" class="section note-section">
            <div class="section-label">備考</div>
            <div class="note-text">{{ selected.note }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { computeWorkerHours, calcBreakMinutes } from '../lib/workerHours'

const search   = ref('')
const now      = new Date()
const dateFrom = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
const dateTo   = ref(now.toISOString().split('T')[0])
const loading  = ref(false)
const deleting = ref(false)
const reports  = ref<any[]>([])
const selected = ref<any | null>(null)

function confirmDelete(r: any) {
  if (!confirm(`${r.date} ${r.worker_name ?? ''} の日報を削除しますか？`)) return
  deleteReport(r)
}

async function deleteReport(r: any) {
  deleting.value = true
  const { error } = await supabase.from('daily_reports').delete().eq('id', r.id)
  deleting.value = false
  if (error) { alert('削除に失敗しました: ' + error.message); return }
  reports.value = reports.value.filter(rep => rep.id !== r.id)
  if (selected.value?.id === r.id) selected.value = null
}

function calcHours(w: any, date: string) {
  const isSunday = new Date(date + 'T00:00:00').getDay() === 0
  const role = w.workerRole || 'site'
  const brk  = calcBreakMinutes(role, w.startTime, w.endTime)
  const h    = computeWorkerHours(w.startTime, w.endTime, brk, isSunday)
  return {
    normal: h.hoursNormal + h.hoursSunday,
    ot:     h.hoursOT + h.hoursOTNight + h.hoursSundayOT + h.hoursSundayOTNight,
    night:  h.hoursNight + h.hoursOTNight + h.hoursSundayNight + h.hoursSundayOTNight,
  }
}

function resolveSiteName(site: any): string {
  const n = site.siteName ?? ''
  return n === '__other__' ? (site.customSiteName?.trim() || '新規現場') : (n || '(現場名なし)')
}

function hasExpenses(exp: any): boolean {
  if (!exp) return false
  return (
    exp.vehicles?.some((v: any) => v.vehicleName) ||
    exp.trains?.some((t: any) => t.yen) ||
    exp.hotelYen ||
    exp.others?.some((o: any) => o.yen)
  )
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, sites, note, user_id, users(real_name, worker_id, workers(name))')
    .eq('account_id', accountId)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: false })
    .limit(200)

  reports.value = (data ?? []).map((r: any) => ({
    ...r,
    worker_name: r.users?.workers?.name ?? r.users?.real_name ?? '—',
  })).filter(r =>
    !search.value || r.worker_name.includes(search.value)
  )
  loading.value = false
}

onMounted(load)
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }
.filters { display: flex; gap: 12px; align-items: center; margin-bottom: 24px; flex-wrap: wrap; }
.input { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 9px 14px; font-size: 14px; }
.btn-search { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 9px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.empty { color: #888; padding: 40px; text-align: center; }
.report-list { display: flex; flex-direction: column; gap: 12px; }
.report-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); transition: box-shadow .15s; }
.report-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
.report-header { cursor: pointer; }
.card-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
.btn-delete-sm { background: none; border: 1px solid #fca5a5; color: #dc2626; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.btn-delete-sm:hover { background: #fef2f2; }
.btn-delete { background: #dc2626; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-delete:hover { background: #b91c1c; }
.report-header { display: flex; align-items: center; gap: 12px; }
.report-date { font-weight: 700; font-size: 15px; min-width: 100px; }
.report-worker { font-size: 14px; color: #555; flex: 1; }
.detail-hint { font-size: 12px; color: #aaa; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.working { background: #e8fff0; color: #0a8a3a; }
.badge.off { background: #f5f5f5; color: #aaa; }
.sites { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; padding-left: 8px; border-left: 2px solid #06C755; }
.site-row { display: flex; gap: 16px; font-size: 13px; }
.site-name { font-weight: 600; }
.worker-count { color: #888; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-start; justify-content: center; z-index: 100; padding: 40px 16px; overflow-y: auto; }
.modal { background: #fff; border-radius: 16px; width: 100%; max-width: 720px; padding: 32px; display: flex; flex-direction: column; gap: 20px; }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; }
.modal-date { font-size: 20px; font-weight: 900; }
.modal-worker { font-size: 15px; color: #555; margin-top: 4px; }
.modal-head-right { display: flex; align-items: center; gap: 12px; }
.btn-close { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 12px; font-size: 14px; cursor: pointer; }
.off-note { color: #888; font-size: 14px; text-align: center; padding: 24px 0; }
.site-block { border: 1px solid #eee; border-radius: 12px; overflow: hidden; }
.site-block-title { background: #f9f9f9; padding: 10px 16px; font-weight: 700; font-size: 14px; border-bottom: 1px solid #eee; }
.section { padding: 12px 16px; border-top: 1px solid #f0f0f0; }
.section:first-child { border-top: none; }
.section-label { font-size: 11px; font-weight: 700; color: #06C755; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.worker-name-row { font-weight: 700; font-size: 13px; padding-bottom: 2px !important; border-bottom: none !important; }
.worker-role-inline { margin-left: 6px; font-size: 11px; color: #888; font-weight: 400; }
.inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.inner-table th { background: #f9f9f9; padding: 6px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.inner-table td { padding: 8px 10px; border-top: 1px solid #f5f5f5; }
.sub-row { display: flex; gap: 12px; font-size: 13px; padding: 4px 0; }
.expense-row { display: flex; gap: 10px; align-items: center; font-size: 13px; padding: 4px 0; border-top: 1px solid #f5f5f5; }
.expense-row:first-child { border-top: none; }
.exp-cat { font-size: 10px; background: #f0f0f0; color: #666; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0; }
.muted { color: #888; font-size: 12px; }
.note-section { background: #fafafa; }
.note-text { font-size: 14px; color: #333; white-space: pre-wrap; }
</style>
