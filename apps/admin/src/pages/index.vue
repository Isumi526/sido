<template>
  <div>
    <h1 class="page-title">ダッシュボード</h1>

    <!-- 開発の更新履歴 -->
    <div v-if="updates.length" class="updates-box">
      <div class="updates-head">お知らせ・更新履歴</div>
      <ul class="updates-list">
        <li v-for="u in updates" :key="u.id" class="update-item">
          <span class="update-date">{{ fmtUpdDate(u.created_at) }}</span>
          <span class="update-title">{{ u.title }}</span>
          <component
            v-if="u.link"
            :is="u.link.startsWith('/') ? 'RouterLink' : 'a'"
            v-bind="u.link.startsWith('/') ? { to: u.link } : { href: u.link, target: '_blank', rel: 'noopener' }"
            class="update-link"
          >開く →</component>
          <button class="update-ok" :disabled="archivingId === u.id" @click="archiveUpdate(u.id)">OK</button>
        </li>
      </ul>
    </div>

    <!-- 月次集計 -->
    <div class="section-head">
      <h2 class="section-title">月次集計</h2>
      <select v-model="selectedMonth" class="month-select">
        <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading-text">集計中...</div>
    <template v-else>
      <!-- 合計カード -->
      <div class="cards mt16">
        <div class="stat-card accent">
          <div class="stat-value">¥{{ grandTotal.toLocaleString() }}</div>
          <div class="stat-label">月次合計</div>
        </div>
      </div>

      <!-- 内訳テーブル -->
      <div class="table-wrap mt20" v-if="summaryRows.length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>カテゴリ</th>
              <th class="right">金額</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summaryRows" :key="row.label">
              <td>
                <span class="category-dot" :class="row.type" />
                {{ row.label }}
              </td>
              <td class="right bold">¥{{ row.amount.toLocaleString() }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td>合　計</td>
              <td class="right">¥{{ grandTotal.toLocaleString() }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-else class="empty-text">この月のデータがありません</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

// ── 開発の更新履歴（全社共通・archived=false を新しい順）──────────
interface DevUpdate { id: string; title: string; link: string | null; created_at: string }
const updates    = ref<DevUpdate[]>([])
const archivingId = ref<string | null>(null)

function fmtUpdDate(s: string): string {
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

async function loadUpdates() {
  const { data } = await supabase
    .from('dev_updates')
    .select('id, title, link, created_at')
    .eq('archived', false)
    .order('created_at', { ascending: false })
  updates.value = (data ?? []) as DevUpdate[]
}

async function archiveUpdate(id: string) {
  archivingId.value = id
  try {
    const { error } = await supabase.from('dev_updates').update({ archived: true }).eq('id', id)
    if (error) throw error
    updates.value = updates.value.filter(u => u.id !== id)
  } catch (e) {
    console.error('[updates] archive失敗:', e)
  } finally {
    archivingId.value = null
  }
}

// ── 月選択 ───────────────────────────────────────────────────
const monthOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  const today = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ value: ym, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
  }
  return opts
})
const selectedMonth = ref(monthOptions.value[0].value)

// ── 集計 ─────────────────────────────────────────────────────
const loading = ref(false)

// 単価マスタ
let G_YEN = 23, D_YEN = 20, GF_YEN = 8000, GS_YEN = 14000

// 集計結果
const laborTotal   = ref(0)   // 社員
const shoshaTotal  = ref(0)   // 商社
const gyoshaTotal  = ref(0)   // 業者
const expenseMap   = ref<Map<string, number>>(new Map())  // 経費カテゴリ別

function calcLaborCost(w: any, unitPrice: number) {
  if (!unitPrice) return 0
  const ph = unitPrice / 8
  return Math.round(
    (w.hoursNormal        || 0) * ph * 1.00 +
    (w.hoursOT            || 0) * ph * 1.25 +
    (w.hoursNight         || 0) * ph * 1.25 +
    (w.hoursOTNight       || 0) * ph * 1.50 +
    (w.hoursSunday        || 0) * ph * 1.35 +
    (w.hoursSundayOT      || 0) * ph * 1.60 +
    (w.hoursSundayNight   || 0) * ph * 1.60 +
    (w.hoursSundayOTNight || 0) * ph * 1.85
  )
}

function addExp(map: Map<string, number>, key: string, val: number) {
  if (!val) return
  map.set(key, (map.get(key) ?? 0) + val)
}

async function load() {
  loading.value = true
  const ym = selectedMonth.value
  const accountId = await getAccountId()

  // マスタ・設定を並列取得
  const [{ data: wm }, { data: sm }, { data: cfg }] = await Promise.all([
    supabase.from('workers').select('id, name, unit_price').eq('account_id', accountId),
    supabase.from('subcontractors').select('name, category, unit_price').eq('account_id', accountId),
    supabase.from('settings').select('key, value').eq('account_id', accountId),
  ])
  for (const row of (cfg ?? [])) {
    if (row.key === 'gasoline_rate_per_km')        G_YEN  = Number(row.value)
    if (row.key === 'diesel_rate_per_km')           D_YEN  = Number(row.value)
    if (row.key === 'garbage_factory_rate_per_m3')  GF_YEN = Number(row.value)
    if (row.key === 'garbage_site_rate_per_m3')     GS_YEN = Number(row.value)
  }
  const priceById   = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.unit_price]))
  const priceByName = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.unit_price]))
  const subMaster   = Object.fromEntries((sm ?? []).map((s: any) => [s.name, { category: s.category, unitPrice: s.unit_price ?? 0 }]))

  // 対象月の日報取得。月末は翌月1日の手前(.lt)で表す
  //（'${ym}-31' は6月/2月等で不正日付になり PostgREST が400を返すため）
  const [yy, mm] = ym.split('-').map(Number)
  const nextMonthFirst = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('sites')
    .eq('account_id', accountId)
    .eq('is_working', true)
    .gte('date', `${ym}-01`)
    .lt('date', nextMonthFirst)

  let labor = 0, shosha = 0, gyosha = 0
  const expMap = new Map<string, number>()

  for (const rep of (reports ?? [])) {
    for (const site of (rep.sites as any[])) {
      // 社員費
      for (const w of (site.workers ?? []).filter((w: any) => w.workerName)) {
        const up = priceById[w.workerId] ?? priceByName[w.workerName] ?? 0
        labor += calcLaborCost(w, up)
      }

      // 商社・業者費
      for (const s of (site.subcontractors ?? []).filter((s: any) => s.subcontractorName)) {
        const m = subMaster[s.subcontractorName] ?? { category: null, unitPrice: 0 }
        const cost = (s.count || 0) * (m.unitPrice || 0)
        if (m.category === '商社') shosha += cost
        else gyosha += cost
      }

      // 経費
      const exp = site.expenses || {}
      for (const veh of (exp.vehicles || [])) {
        addExp(expMap, 'ガソリン代', Math.round((veh.distanceKm || 0) * G_YEN))
        addExp(expMap, '軽油代',    Math.round((veh.dieselKm   || 0) * D_YEN))
        addExp(expMap, '駐車代',    veh.parkingYen || 0)
        addExp(expMap, '高速代',    veh.highwayYen || 0)
      }
      for (const tr of (exp.trains || [])) addExp(expMap, '電車代', tr.yen || 0)
      addExp(expMap, '宿泊費',       (exp.hotelYen || 0) + (exp.leopalaceYen || 0))
      addExp(expMap, 'その他（資材等）', (exp.others || []).reduce((s: number, o: any) => s + (o.yen || 0), 0))
      addExp(expMap, 'その他雑経費',  exp.entertainmentYen || 0)
      addExp(expMap, 'ゴミ処分',
        Math.round((exp.garbageFactoryM3 || 0) * GF_YEN + (exp.garbageSiteM3 || 0) * GS_YEN))
    }
  }

  laborTotal.value  = labor
  shoshaTotal.value = shosha
  gyoshaTotal.value = gyosha
  expenseMap.value  = expMap
  loading.value = false
}

const grandTotal = computed(() => {
  const expTotal = [...expenseMap.value.values()].reduce((s, v) => s + v, 0)
  return laborTotal.value + shoshaTotal.value + gyoshaTotal.value + expTotal
})

type SummaryRow = { label: string; amount: number; type: 'labor' | 'shosha' | 'gyosha' | 'expense' }
const summaryRows = computed((): SummaryRow[] => {
  const rows: SummaryRow[] = []
  if (laborTotal.value)  rows.push({ label: '社員',   amount: laborTotal.value,  type: 'labor'  })
  if (shoshaTotal.value) rows.push({ label: '商社',   amount: shoshaTotal.value, type: 'shosha' })
  if (gyoshaTotal.value) rows.push({ label: '業者',   amount: gyoshaTotal.value, type: 'gyosha' })
  for (const [label, amount] of expenseMap.value) {
    if (amount > 0) rows.push({ label, amount, type: 'expense' })
  }
  return rows
})

onMounted(() => { load(); loadUpdates() })
watch(selectedMonth, load)
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }

/* 開発の更新履歴 */
.updates-box { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 24px; overflow: hidden; }
.updates-head { font-size: 13px; font-weight: 700; color: #555; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
.updates-list { list-style: none; margin: 0; padding: 0; }
.update-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #f4f4f4; font-size: 14px; }
.update-item:first-child { border-top: none; }
.update-date { color: #999; font-size: 12px; font-variant-numeric: tabular-nums; flex-shrink: 0; width: 40px; }
.update-title { flex: 1; color: #222; }
.update-link { color: #06C755; font-size: 13px; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
.update-link:hover { text-decoration: underline; }
.update-ok { flex-shrink: 0; background: #f0f0f0; border: none; border-radius: 6px; padding: 5px 14px; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; }
.update-ok:hover:not(:disabled) { background: #e4e4e4; }
.update-ok:disabled { opacity: .6; cursor: default; }

.cards { display: flex; gap: 16px; flex-wrap: wrap; }
.stat-card {
  background: #fff; border-radius: 12px; padding: 24px 32px;
  min-width: 150px; box-shadow: 0 1px 4px rgba(0,0,0,.06); border: 1px solid #eee;
}
.stat-card.accent { border-color: #06C755; background: #f0fdf4; }
.stat-value { font-size: 36px; font-weight: 900; color: #06C755; }
.stat-label { font-size: 13px; color: #888; margin-top: 4px; }

.section-head { display: flex; align-items: center; gap: 16px; margin-top: 36px; margin-bottom: 16px; }
.section-title { font-size: 18px; font-weight: 700; }
.month-select { padding: 7px 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; background: #fff; cursor: pointer; outline: none; }

.mt16 { margin-top: 16px; }
.mt20 { margin-top: 20px; }

.table-wrap { border-radius: 10px; border: 1px solid #e5e7eb; overflow: hidden; max-width: 480px; }
.data-table { width: 100%; border-collapse: collapse; background: #fff; }
.data-table th { padding: 11px 16px; text-align: left; font-size: 12px; font-weight: 700; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.data-table td { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #fafafa; }
.total-row td { font-weight: 700; border-top: 2px solid #e5e7eb; background: #f9fafb; }
.right { text-align: right; }
.bold  { font-weight: 700; }

.category-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.category-dot.labor   { background: #2563eb; }
.category-dot.shosha  { background: #9333ea; }
.category-dot.gyosha  { background: #ea580c; }
.category-dot.expense { background: #06C755; }

.loading-text { color: #888; padding: 32px 0; }
.empty-text   { color: #9ca3af; padding: 32px 0; font-size: 14px; }
</style>
