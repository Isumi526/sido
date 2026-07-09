<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">出退勤ログ</h1>
    </div>

    <!-- 絞り込み -->
    <div class="filter-bar">
      <select v-model="filterSiteId" class="filter-select">
        <option value="">すべての現場</option>
        <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>

      <select v-model="filterWorkerId" class="filter-select">
        <option value="">すべての作業員</option>
        <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>

      <select v-model="filterType" class="filter-select">
        <option value="">出勤・退勤</option>
        <option value="checkin">出勤のみ</option>
        <option value="checkout">退勤のみ</option>
      </select>

      <input v-model="filterFrom" type="date" class="filter-input" />
      <span class="filter-sep">〜</span>
      <input v-model="filterTo" type="date" class="filter-input" />

      <button class="btn-search" @click="load">検索</button>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="logs.length === 0" class="empty">該当するログがありません</div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>日時</th>
            <th>区分</th>
            <th>現場</th>
            <th>作業員</th>
            <th>代理者</th>
            <th>確認ルール</th>
            <th>位置</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="date">{{ fmtDateTime(log.checked_at) }}</td>
            <td>
              <span class="type-badge" :class="log.type">
                {{ log.type === 'checkin' ? '出勤' : '退勤' }}
              </span>
            </td>
            <td>{{ log.sites?.name ?? '—' }}</td>
            <td>{{ log.workers?.name ?? '—' }}</td>
            <td class="proxy">{{ log.proxy?.name ?? '—' }}</td>
            <td class="rules">
              <button
                v-if="log.agreed_rule_texts?.length"
                class="rules-link"
                @click="openRules(log)"
              >{{ log.agreed_rule_texts.length }}件</button>
              <span v-else class="no-location">—</span>
            </td>
            <td class="location">
              <a
                v-if="log.location_lat && log.location_lng"
                :href="`https://maps.google.com/?q=${log.location_lat},${log.location_lng}`"
                target="_blank"
                rel="noopener"
                class="location-link"
              >地図</a>
              <span v-else class="no-location">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="logs.length >= LIMIT" class="limit-note">
        最新 {{ LIMIT }} 件を表示しています
      </div>
    </div>

    <!-- 確認ルール詳細モーダル -->
    <div v-if="rulesModal" class="modal-overlay" @click.self="rulesModal = null">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">確認したルール</div>
            <div class="modal-sub">
              {{ rulesModal.sites?.name ?? '—' }} ／ {{ rulesModal.workers?.name ?? '—' }}
              ／ {{ rulesModal.type === 'checkin' ? '出勤' : '退勤' }}
              ／ {{ fmtDateTime(rulesModal.checked_at) }}
            </div>
          </div>
          <button class="modal-close" @click="rulesModal = null">✕</button>
        </div>
        <ol class="modal-rules">
          <li v-for="(text, i) in rulesModal.agreed_rule_texts ?? []" :key="i">{{ text }}</li>
        </ol>
        <p class="modal-note">※ 同意時点の文面を保存しています（後からルールを編集しても変わりません）</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const LIMIT = 200

type Log = {
  id: string
  checked_at: string
  type: 'checkin' | 'checkout'
  location_lat: number | null
  location_lng: number | null
  agreed_rule_texts: string[] | null
  sites:   { name: string } | null
  workers: { name: string } | null
  proxy:   { name: string } | null
}

type Site   = { id: string; name: string }
type Worker = { id: string; name: string }

const logs    = ref<Log[]>([])
const sites   = ref<Site[]>([])
const workers = ref<Worker[]>([])
const loading = ref(true)

const filterSiteId   = ref('')
const filterWorkerId = ref('')
const filterType     = ref('')
const filterFrom     = ref('')
const filterTo       = ref('')

const rulesModal = ref<Log | null>(null)
function openRules(log: Log) { rulesModal.value = log }

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function loadMasters() {
  const accountId = await getAccountId()
  const [{ data: siteData }, { data: workerData }] = await Promise.all([
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
    supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
  ])
  sites.value   = (siteData   ?? []) as Site[]
  workers.value = (workerData ?? []) as Worker[]
}

async function load() {
  loading.value = true
  // マルチテナント: attendance_logs に account_id 列が無いため、自テナントの作業員集合で隔離する
  const accountId = await getAccountId()
  const { data: accWorkers } = await supabase.from('workers').select('id').eq('account_id', accountId)
  const accWorkerIds = (accWorkers ?? []).map((w: any) => w.id)
  if (accWorkerIds.length === 0) { logs.value = []; loading.value = false; return }

  let query = supabase
    .from('attendance_logs')
    .select(`
      id,
      checked_at,
      type,
      location_lat,
      location_lng,
      agreed_rule_texts,
      sites(name),
      workers!attendance_logs_worker_id_fkey(name),
      proxy:workers!attendance_logs_proxy_worker_id_fkey(name)
    `)
    .in('worker_id', accWorkerIds)
    .order('checked_at', { ascending: false })
    .limit(LIMIT)

  if (filterSiteId.value)   query = query.eq('site_id', filterSiteId.value)
  if (filterWorkerId.value) query = query.eq('worker_id', filterWorkerId.value)
  if (filterType.value)     query = query.eq('type', filterType.value)
  if (filterFrom.value)     query = query.gte('checked_at', filterFrom.value)
  if (filterTo.value)       query = query.lte('checked_at', filterTo.value + 'T23:59:59')

  const { data } = await query
  logs.value    = (data ?? []) as unknown as Log[]
  loading.value = false
}

onMounted(async () => {
  await loadMasters()
  await load()
})
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title  { font-size: 22px; font-weight: 700; }

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.filter-select {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
  outline: none;
}
.filter-input {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
}
.filter-sep { font-size: 13px; color: #888; }
.btn-search {
  background: #06C755;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.empty { color: #888; padding: 40px 0; }

.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 13px; }

.date { white-space: nowrap; color: #555; }

.type-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.type-badge.checkin  { background: #e0f2fe; color: #0369a1; }
.type-badge.checkout { background: #fef3c7; color: #92400e; }

.proxy { color: #888; font-size: 12px; }
.no-location { color: #ccc; }
.location-link { color: #06C755; font-size: 12px; }

.limit-note {
  padding: 10px 16px;
  font-size: 12px;
  color: #9ca3af;
  border-top: 1px solid #f0f0f0;
  text-align: center;
}

.rules-link {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
  white-space: nowrap;
}
.rules-link:hover { background: #f3f4f6; }

/* モーダル */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; z-index: 50;
}
.modal {
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 480px;
  max-height: 80vh; overflow-y: auto;
  padding: 24px;
  box-shadow: 0 10px 40px rgba(0,0,0,.2);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; margin-bottom: 16px;
}
.modal-title { font-size: 16px; font-weight: 700; }
.modal-sub   { font-size: 12px; color: #888; margin-top: 4px; line-height: 1.5; }
.modal-close {
  background: none; border: none; font-size: 18px; color: #9ca3af;
  cursor: pointer; line-height: 1; padding: 4px;
}
.modal-rules {
  margin: 0; padding-left: 20px;
  display: flex; flex-direction: column; gap: 10px;
}
.modal-rules li { font-size: 14px; line-height: 1.6; color: #222; }
.modal-note {
  margin-top: 16px; font-size: 11px; color: #9ca3af; line-height: 1.5;
}
</style>
