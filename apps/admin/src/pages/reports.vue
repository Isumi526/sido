<template>
  <div>
    <h1 class="page-title">日報一覧</h1>

    <div class="filters">
      <!-- 作業員プルダウン -->
      <select v-model="selectedWorker" class="input select-worker" @change="load">
        <option value="">全作業員</option>
        <option v-for="w in workerOptions" :key="w" :value="w">{{ w }}</option>
      </select>

      <!-- 月ナビ -->
      <div class="month-nav">
        <button class="month-btn" @click="prevMonth">‹</button>
        <span class="month-label">{{ navYear }}年{{ navMonth }}月</span>
        <button class="month-btn" @click="nextMonth">›</button>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="reports.length === 0" class="empty">日報が見つかりません</div>

    <div v-else class="report-list">
      <div v-for="r in reports" :key="r.id" class="report-card">
        <div class="report-header" @click="selected = r">
          <span class="report-date">{{ r.date }}</span>
          <span class="report-worker">{{ r.worker_name ?? '—' }}</span>
          <span class="badge" :class="r.leave_type === 'paid_leave' ? 'paid-leave' : r.is_working ? 'working' : 'off'">{{ r.leave_type === 'paid_leave' ? '有給' : r.is_working ? '稼働' : '休み' }}</span>
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
              <span v-if="selected.users?.workers?.unit_price" class="unit-price-inline">
                ¥{{ selected.users.workers.unit_price.toLocaleString() }}/日
              </span>
            </div>
          </div>
          <div class="modal-head-right">
            <span class="badge" :class="selected.leave_type === 'paid_leave' ? 'paid-leave' : selected.is_working ? 'working' : 'off'">
              {{ selected.leave_type === 'paid_leave' ? '有給' : selected.is_working ? '稼働' : '休み' }}
            </span>
            <button class="btn-delete" @click="confirmDelete(selected)">削除</button>
            <button class="btn-close" @click="selected = null">✕</button>
          </div>
        </div>

        <div v-if="selected.leave_type === 'paid_leave'" class="off-note">有給休暇（8h）</div>
        <div v-else-if="!selected.is_working" class="off-note">この日は休みです</div>

        <div v-else>
          <div v-for="(site, si) in selected.sites" :key="si" class="site-block">
            <div class="site-block-title">{{ resolveSiteName(site) }}</div>

            <!-- 作業員 -->
            <div v-if="site.workers?.length" class="section">
              <div class="section-label">稼働</div>
              <table class="inner-table">
                <thead>
                  <tr><th>開始</th><th>終了</th><th>休憩</th><th>通常</th><th>残業<span class="rate-note">(×1.25)</span></th><th>深夜<span class="rate-note">(×1.25)</span></th></tr>
                </thead>
                <tbody>
                  <template v-for="(w, wi) in site.workers" :key="wi">
                    <tr>
                      <td>{{ w.startTime }}</td>
                      <td>{{ w.endTime }}</td>
                      <template v-if="w.startTime && w.endTime">
                        <td>{{ calcBreakMinutes(w.workerRole || 'site', w.startTime, w.endTime) / 60 }}</td>
                        <td>{{ calcHours(w, selected.date).normal }}</td>
                        <td>{{ calcHours(w, selected.date).ot }}</td>
                        <td>{{ calcHours(w, selected.date).night }}</td>
                      </template>
                      <template v-else>
                        <td>—</td><td>—</td><td>—</td><td>—</td>
                      </template>
                    </tr>
                  </template>
                </tbody>
              </table>
              <div v-if="selected.users?.workers?.unit_price" class="labor-cost">
                人件費
                <span class="labor-cost-amount">
                  ¥{{ site.workers.reduce((sum: number, w: any) => sum + (w.startTime && w.endTime ? calcLaborCost(w, selected.date, selected.users.workers.unit_price) : 0), 0).toLocaleString() }}
                </span>
              </div>
            </div>

            <!-- 下請け業者 -->
            <div v-if="site.subcontractors?.filter((s: any) => s.subcontractorName).length" class="section">
              <div class="section-label">下請け業者</div>
              <div v-for="(s, si2) in site.subcontractors.filter((s: any) => s.subcontractorName)" :key="si2" class="sub-row">
                <span>{{ s.subcontractorName === '__other__' ? (s.customSubcontractorName || '新規業者') : s.subcontractorName }}</span>
                <span class="muted">{{ s.count }}名</span>
                <span v-if="subMaster[s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName]?.unit_price" class="sub-cost">
                  ¥{{ (subMaster[s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName].unit_price! * s.count).toLocaleString() }}
                </span>
              </div>
              <!-- 合計 -->
              <div class="labor-cost">
                下請け費合計
                <span class="labor-cost-amount">
                  ¥{{ site.subcontractors.filter((s: any) => s.subcontractorName)
                    .reduce((sum: number, s: any) => {
                      const key = s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName
                      return sum + (subMaster[key]?.unit_price ?? 0) * (s.count ?? 0)
                    }, 0)
                    .toLocaleString() }}
                </span>
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
              <div v-if="site.expenses?.vehicleUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.vehicleUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 車両領収書{{ site.expenses.vehicleUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-for="(tr, ti) in site.expenses?.trains?.filter((t: any) => t.yen)" :key="'t'+ti" class="expense-row">
                <span class="exp-cat">電車</span>
                <span>{{ tr.label }}</span>
                <span class="muted">¥{{ tr.yen?.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.trainUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.trainUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 電車領収書{{ site.expenses.trainUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-if="site.expenses?.hotelYen" class="expense-row">
                <span class="exp-cat">宿泊</span>
                <span>{{ site.expenses.hotelName }}</span>
                <span class="muted">¥{{ site.expenses.hotelYen.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.hotelUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.hotelUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 宿泊領収書{{ site.expenses.hotelUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-if="site.expenses?.leopalaceYen" class="expense-row">
                <span class="exp-cat">宿泊</span>
                <span>{{ site.expenses.leopalaceName }}</span>
                <span class="muted">¥{{ site.expenses.leopalaceYen.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.leopalaceUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.leopalaceUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 レオパレス領収書{{ site.expenses.leopalaceUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-for="(ot, oi) in site.expenses?.others?.filter((o: any) => o.yen)" :key="'o'+oi" class="expense-row">
                <span class="exp-cat">その他</span>
                <span>{{ ot.label }}</span>
                <span class="muted">¥{{ ot.yen?.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.otherUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.otherUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 その他領収書{{ site.expenses.otherUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-if="site.expenses?.entertainmentYen" class="expense-row">
                <span class="exp-cat">雑経費</span>
                <span>{{ site.expenses.entertainmentLabel }}</span>
                <span class="muted">¥{{ site.expenses.entertainmentYen.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.entertainmentUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.entertainmentUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 雑経費領収書{{ site.expenses.entertainmentUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-if="site.expenses?.garbagePhotoUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.garbagePhotoUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link">📎 ゴミ写真{{ site.expenses.garbagePhotoUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
            </div>

            <!-- 現場備考 -->
            <div v-if="site.siteNote" class="section note-section">
              <div class="section-label">現場備考</div>
              <div class="note-text">{{ site.siteNote }}</div>
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
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { computeWorkerHours, calcBreakMinutes } from '../lib/workerHours'

// 下請けマスタ（name → {unit_price, category}）
const subMaster = ref<Record<string, { unit_price: number | null; category: string | null }>>({})

// 作業員フィルター
const selectedWorker = ref('')
const workerOptions  = ref<string[]>([])

// 月ナビ
const now      = new Date()
const navYear  = ref(now.getFullYear())
const navMonth = ref(now.getMonth() + 1)

const dateFrom = computed(() => `${navYear.value}-${String(navMonth.value).padStart(2, '0')}-01`)
const dateTo   = computed(() => {
  const last = new Date(navYear.value, navMonth.value, 0)
  return `${navYear.value}-${String(navMonth.value).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
})

function prevMonth() {
  if (navMonth.value === 1) { navYear.value--; navMonth.value = 12 }
  else navMonth.value--
  load()
}
function nextMonth() {
  if (navMonth.value === 12) { navYear.value++; navMonth.value = 1 }
  else navMonth.value++
  load()
}
const loading  = ref(false)
const deleting = ref(false)
const reports  = ref<any[]>([])
const selected = ref<any | null>(null)

function confirmDelete(r: any) {
  if (!confirm(`${r.date} ${r.worker_name ?? ''} の日報を削除しますか？`)) return
  deleteReport(r)
}

const URL_KEYS = ['vehicleUrls', 'trainUrls', 'hotelUrls', 'leopalaceUrls', 'otherUrls', 'entertainmentUrls', 'garbagePhotoUrls'] as const

function extractStoragePaths(r: any): string[] {
  const paths: string[] = []
  const MARKER = '/expense-receipts/'
  for (const site of (r.sites ?? [])) {
    const exp = site.expenses ?? {}
    for (const key of URL_KEYS) {
      for (const url of (exp[key] ?? [])) {
        const idx = url.indexOf(MARKER)
        if (idx !== -1) paths.push(decodeURIComponent(url.slice(idx + MARKER.length)))
      }
    }
  }
  return paths
}

async function deleteReport(r: any) {
  deleting.value = true

  // Storage ファイルを先に削除
  const paths = extractStoragePaths(r)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('expense-receipts').remove(paths)
    if (storageError) console.error('[Storage削除]', storageError.message)
  }

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

function calcLaborCost(w: any, date: string, unitPrice: number): number {
  const isSunday = new Date(date + 'T00:00:00').getDay() === 0
  const role = w.workerRole || 'site'
  const brk  = calcBreakMinutes(role, w.startTime, w.endTime)
  const h    = computeWorkerHours(w.startTime, w.endTime, brk, isSunday)
  const rate = unitPrice / 8
  return Math.round(rate * (
    h.hoursNormal        * 1.00 +
    h.hoursOT            * 1.25 +
    h.hoursNight         * 1.25 +
    h.hoursOTNight       * 1.50 +
    h.hoursSunday        * 1.35 +
    h.hoursSundayOT      * 1.60 +
    h.hoursSundayNight   * 1.60 +
    h.hoursSundayOTNight * 1.85
  ))
}

function resolveSiteName(site: any): string {
  const n = site.siteName ?? ''
  return n === '__other__' ? (site.customSiteName?.trim() || '新規現場') : (n || '(現場名なし)')
}

function hasExpenses(exp: any): boolean {
  if (!exp) return false
  return !!(
    exp.vehicles?.some((v: any) => v.vehicleName) ||
    exp.trains?.some((t: any) => t.yen) ||
    exp.hotelYen ||
    exp.leopalaceYen ||
    exp.others?.some((o: any) => o.yen) ||
    exp.entertainmentYen ||
    exp.garbagePhotoUrls?.length
  )
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()

  // 下請けマスタ取得
  const { data: subs } = await supabase
    .from('subcontractors')
    .select('name, unit_price, category')
    .eq('account_id', accountId)
  subMaster.value = Object.fromEntries(
    (subs ?? []).map((s: any) => [s.name, { unit_price: s.unit_price, category: s.category }])
  )

  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, leave_type, sites, note, user_id, users(real_name, worker_id, workers(name, unit_price))')
    .eq('account_id', accountId)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: false })
    .limit(200)

  const mapped = (data ?? []).map((r: any) => ({
    ...r,
    worker_name: r.users?.workers?.name ?? r.users?.real_name ?? '—',
  }))

  // 作業員プルダウン選択肢を更新（五十音順）
  const names = [...new Set(mapped.map((r: any) => r.worker_name).filter((n: string) => n && n !== '—'))]
  workerOptions.value = names.sort((a: string, b: string) => a.localeCompare(b, 'ja'))

  reports.value = selectedWorker.value
    ? mapped.filter((r: any) => r.worker_name === selectedWorker.value)
    : mapped
  loading.value = false
}

onMounted(load)
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }
.filters { display: flex; gap: 16px; align-items: center; margin-bottom: 24px; flex-wrap: wrap; }
.input { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 9px 14px; font-size: 14px; }
.select-worker { min-width: 160px; cursor: pointer; }
.month-nav { display: flex; align-items: center; gap: 12px; background: #f5f5f5; border-radius: 10px; padding: 6px 12px; }
.month-btn { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; width: 32px; height: 32px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #333; transition: background .15s; }
.month-btn:hover { background: #e8f9ef; border-color: #06C755; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
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
.badge.working    { background: #e8fff0; color: #0a8a3a; }
.badge.off        { background: #f5f5f5; color: #aaa; }
.badge.paid-leave { background: #fff3e0; color: #e67e22; }
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
.site-block { border: 1px solid #eee; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
.site-block-title { background: #f9f9f9; padding: 10px 16px; font-weight: 700; font-size: 14px; border-bottom: 1px solid #eee; }
.section { padding: 12px 16px; border-top: 1px solid #f0f0f0; }
.section:first-child { border-top: none; }
.section-label { font-size: 11px; font-weight: 700; color: #06C755; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.worker-name-row { font-weight: 700; font-size: 13px; padding-bottom: 2px !important; border-bottom: none !important; }
.worker-role-inline { margin-left: 6px; font-size: 11px; color: #888; font-weight: 400; }
.unit-price-inline { margin-left: 10px; font-size: 11px; color: #888; font-weight: 400; }
.labor-cost { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #888; font-weight: 600; }
.labor-cost-amount { font-size: 15px; font-weight: 700; color: #111; }
.rate-note { font-size: 10px; font-weight: 400; color: #aaa; margin-left: 2px; }
.inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.inner-table th { background: #f9f9f9; padding: 6px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.inner-table td { padding: 8px 10px; border-top: 1px solid #f5f5f5; }
.sub-row { display: flex; gap: 12px; font-size: 13px; padding: 4px 0; align-items: center; }
.sub-unit-price { color: #aaa; font-size: 11px; margin-left: auto; }
.sub-cost { font-weight: 700; font-size: 13px; min-width: 80px; text-align: right; }
.expense-row { display: flex; gap: 10px; align-items: center; font-size: 13px; padding: 4px 0; border-top: 1px solid #f5f5f5; }
.expense-row:first-child { border-top: none; }
.exp-cat { font-size: 10px; background: #f0f0f0; color: #666; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0; }
.muted { color: #888; font-size: 12px; }
.note-section { background: #fafafa; }
.note-text { font-size: 14px; color: #333; white-space: pre-wrap; }
.receipt-urls { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 8px; }
.receipt-link { font-size: 11px; color: #06C755; text-decoration: none; background: #e8fff0; padding: 2px 8px; border-radius: 4px; }
.receipt-link:hover { text-decoration: underline; }
</style>
