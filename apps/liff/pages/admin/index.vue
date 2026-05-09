<template>
  <div class="admin-app">
    <!-- ヘッダー -->
    <header class="admin-header">
      <div class="admin-header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-div">|</span>
          <span class="brand-sub">管理画面</span>
        </div>
        <nav class="header-tabs">
          <button :class="['tab-btn', { active: tab === 'users' }]" @click="tab = 'users'">社員一覧</button>
          <button :class="['tab-btn', { active: tab === 'reports' }]" @click="tab = 'reports'">日報ログ</button>
        </nav>
      </div>
    </header>

    <main class="admin-main">
      <!-- ローディング -->
      <div v-if="loading" class="state-loading">
        <div class="spinner" />
        <p>読み込み中...</p>
      </div>

      <template v-else>
        <!-- ━━ 社員一覧 ━━ -->
        <section v-if="tab === 'users'">
          <div class="section-head">
            <h2 class="section-title">社員一覧</h2>
            <span class="badge">{{ users.length }}名</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>氏名</th>
                  <th>所属</th>
                  <th>登録日</th>
                  <th>LINE ID</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in users" :key="u.id">
                  <td class="td-name">{{ u.real_name }}</td>
                  <td>
                    <span :class="['role-tag', u.worker_role]">
                      {{ u.worker_role === 'factory' ? '工場/事務所' : '現場' }}
                    </span>
                  </td>
                  <td class="td-date">{{ fmtDate(u.created_at) }}</td>
                  <td class="td-id">{{ u.line_user_id }}</td>
                </tr>
                <tr v-if="users.length === 0">
                  <td colspan="4" class="td-empty">社員が登録されていません</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ━━ 日報ログ ━━ -->
        <section v-else-if="tab === 'reports'">
          <div class="section-head">
            <h2 class="section-title">日報ログ</h2>
            <div class="filter-row">
              <input v-model="reportFilter" type="text" class="filter-input" placeholder="名前で絞り込み" />
              <span class="badge">{{ filteredReports.length }}件</span>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>送信者</th>
                  <th>所属</th>
                  <th>稼働</th>
                  <th>現場数</th>
                  <th>登録日時</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filteredReports" :key="r.id">
                  <td class="td-date fw">{{ r.date }}</td>
                  <td class="td-name">{{ r.users?.real_name ?? '—' }}</td>
                  <td>
                    <span v-if="r.users" :class="['role-tag', r.users.worker_role]">
                      {{ r.users.worker_role === 'factory' ? '工場/事務所' : '現場' }}
                    </span>
                  </td>
                  <td>
                    <span :class="['status-tag', r.is_working ? 'working' : 'off']">
                      {{ r.is_working ? '稼働' : '休み' }}
                    </span>
                  </td>
                  <td class="td-center">{{ r.is_working ? (r.sites as any[]).length : '—' }}</td>
                  <td class="td-date">{{ fmtDatetime(r.created_at) }}</td>
                </tr>
                <tr v-if="filteredReports.length === 0">
                  <td colspan="6" class="td-empty">日報データがありません</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { User } from '~/types'

type ReportRow = {
  id:         string
  date:       string
  is_working: boolean
  sites:      unknown[]
  note:       string | null
  created_at: string
  users:      Pick<User, 'real_name' | 'worker_role'> | null
}

const tab           = ref<'users' | 'reports'>('users')
const loading       = ref(true)
const users         = ref<User[]>([])
const reports       = ref<ReportRow[]>([])
const reportFilter  = ref('')

const filteredReports = computed(() => {
  if (!reportFilter.value.trim()) return reports.value
  const q = reportFilter.value.trim()
  return reports.value.filter(r => r.users?.real_name?.includes(q))
})

onMounted(async () => {
  const supabase = useSupabase()
  const [usersRes, reportsRes] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: true }),
    supabase
      .from('daily_reports')
      .select('id, date, is_working, sites, note, created_at, users(real_name, worker_role)')
      .order('date', { ascending: false })
      .limit(200),
  ])

  if (usersRes.data)   users.value   = usersRes.data
  if (reportsRes.data) reports.value = reportsRes.data as ReportRow[]
  loading.value = false
})

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
</style>
