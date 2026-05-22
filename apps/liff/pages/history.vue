<template>
  <div class="app">
    <AppNav subtitle="日報履歴" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="main">
      <!-- ローディング -->
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中...</p>
      </div>

      <!-- 空 -->
      <div v-else-if="reports.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <p class="empty-text">まだ日報がありません</p>
        <NuxtLink to="/report" class="btn-primary">日報を入力する</NuxtLink>
      </div>

      <!-- 一覧 -->
      <div v-else class="report-list">
        <template v-for="(group, ym) in grouped" :key="ym">
          <div class="month-label">{{ ym }}</div>
          <div
            v-for="rep in group"
            :key="rep.date"
            class="report-card"
          >
            <div class="report-card-top">
              <div class="report-date">{{ formatDate(rep.date) }}</div>
              <span :class="['status-badge', rep.leave_type === 'paid_leave' ? 'badge-paid-leave' : rep.is_working ? 'badge-working' : 'badge-off']">
                {{ rep.leave_type === 'paid_leave' ? '有給' : rep.is_working ? '稼働' : '休み' }}
              </span>
            </div>

            <div v-if="rep.is_working && siteNames(rep.sites).length" class="site-chips">
              <span v-for="name in siteNames(rep.sites)" :key="name" class="site-chip">{{ name }}</span>
            </div>

            <p v-if="rep.note" class="report-note">{{ rep.note }}</p>

            <div class="report-card-footer">
              <span class="updated-at">更新: {{ formatUpdatedAt(rep.updated_at) }}</span>
              <NuxtLink :to="`/report?edit=${rep.date}`" class="btn-edit">編集する →</NuxtLink>
            </div>
          </div>
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { User } from '~/types'

const liff    = useLiff()
const expense = useExpense()
const proxy   = useProxyMode()

const loading     = ref(true)
const reports     = ref<any[]>([])
const selfUser    = ref<User | null>(null)

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
}

onMounted(async () => {
  await liff.init()
  const uid = liff.profile.value?.userId
  if (uid) {
    selfUser.value = await expense.getUser(uid)
    if (!selfUser.value) { await navigateTo('/register'); return }
    await loadReports()
  }
  loading.value = false
})

watch(() => proxy.proxyTarget.value, async () => {
  if (!selfUser.value) return
  loading.value = true
  await loadReports()
  loading.value = false
})

// 月ごとにグループ化
const grouped = computed(() => {
  const map: Record<string, any[]> = {}
  for (const rep of reports.value) {
    const [year, month] = rep.date.split('-')
    const key = `${year}年${parseInt(month, 10)}月`
    if (!map[key]) map[key] = []
    map[key].push(rep)
  }
  return map
})

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`
}

function formatUpdatedAt(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function siteNames(sites: any[]): string[] {
  if (!sites) return []
  return sites.map(s =>
    s.siteName === '__other__' ? (s.customSiteName || '新規現場') : (s.siteName || '')
  ).filter(Boolean)
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
</style>
