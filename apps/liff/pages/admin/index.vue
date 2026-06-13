<template>
  <div class="admin-app">
    <!-- ヘッダー -->
    <header class="admin-header">
      <div class="admin-header-inner">
        <div class="brand">
          <span class="brand-name">APP</span>
          <span class="brand-div">|</span>
          <span class="brand-sub">{{ $t('admin.brandSub') }}</span>
        </div>
        <nav class="header-tabs">
          <button :class="['tab-btn', { active: tab === 'dashboard' }]" @click="tab = 'dashboard'">{{ $t('admin.tabDashboard') }}</button>
          <button :class="['tab-btn', { active: tab === 'users' }]" @click="tab = 'users'">{{ $t('admin.tabUsers') }}</button>
          <button :class="['tab-btn', { active: tab === 'reports' }]" @click="tab = 'reports'">{{ $t('admin.tabReports') }}</button>
          <button :class="['tab-btn', { active: tab === 'settings' }]" @click="tab = 'settings'">{{ $t('admin.tabSettings') }}</button>
        </nav>
      </div>
    </header>

    <main class="admin-main">
      <!-- ローディング -->
      <div v-if="loading" class="state-loading">
        <div class="spinner" />
        <p>{{ $t('common.loading') }}</p>
      </div>

      <template v-else>
        <!-- ━━ ダッシュボード ━━ -->
        <section v-if="tab === 'dashboard'">
          <div class="section-head">
            <h2 class="section-title">{{ $t('admin.dashTitle') }}</h2>
            <div class="filter-row">
              <select v-model="dashMonth" class="filter-input">
                <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>
          </div>

          <!-- サマリーカード -->
          <div class="dash-cards">
            <div class="dash-card accent">
              <div class="dash-card-label">{{ $t('admin.cardTotal') }}</div>
              <div class="dash-card-value">¥{{ dashTotal.toLocaleString() }}</div>
            </div>
            <div class="dash-card">
              <div class="dash-card-label">{{ $t('admin.cardReportCount') }}</div>
              <div class="dash-card-value">{{ dashReportCount }}<span class="dash-card-unit">{{ $t('admin.unitCount') }}</span></div>
            </div>
            <div class="dash-card">
              <div class="dash-card-label">{{ $t('admin.cardWorkerCount') }}</div>
              <div class="dash-card-value">{{ dashWorkerCount }}<span class="dash-card-unit">{{ $t('admin.unitPerson') }}</span></div>
            </div>
          </div>

          <!-- カテゴリ別内訳 -->
          <div class="table-wrap mt20" v-if="dashRows.length > 0">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('admin.colCategory') }}</th>
                  <th class="td-right">{{ $t('admin.colAmount') }}</th>
                  <th class="td-right">{{ $t('admin.colCount') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in dashCategoryRows" :key="row.category">
                  <td class="td-name">{{ row.category }}</td>
                  <td class="td-right td-amount">¥{{ row.amount.toLocaleString() }}</td>
                  <td class="td-right td-center">{{ row.count }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="tfoot-total">
                  <td>{{ $t('admin.rowTotal') }}</td>
                  <td class="td-right">¥{{ dashTotal.toLocaleString() }}</td>
                  <td class="td-right">{{ dashRows.length }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div v-else class="td-empty">{{ $t('admin.noExpenseData') }}</div>
        </section>

        <!-- ━━ 社員一覧 ━━ -->
        <section v-if="tab === 'users'">
          <div class="section-head">
            <h2 class="section-title">{{ $t('admin.usersTitle') }}</h2>
            <span class="badge">{{ $t('admin.usersBadge', { count: users.length }) }}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('admin.colName') }}</th>
                  <th>{{ $t('admin.colRole') }}</th>
                  <th>{{ $t('admin.colRegisteredDate') }}</th>
                  <th>{{ $t('admin.colLineId') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in users" :key="u.id">
                  <td class="td-name">{{ u.real_name }}</td>
                  <td>
                    <span :class="['role-tag', u.worker_role]">
                      {{ u.worker_role === 'factory' ? $t('admin.roleFactory') : $t('admin.roleSite') }}
                    </span>
                  </td>
                  <td class="td-date">{{ fmtDate(u.created_at) }}</td>
                  <td class="td-id">{{ u.line_user_id }}</td>
                </tr>
                <tr v-if="users.length === 0">
                  <td colspan="4" class="td-empty">{{ $t('admin.noUsers') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ━━ 日報ログ ━━ -->
        <section v-else-if="tab === 'reports'">
          <div class="section-head">
            <h2 class="section-title">{{ $t('admin.reportsTitle') }}</h2>
            <div class="filter-row">
              <input v-model="reportFilter" type="text" class="filter-input" :placeholder="$t('admin.reportsFilterPlaceholder')" />
              <span class="badge">{{ $t('admin.reportsBadge', { count: filteredReports.length }) }}</span>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('admin.colDate') }}</th>
                  <th>{{ $t('admin.colSender') }}</th>
                  <th>{{ $t('admin.colRole') }}</th>
                  <th>{{ $t('admin.colWorking') }}</th>
                  <th>{{ $t('admin.colSiteCount') }}</th>
                  <th>{{ $t('admin.colRegisteredAt') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filteredReports" :key="r.id">
                  <td class="td-date fw">{{ r.date }}</td>
                  <td class="td-name">{{ r.users?.real_name ?? '—' }}</td>
                  <td>
                    <span v-if="r.users" :class="['role-tag', r.users.worker_role]">
                      {{ r.users.worker_role === 'factory' ? $t('admin.roleFactory') : $t('admin.roleSite') }}
                    </span>
                  </td>
                  <td>
                    <span :class="['status-tag', r.is_working ? 'working' : 'off']">
                      {{ r.is_working ? $t('admin.statusWorking') : $t('admin.statusOff') }}
                    </span>
                  </td>
                  <td class="td-center">{{ r.is_working ? (r.sites as any[]).length : '—' }}</td>
                  <td class="td-date">{{ fmtDatetime(r.created_at) }}</td>
                </tr>
                <tr v-if="filteredReports.length === 0">
                  <td colspan="6" class="td-empty">{{ $t('admin.noReports') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ━━ 設定 ━━ -->
        <section v-else-if="tab === 'settings'">
          <div class="section-head">
            <h2 class="section-title">{{ $t('admin.settingsTitle') }}</h2>
          </div>
          <div class="settings-card">
            <h3 class="settings-group-title">{{ $t('admin.fuelRateTitle') }}</h3>
            <div class="settings-list">
              <div v-for="s in settings" :key="s.key" class="settings-row">
                <label class="settings-label">{{ s.label }}</label>
                <div class="settings-input-row">
                  <input
                    v-model.number="s.editValue"
                    type="number"
                    min="1"
                    class="settings-input"
                  />
                  <span class="settings-unit">{{ $t('admin.fuelRateUnit') }}</span>
                </div>
              </div>
            </div>
            <div class="settings-actions">
              <span v-if="settingsSaved" class="settings-saved">{{ $t('admin.settingsSaved') }}</span>
              <button class="btn-save" :disabled="settingsSaving" @click="saveSettings">
                {{ settingsSaving ? $t('common.saving') : $t('admin.saveButton') }}
              </button>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'

const { t } = useI18n()

type ReportRow = {
  id:         string
  user_id:    string
  date:       string
  is_working: boolean
  sites:      unknown[]
  note:       string | null
  created_at: string
  users:      Pick<User, 'real_name' | 'worker_role'> | null
}

type SettingRow = { key: string; value: string; label: string; editValue: number }

const tab           = ref<'dashboard' | 'users' | 'reports' | 'settings'>('dashboard')
const loading       = ref(true)
const users         = ref<User[]>([])
const reports       = ref<ReportRow[]>([])
const reportFilter  = ref('')
const settings      = ref<SettingRow[]>([])
const settingsSaving = ref(false)
const settingsSaved  = ref(false)

const filteredReports = computed(() => {
  if (!reportFilter.value.trim()) return reports.value
  const q = reportFilter.value.trim()
  return reports.value.filter(r => r.users?.real_name?.includes(q))
})

// ── ダッシュボード ──────────────────────────────────────────
// 過去6ヶ月の選択肢
const monthOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  const today = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = d.toISOString().substring(0, 7)
    opts.push({ value: ym, label: t('admin.monthLabel', { year: d.getFullYear(), month: d.getMonth() + 1 }) })
  }
  return opts
})
const dashMonth = ref(new Date().toISOString().substring(0, 7))

// 燃料単価（settings から取得）
const gasolineRate = computed(() => {
  const s = settings.value.find(s => s.key === 'gasoline_rate_per_km')
  return s ? Number(s.value) : 23
})
const dieselRate = computed(() => {
  const s = settings.value.find(s => s.key === 'diesel_rate_per_km')
  return s ? Number(s.value) : 20
})

type ExpRow = { category: string; amount: number; userId: string }

const dashRows = computed((): ExpRow[] => {
  const rows: ExpRow[] = []
  const ym = dashMonth.value

  for (const rep of reports.value) {
    if (!rep.is_working) continue
    if (!rep.date.startsWith(ym)) continue

    const userId = (rep as any).user_id ?? ''
    for (const site of (rep.sites as any[])) {
      const exp = site.expenses || {}
      for (const veh of (exp.vehicles || [])) {
        if (veh.distanceKm) rows.push({ category: t('admin.catGasoline'), amount: Math.round(veh.distanceKm * gasolineRate.value), userId })
        if (veh.dieselKm)   rows.push({ category: t('admin.catDiesel'),   amount: Math.round(veh.dieselKm   * dieselRate.value),   userId })
        if (veh.parkingYen) rows.push({ category: t('admin.catParking'),  amount: veh.parkingYen, userId })
        if (veh.highwayYen) rows.push({ category: t('admin.catHighway'),  amount: veh.highwayYen, userId })
      }
      for (const tr of (exp.trains || [])) {
        if (tr.yen) rows.push({ category: t('admin.catTrain'), amount: tr.yen, userId })
      }
      if (exp.hotelYen)         rows.push({ category: t('admin.catHotel'),     amount: exp.hotelYen,         userId })
      if (exp.leopalaceYen)     rows.push({ category: t('admin.catLeopalace'), amount: exp.leopalaceYen,    userId })
      for (const ot of (exp.others || [])) {
        if (ot.yen) rows.push({ category: t('admin.catOthers'), amount: ot.yen, userId })
      }
      if (exp.entertainmentYen) rows.push({ category: t('admin.catMisc'), amount: exp.entertainmentYen, userId })
    }
  }
  return rows
})

const dashTotal        = computed(() => dashRows.value.reduce((s, r) => s + r.amount, 0))
const dashReportCount  = computed(() => {
  const ym = dashMonth.value
  return reports.value.filter(r => r.is_working && r.date.startsWith(ym)).length
})
const dashWorkerCount  = computed(() => new Set(dashRows.value.map(r => r.userId)).size)

const dashCategoryRows = computed(() => {
  const map = new Map<string, { amount: number; count: number }>()
  for (const r of dashRows.value) {
    const cur = map.get(r.category) ?? { amount: 0, count: 0 }
    map.set(r.category, { amount: cur.amount + r.amount, count: cur.count + 1 })
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount)
})

onMounted(async () => {
  const supabase = useSupabase()
  const [usersRes, reportsRes, settingsRes] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: true }),
    supabase
      .from('daily_reports')
      .select('id, date, is_working, sites, note, created_at, user_id, users(real_name, worker_role)')
      .order('date', { ascending: false })
      .limit(500),
    supabase.from('settings').select('*').order('key'),
  ])

  if (usersRes.data)   users.value   = usersRes.data
  // users(...) は to-one 埋め込みで実行時は単一オブジェクトだが型推論は配列になるため unknown 経由
  if (reportsRes.data) reports.value = reportsRes.data as unknown as ReportRow[]
  if (settingsRes.data) {
    settings.value = settingsRes.data.map((s: any) => ({ ...s, editValue: Number(s.value) }))
  }
  loading.value = false
})

async function saveSettings() {
  settingsSaving.value = true
  settingsSaved.value  = false
  const supabase = useSupabase()
  for (const s of settings.value) {
    await supabase
      .from('settings')
      .update({ value: String(s.editValue), updated_at: new Date().toISOString() })
      .eq('key', s.key)
    s.value = String(s.editValue)
  }
  settingsSaving.value = false
  settingsSaved.value  = true
  setTimeout(() => { settingsSaved.value = false }, 3000)
}

function fmtDate(s: string) {
  return s.substring(0, 10)
}
function fmtDatetime(s: string) {
  return s.substring(0, 16).replace('T', ' ')
}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --accent: #06C755;
  --border: #E5E7EB;
  --text:   #111;
  --text2:  #6B7280;
  --bg:     #F9FAFB;
  --surface:#fff;
  --font:   'Noto Sans JP', -apple-system, sans-serif;
}
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; }
</style>

<style scoped>
/* ── ヘッダー ── */
.admin-header {
  background: #fff;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 3px rgba(0,0,0,.06);
}
.admin-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand { display: flex; align-items: baseline; gap: 8px; }
.brand-name { font-size: 16px; font-weight: 900; letter-spacing: 5px; color: var(--accent); }
.brand-div  { color: var(--border); }
.brand-sub  { font-size: 12px; color: var(--text2); letter-spacing: 2px; }

.header-tabs { display: flex; gap: 4px; }
.tab-btn {
  padding: 7px 20px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: transparent;
  font-size: 13px;
  font-family: var(--font);
  color: var(--text2);
  cursor: pointer;
  transition: background .15s, color .15s;
}
.tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; }

/* ── メイン ── */
.admin-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 24px 60px;
}

/* ── ローディング ── */
.state-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 80px 0;
  color: var(--text2);
}
.spinner {
  width: 36px; height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── セクション ── */
.section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.section-title { font-size: 18px; font-weight: 700; }
.badge {
  background: #f3f4f6;
  color: var(--text2);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 20px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.filter-input {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--font);
  outline: none;
  width: 180px;
}
.filter-input:focus { border-color: var(--accent); }

/* ── テーブル ── */
.table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--border); }
.data-table { width: 100%; border-collapse: collapse; background: #fff; }
.data-table th {
  padding: 11px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  color: var(--text2);
  background: #f9fafb;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #fafafa; }

.td-name  { font-weight: 600; }
.td-date  { color: var(--text2); font-size: 12px; white-space: nowrap; }
.td-id    { color: var(--text2); font-size: 11px; font-family: monospace; }
.td-center{ text-align: center; }
.td-empty { text-align: center; color: var(--text2); padding: 40px !important; }
.fw       { font-weight: 700; color: var(--text); font-size: 14px !important; }

/* ── タグ ── */
.role-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.role-tag.factory { background: #eff6ff; color: #2563eb; }
.role-tag.site    { background: #f0fdf4; color: #16a34a; }

.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.status-tag.working { background: #f0fdf4; color: #16a34a; }
.status-tag.off     { background: #f9fafb; color: #9ca3af; }

/* ── ダッシュボード ── */
.dash-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 8px;
}
.dash-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
}
.dash-card.accent { border-color: var(--accent); background: #f0fdf4; }
.dash-card-label { font-size: 12px; color: var(--text2); margin-bottom: 8px; }
.dash-card-value { font-size: 28px; font-weight: 900; color: var(--text); }
.dash-card.accent .dash-card-value { color: #16a34a; }
.dash-card-unit { font-size: 14px; font-weight: 400; margin-left: 4px; }
.mt20 { margin-top: 20px; }
.td-right  { text-align: right !important; }
.td-amount { font-weight: 700; }
.tfoot-total td { font-weight: 700; border-top: 2px solid var(--border); padding: 12px 16px; background: #f9fafb; }

/* ── 設定 ── */
.settings-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  max-width: 480px;
}
.settings-group-title { font-size: 13px; font-weight: 700; color: var(--text2); margin-bottom: 16px; }
.settings-list { display: flex; flex-direction: column; gap: 14px; }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.settings-label { font-size: 14px; font-weight: 600; }
.settings-input-row { display: flex; align-items: center; gap: 8px; }
.settings-input {
  width: 90px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 15px;
  font-family: var(--font);
  text-align: right;
  outline: none;
}
.settings-input:focus { border-color: var(--accent); }
.settings-unit { font-size: 13px; color: var(--text2); white-space: nowrap; }
.settings-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.settings-saved { font-size: 13px; color: #16a34a; font-weight: 600; }
.btn-save {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 24px;
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
}
.btn-save:disabled { opacity: .5; cursor: not-allowed; }
</style>
