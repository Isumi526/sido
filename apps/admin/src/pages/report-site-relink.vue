<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場未設定の日報を紐付け</h1>
    </div>
    <p class="hint">
      作業員が「現場未設定」で記録した日報を、正しい現場へ紐付けます。
      紐付けると現場別集計・按分に正しく反映されます（直近{{ DAYS }}日分を表示）。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!rows.length" class="empty">現場未設定の日報はありません。</div>
    <template v-else>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>日付</th>
              <th>作業員</th>
              <th>メモ / 内容</th>
              <th>紐付け先の現場</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key">
              <td>{{ fmtDate(r.date) }}</td>
              <td class="name">{{ r.workers || '—' }}</td>
              <td class="memo">{{ r.memo || '—' }}</td>
              <td>
                <select v-model="r.pick" class="site-pick">
                  <option value="">現場を選択</option>
                  <option v-for="s in siteNames" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>
              <td class="actions-col">
                <button class="btn-link" :disabled="!r.pick || busy === r.key" @click="relink(r)">紐付け</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { refreshNavBadges } from '../lib/navBadges'

const DAYS = 90

type Row = {
  key: string
  reportId: string
  siteIndex: number
  date: string
  workers: string
  memo: string
  pick: string
}

const loading = ref(true)
const busy    = ref<string | null>(null)
const rows    = ref<Row[]>([])
const siteNames = ref<string[]>([])
const siteIdByName = ref<Record<string, string>>({})  // 紐付け時に site_id も刻むため

function fmtDate(d: string): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}（${y}）`
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().split('T')[0]
  const [{ data: reps }, { data: sites }] = await Promise.all([
    supabase.from('daily_reports')
      .select('id, date, sites')
      .eq('account_id', accountId).gte('date', since)
      .order('date', { ascending: false })
      .limit(15000), // 90日×全作業員で上限(既定1000)超による未紐付け検出漏れ防止（reports.vue等の1ヶ月5000の3倍相当）
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
  ])
  siteNames.value = (sites ?? []).map((s: any) => s.name)
  siteIdByName.value = Object.fromEntries((sites ?? []).map((s: any) => [s.name, s.id]))
  const out: Row[] = []
  for (const rep of (reps ?? []) as any[]) {
    const arr = Array.isArray(rep.sites) ? rep.sites : []
    arr.forEach((site: any, i: number) => {
      if (site?.siteName !== '__unset__') return
      const workers = (site.workers ?? []).map((w: any) => w.workerName).filter(Boolean).join('、')
      out.push({
        key: `${rep.id}#${i}`, reportId: rep.id, siteIndex: i, date: rep.date,
        workers, memo: (site.note ?? '').trim(), pick: '',
      })
    })
  }
  rows.value = out
  loading.value = false
}

async function relink(r: Row) {
  if (!r.pick || busy.value) return
  busy.value = r.key
  // 当該レポートの sites を取り直し、対象 index の siteName を確定して更新。
  const { data: cur, error: e1 } = await supabase
    .from('daily_reports').select('sites').eq('id', r.reportId).single()
  if (e1 || !cur) { busy.value = null; alert('取得に失敗しました'); return }
  const arr = Array.isArray((cur as any).sites) ? [...(cur as any).sites] : []
  if (!arr[r.siteIndex] || arr[r.siteIndex].siteName !== '__unset__') {
    busy.value = null; alert('対象の現場未設定エントリが見つかりません（再読込してください）'); await load(); return
  }
  arr[r.siteIndex] = { ...arr[r.siteIndex], siteName: r.pick, customSiteName: '', site_id: siteIdByName.value[r.pick] ?? null }
  const { error: e2 } = await supabase.from('daily_reports').update({ sites: arr }).eq('id', r.reportId)
  busy.value = null
  if (e2) { alert('紐付けに失敗しました: ' + e2.message); return }
  rows.value = rows.value.filter(x => x.key !== r.key)
  await refreshNavBadges()  // ナビバッジを即時更新（リロード不要）
}

onMounted(load)
</script>

<style scoped>
.hint { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.7; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.table-wrap {  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
.table th, .table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.table th { background: #f8fafc; color: #475569; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.name { font-weight: 700; color: #0f172a; }
.memo { max-width: 260px; white-space: pre-wrap; color: #475569; }
.site-pick { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; min-width: 160px; }
.actions-col { white-space: nowrap; }
.btn-link { font-size: 13px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
.btn-link:disabled { opacity: .5; cursor: default; }
</style>
