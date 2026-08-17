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

    <!-- ★出勤打刻の抜けに気づくためのパネル（2026-08-10）。
         朝の出勤打刻を必須運用にするが、システムでブロックはしない方針
         （逐語:「そこの制限は、そこまで厳しくできない」）ので、ここで見えるようにするだけ。 -->
    <div class="missing-panel" data-testid="missing-checkin-panel">
      <div class="mp-head">
        <span class="material-symbols-rounded mp-icon">event_busy</span>
        <span class="mp-title">出勤打刻なし</span>
        <input v-model="missingDate" type="date" class="filter-input" data-testid="missing-date" />
      </div>
      <div v-if="missingLoading" class="mp-body">確認中…</div>
      <div v-else-if="missingError" class="mp-body mp-err" data-testid="missing-error">
        確認できませんでした（0件ではありません）。再読み込みしてください。
      </div>
      <div v-else-if="!missingWorkers.length" class="mp-body mp-ok" data-testid="missing-none">
        この日の出勤打刻は全員そろっています
      </div>
      <div v-else class="mp-body">
        <span class="mp-count" data-testid="missing-count">{{ missingWorkers.length }}名</span>
        <span class="mp-names">{{ missingWorkers.join(' / ') }}</span>
        <p class="mp-note">※ 日報で「稼働なし（休み・有給）」を出している人は除いています。まだ日報が無い人は含まれます。</p>
      </div>
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
              <!-- ★その場で押した打刻か、あとから思い出して入れた分かを区別する。
                   混ぜると勤怠の証跡として使えない（後付けは現場ルールの同意も取っていない）。 -->
              <span v-if="log.backdated" class="backdated-badge" data-testid="log-backdated">後から入力</span>
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
import { ref, watch, onMounted } from 'vue'
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
  backdated: boolean | null
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

// ── 日付(YYYY-MM-DD) → その日のローカル時刻での開始/終了を UTC の ISO で返す ──
//  ★'2026-09-24T00:00:00' のようなタイムゾーン無しの文字列をそのまま渡すと、
//   Postgres は UTC として解釈する。JST の朝6:02 の打刻は UTC では前日21:02 なので、
//   「その日」の範囲から落ちて存在しないことになる＝早朝出勤がまるごと消える。
//   （2026-08-10 に E2E で検知。早朝搬入は実際にある運用。逐語:「朝6時からやってくださいみたいなこと言う」）
//   Date に日付＋時刻だけ渡すとローカル時刻として解釈されるので、それを ISO(UTC) に直して渡す。
const dayStartIso = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const dayEndIso   = (d: string) => new Date(`${d}T23:59:59.999`).toISOString()

async function loadMasters() {
  const accountId = await getAccountId()
  const [{ data: siteData }, { data: workerData }] = await Promise.all([
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
    supabase.from('workers').select('id, name, name_kana').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
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
      backdated,
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
  if (filterFrom.value)     query = query.gte('checked_at', dayStartIso(filterFrom.value))
  if (filterTo.value)       query = query.lte('checked_at', dayEndIso(filterTo.value))

  const { data } = await query
  logs.value    = (data ?? []) as unknown as Log[]
  loading.value = false
}

// ── 出勤打刻なしの作業員（AC6）──
//  ★「打刻が無い」は行が存在しないことなので、ログ一覧を眺めても絶対に気づけない。
//   だから在籍者との差分をこちらから出す。
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const missingDate    = ref(todayLocal())
const missingWorkers = ref<string[]>([])
const missingLoading = ref(true)
const missingError   = ref(false)

async function loadMissing() {
  missingLoading.value = true
  missingError.value = false
  try {
    const accountId = await getAccountId()
    const from = dayStartIso(missingDate.value)
    const to   = dayEndIso(missingDate.value)

    const { data: actives } = await supabase.from('workers')
      .select('id, name').eq('account_id', accountId).eq('active', true)
    const list = (actives ?? []) as Worker[]
    if (!list.length) { missingWorkers.value = []; return }
    const ids = list.map((w) => w.id)

    const [{ data: punched }, { data: offUsers }] = await Promise.all([
      supabase.from('attendance_logs').select('worker_id')
        .eq('type', 'checkin').gte('checked_at', from).lte('checked_at', to).in('worker_id', ids),
      // 休み/有給を出している人は「打刻忘れ」ではない。毎日全員が並ぶと誰も見なくなるので除く。
      supabase.from('daily_reports').select('user_id, users(worker_id)')
        .eq('account_id', accountId).eq('date', missingDate.value).eq('is_working', false),
    ])
    const punchedSet = new Set((punched ?? []).map((r: any) => r.worker_id))
    const offSet     = new Set((offUsers ?? []).map((r: any) => r.users?.worker_id).filter(Boolean))

    missingWorkers.value = list
      .filter((w) => !punchedSet.has(w.id) && !offSet.has(w.id))
      .map((w) => w.name)
      .sort((a, b) => a.localeCompare(b, 'ja'))
  } catch {
    // ★取れなかった時に「全員そろっています」と出すのが一番まずい（安心して見逃される）。
    //  0件と「測れなかった」を混同しない。
    missingWorkers.value = []
    missingError.value = true
  } finally {
    missingLoading.value = false
  }
}
watch(missingDate, () => { loadMissing() })

onMounted(async () => {
  await loadMasters()
  await Promise.all([load(), loadMissing()])
})
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title  { font-size: 22px; font-weight: 700; }

.backdated-badge {
  display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #92400e; background: #fef3c7;
}

/* 出勤打刻なしパネル */
.missing-panel { border: 1px solid #e5e7eb; border-left: 3px solid #f59e0b; border-radius: 6px; background: #fffbeb; padding: 10px 14px; margin-bottom: 16px; }
.mp-head { display: flex; align-items: center; gap: 8px; }
.mp-icon { font-size: 18px; color: #b45309; }
.mp-title { font-size: 13px; font-weight: 700; color: #92400e; }
.mp-body { margin-top: 6px; font-size: 13px; color: #1f2937; }
.mp-ok { color: #15803d; }
.mp-err { color: #b91c1c; font-weight: 700; }
.mp-count { font-weight: 700; margin-right: 8px; font-variant-numeric: tabular-nums; }
.mp-names { color: #374151; }
.mp-note { font-size: 11px; color: #92400e; margin-top: 4px; }

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
