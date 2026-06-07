<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場別集計</h1>
      <div class="month-nav">
        <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
        <span class="month-label">{{ yearMonth }}</span>
        <button class="btn-nav" @click="shiftMonth(1)">›</button>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="siteNames.length === 0" class="empty">この月の日報がありません</div>

    <template v-else>
      <!-- 現場タブ（五十音順） -->
      <div class="tabs-wrap">
        <div class="tabs">
          <button v-for="name in siteNames" :key="name" class="tab"
            :class="{ active: activeSite === name }" @click="activeSite = name">
            {{ name }}
          </button>
        </div>
      </div>

      <!-- 一覧テーブル -->
      <div v-if="activeSite" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>日付</th>
              <th>作業員</th>
              <th class="num">商社</th>
              <th class="num">業者</th>
              <th class="num">社員</th>
              <th class="num">駐車場</th>
              <th class="num">燃料</th>
              <th class="num">高速</th>
              <th class="num">宿泊</th>
              <th class="num">接待費</th>
              <th class="num">ゴミ</th>
              <th class="num">交通費</th>
              <th class="num">ホーム</th>
              <th class="num">合計</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in siteMap[activeSite]" :key="row._key" class="data-row" :class="{ 'invoice-row': row._isInvoice }" @click="!row._isInvoice && (selected = row)">
              <td class="date-cell">
                {{ row.date.slice(5).replace('-', '/') }}
                <span v-if="row._isSunday" class="sun">日</span>
              </td>
              <td class="worker-cell">
                <span v-if="row.workerSummary">{{ row.workerSummary }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="num">{{ row.shoshaCost ? yen(row.shoshaCost) : '—' }}</td>
              <td class="num">{{ row.gyoshaCost ? yen(row.gyoshaCost) : '—' }}</td>
              <td class="num">{{ row.laborCost     ? yen(row.laborCost)     : '—' }}</td>
              <td class="num">{{ row.parkingYen    ? yen(row.parkingYen)    : '—' }}</td>
              <td class="num">{{ row.fuelCost      ? yen(row.fuelCost)      : '—' }}</td>
              <td class="num">{{ row.highwayCost   ? yen(row.highwayCost)   : '—' }}</td>
              <td class="num">{{ row.hotelCost     ? yen(row.hotelCost)     : '—' }}</td>
              <td class="num">{{ row.entertainCost ? yen(row.entertainCost) : '—' }}</td>
              <td class="num">{{ row.garbageCost ? yen(row.garbageCost) : '—' }}</td>
              <td class="num">{{ row.trainCost     ? yen(row.trainCost)     : '—' }}</td>
              <td class="num">{{ row.homeCost      ? yen(row.homeCost)      : '—' }}</td>
              <td class="num total-col">{{ yen(row.total) }}</td>
              <td class="hint">{{ row._isInvoice ? '請求' : '詳細 →' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="2">月計</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'shoshaCost'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'gyoshaCost'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'laborCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'parkingYen'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'fuelCost'))      }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'highwayCost'))   }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'hotelCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'entertainCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'garbageCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'trainCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'homeCost'))      }}</td>
              <td class="num total-col">{{ yen(sumF(siteMap[activeSite], 'total')) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </template>

    <!-- 詳細モーダル -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head">
          <div>
            <div class="modal-title">{{ selected.siteName }}</div>
            <div class="modal-date">{{ selected.date }}</div>
          </div>
          <button class="btn-close" @click="selected = null">✕</button>
        </div>

        <!-- 稼働 -->
        <div class="modal-section" v-if="selected.workers.length">
          <div class="section-label">稼働（社員 {{ yen(selected.laborCost) }}）</div>
          <table class="inner-table">
            <thead>
              <tr>
                <th>作業員</th><th>区分</th>
                <th class="num">通常</th><th class="num">残業</th><th class="num">深夜</th>
                <th class="num">単価</th><th class="num">人件費</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(w, i) in selected.workers" :key="i">
                <td>{{ w.workerName }}</td>
                <td><span class="role-badge" :class="w.role">{{ w.role === 'factory' ? '工場' : '現場' }}</span></td>
                <td class="num">{{ fmt(w.hoursNormal) }}</td>
                <td class="num">{{ fmt(w.hoursOT) }}</td>
                <td class="num">{{ fmt(w.hoursNight) }}</td>
                <td class="num">{{ w.unitPrice ? yen(w.unitPrice) : '—' }}</td>
                <td class="num">{{ w.laborCost ? yen(w.laborCost) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 商社 -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => s.category === '商社').length">
          <div class="section-label">商社（{{ yen(selected.shoshaCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => s.category === '商社')" :key="i">
                <td>{{ s.name }}</td>
                <td class="num">{{ s.count }}名</td>
                <td class="num">{{ s.unitPrice ? yen(s.unitPrice) : '—' }}</td>
                <td class="num">{{ s.unitPrice ? yen(s.count * s.unitPrice) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 業者 -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => s.category === '業者').length">
          <div class="section-label">業者（{{ yen(selected.gyoshaCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => s.category === '業者')" :key="i">
                <td>{{ s.name }}</td>
                <td class="num">{{ s.count }}名</td>
                <td class="num">{{ s.unitPrice ? yen(s.unitPrice) : '—' }}</td>
                <td class="num">{{ s.unitPrice ? yen(s.count * s.unitPrice) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- カテゴリ未設定の下請け -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => !s.category).length">
          <div class="section-label">下請け（区分未設定）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => !s.category)" :key="i">
                <td>{{ s.name }}</td><td class="num">{{ s.count }}名</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 車両経費 -->
        <div class="modal-section" v-if="selected.vehicleItems.length">
          <div class="section-label">車両経費</div>
          <table class="inner-table">
            <thead><tr><th>車両</th><th class="num">ガソリン</th><th class="num">軽油</th><th class="num">駐車場</th><th class="num">高速</th></tr></thead>
            <tbody>
              <tr v-for="(v, i) in selected.vehicleItems" :key="i">
                <td>{{ v.vehicleName }}</td>
                <td class="num">{{ v.distanceKm ? v.distanceKm + 'km' : '—' }}</td>
                <td class="num">{{ v.dieselKm   ? v.dieselKm   + 'km' : '—' }}</td>
                <td class="num">{{ v.parkingYen ? yen(v.parkingYen) : '—' }}</td>
                <td class="num">{{ v.highwayYen ? yen(v.highwayYen) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 宿泊 -->
        <div class="modal-section" v-if="selected.hotelCost">
          <div class="section-label">宿泊（{{ yen(selected.hotelCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>種別</th><th>名称</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-if="selected._exp?.hotelYen">
                <td>ホテル</td>
                <td>{{ selected._exp.hotelName || '—' }}</td>
                <td class="num">{{ yen(selected._exp.hotelYen) }}</td>
              </tr>
              <tr v-if="selected._exp?.leopalaceYen">
                <td>レオパレス</td>
                <td>{{ selected._exp.leopalaceName || '—' }}</td>
                <td class="num">{{ yen(selected._exp.leopalaceYen) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 接待費 -->
        <div class="modal-section" v-if="selected.entertainCost">
          <div class="section-label">接待費</div>
          <div class="simple-row">
            <span>{{ selected._exp?.entertainmentLabel || '接待費' }}</span>
            <span class="num-text">{{ yen(selected.entertainCost) }}</span>
          </div>
        </div>

        <!-- ゴミ -->
        <div class="modal-section" v-if="selected.garbageCost">
          <div class="section-label">ゴミ処分（{{ yen(selected.garbageCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>区分</th><th class="num">m³</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-if="selected.garbageFactoryM3">
                <td>工場ゴミ</td>
                <td class="num">{{ selected.garbageFactoryM3 }}m³</td>
                <td class="num">¥{{ GF_YEN.toLocaleString() }}/m³</td>
                <td class="num">{{ yen(Math.round(selected.garbageFactoryM3 * GF_YEN)) }}</td>
              </tr>
              <tr v-if="selected.garbageSiteM3">
                <td>現場ゴミ</td>
                <td class="num">{{ selected.garbageSiteM3 }}m³</td>
                <td class="num">¥{{ GS_YEN.toLocaleString() }}/m³</td>
                <td class="num">{{ yen(Math.round(selected.garbageSiteM3 * GS_YEN)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 交通費（電車） -->
        <div class="modal-section" v-if="selected.trainCost">
          <div class="section-label">交通費（電車） {{ yen(selected.trainCost) }}</div>
          <table class="inner-table">
            <thead><tr><th>区間</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(t, i) in selected._trainItems" :key="i">
                <td>{{ t.label || '—' }}</td>
                <td class="num">{{ yen(t.yen) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ホーム（その他） -->
        <div class="modal-section" v-if="selected.homeCost">
          <div class="section-label">ホームセンター等 {{ yen(selected.homeCost) }}</div>
          <table class="inner-table">
            <thead><tr><th>内容</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(o, i) in selected._otherItems" :key="i">
                <td>{{ o.label || '—' }}</td>
                <td class="num">{{ yen(o.yen) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 合計 -->
        <div class="modal-total">
          <span>合計</span>
          <span>{{ yen(selected.total) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const baseDate  = ref(new Date())
const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const selected  = ref<any | null>(null)

function shiftMonth(delta: number) {
  const d = new Date(baseDate.value)
  d.setDate(1); d.setMonth(d.getMonth() + delta); baseDate.value = d
}
const dateFrom = computed(() => {
  const d = baseDate.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
})
const dateTo = computed(() => {
  const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0)
  return d.toISOString().split('T')[0]
})

const loading    = ref(false)
const siteMap    = ref<Record<string, any[]>>({})
const activeSite = ref('')
const siteNames  = computed(() => Object.keys(siteMap.value).sort((a, b) => a.localeCompare(b, 'ja')))

// 単価（settings テーブルから上書き）
let G_YEN = 23
let D_YEN = 20
let GF_YEN = 8000   // ゴミ工場 yen/m³
let GS_YEN = 14000  // ゴミ現場 yen/m³

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }
function fmt(v: any) {
  const n = Number(v); return !v || isNaN(n) || n === 0 ? '—' : n.toFixed(2).replace(/\.?0+$/, '')
}
function sumF(rows: any[], field: string) {
  return rows?.reduce((s, r) => s + (Number(r[field]) || 0), 0) ?? 0
}
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

// スプレッドシートの列に対応した経費列を抽出
function extractExpenseCols(exp: any) {
  let parkingYen = 0, fuelCost = 0, highwayCost = 0

  for (const v of (exp?.vehicles ?? []).filter((v: any) => v.vehicleName)) {
    parkingYen  += v.parkingYen || 0
    fuelCost    += Math.round((v.distanceKm || 0) * G_YEN) + Math.round((v.dieselKm || 0) * D_YEN)
    highwayCost += v.highwayYen || 0
  }

  const hotelCost      = (exp?.hotelYen || 0) + (exp?.leopalaceYen || 0)
  const entertainCost  = exp?.entertainmentYen || 0
  const garbageFactoryM3 = exp?.garbageFactoryM3 || 0
  const garbageSiteM3    = exp?.garbageSiteM3    || 0
  const garbageCost    = Math.round(garbageFactoryM3 * GF_YEN + garbageSiteM3 * GS_YEN)
  const trainCost      = (exp?.trains ?? []).filter((t: any) => t.yen).reduce((s: number, t: any) => s + t.yen, 0)
  const homeCost       = (exp?.others ?? []).filter((o: any) => o.yen).reduce((s: number, o: any) => s + o.yen, 0)

  return { parkingYen, fuelCost, highwayCost, hotelCost, entertainCost, garbageFactoryM3, garbageSiteM3, garbageCost, trainCost, homeCost }
}

async function load() {
  loading.value = true

  const accountId = await getAccountId()
  const [{ data: wm }, { data: sm }, { data: cfg }] = await Promise.all([
    supabase.from('workers').select('id, name, unit_price').eq('account_id', accountId),
    supabase.from('subcontractors').select('name, category, unit_price').eq('account_id', accountId),
    supabase.from('settings').select('key, value').eq('account_id', accountId),
  ])
  // 設定値を上書き
  for (const row of (cfg ?? [])) {
    if (row.key === 'gasoline_rate_per_km')        G_YEN  = Number(row.value)
    if (row.key === 'diesel_rate_per_km')           D_YEN  = Number(row.value)
    if (row.key === 'garbage_factory_rate_per_m3')  GF_YEN = Number(row.value)
    if (row.key === 'garbage_site_rate_per_m3')     GS_YEN = Number(row.value)
  }
  // 下請け請求（当月）を日表の請求行として構築（商社/業者列に金額を載せ、月計に反映）
  const invoiceSites = new Set<string>()
  const invoiceRowsBySite: Record<string, any[]> = {}
  {
    const { data: sii } = await supabase
      .from('subcontractor_invoice_items')
      .select('site_name, item_date, amount, tax_rate, description, subcontractor_invoices(vendor_name, subcontractors(category))')
      .eq('account_id', accountId)
      .gte('item_date', dateFrom.value)
      .lte('item_date', dateTo.value)
    for (const r of (sii ?? []) as any[]) {
      const name = r.site_name
      if (!name) continue
      invoiceSites.add(name)
      const amt = Number(r.amount) || 0
      const cat = r.subcontractor_invoices?.subcontractors?.category ?? null
      const vendor = r.subcontractor_invoices?.vendor_name ?? ''
      const rows = (invoiceRowsBySite[name] ??= [])
      rows.push({
        _key: `inv-${name}-${r.item_date}-${rows.length}`, _isInvoice: true, siteName: name,
        date: r.item_date || dateFrom.value, _isSunday: false,
        workerSummary: `【請求】${vendor}${r.description ? '・' + r.description : ''}`,
        workers: [], subs: [],
        // 区分=商社 のみ商社列、それ以外（業者/未区分）は業者列（index.vue 月次集計と統一）
        shoshaCost: cat === '商社' ? amt : 0, gyoshaCost: cat === '商社' ? 0 : amt,
        laborCost: 0, parkingYen: 0, fuelCost: 0, highwayCost: 0, hotelCost: 0,
        entertainCost: 0, garbageCost: 0, trainCost: 0, homeCost: 0, total: amt,
      })
    }
  }

  const priceById   = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.unit_price]))
  const priceByName = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.unit_price]))
  const subMaster   = Object.fromEntries((sm ?? []).map((s: any) => [s.name, { category: s.category, unitPrice: s.unit_price ?? 0 }]))

  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, sites')
    .eq('account_id', accountId)
    .eq('is_working', true)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: true })
    .limit(500)

  // 現場×日でグループ化
  const grouped: Record<string, any> = {}

  for (const report of data ?? []) {
    const isSunday = new Date((report as any).date + 'T00:00:00').getDay() === 0

    for (const site of ((report as any).sites ?? [])) {
      const rawName  = site.siteName ?? ''
      const siteName = rawName === '__other__'
        ? (site.customSiteName?.trim() || '新規現場')
        : (rawName.trim() || '(不明)')
      const date  = (report as any).date
      const gKey  = `${siteName}__${date}`

      if (!grouped[gKey]) {
        grouped[gKey] = {
          _key: gKey, siteName, date, _isSunday: isSunday,
          workers: [], subs: [],
          vehicleItems: [],
          _trainItems: [], _otherItems: [],
          _exp: null,
          parkingYen: 0, fuelCost: 0, highwayCost: 0,
          hotelCost: 0, entertainCost: 0,
          garbageFactoryM3: 0, garbageSiteM3: 0, garbageCost: 0,
          trainCost: 0, homeCost: 0,
        }
      }
      const g = grouped[gKey]

      // 作業員
      for (const w of (site.workers ?? []).filter((w: any) => w.workerName)) {
        const unitPrice = priceById[w.workerId] ?? priceByName[w.workerName] ?? 0
        g.workers.push({ ...w, role: w.workerRole ?? 'site', unitPrice, laborCost: calcLaborCost(w, unitPrice) })
      }

      // 下請け（商社/業者区分・単価を master から付与）
      for (const s of (site.subcontractors ?? []).filter((s: any) => s.subcontractorName)) {
        const m = subMaster[s.subcontractorName] ?? { category: null, unitPrice: 0 }
        g.subs.push({ name: s.subcontractorName, count: s.count, category: m.category, unitPrice: m.unitPrice })
      }

      // 経費列の抽出（複数日報を加算）
      const cols = extractExpenseCols(site.expenses)
      g.parkingYen      += cols.parkingYen
      g.fuelCost        += cols.fuelCost
      g.highwayCost     += cols.highwayCost
      g.hotelCost       += cols.hotelCost
      g.entertainCost   += cols.entertainCost
      g.garbageFactoryM3 += cols.garbageFactoryM3
      g.garbageSiteM3   += cols.garbageSiteM3
      g.garbageCost     += cols.garbageCost
      g.trainCost       += cols.trainCost
      g.homeCost        += cols.homeCost

      // モーダル用詳細
      for (const v of (site.expenses?.vehicles ?? []).filter((v: any) => v.vehicleName))
        g.vehicleItems.push(v)
      for (const t of (site.expenses?.trains ?? []).filter((t: any) => t.yen))
        g._trainItems.push(t)
      for (const o of (site.expenses?.others ?? []).filter((o: any) => o.yen))
        g._otherItems.push(o)
      // 最後のexpensesをモーダル用に保持（ホテル・接待費）
      if (site.expenses) g._exp = site.expenses
    }
  }

  // 集計して siteMap に格納
  const map: Record<string, any[]> = {}
  for (const g of Object.values(grouped)) {
    if (!map[g.siteName]) map[g.siteName] = []

    const laborCost  = g.workers.reduce((s: number, w: any) => s + (w.laborCost || 0), 0)
    const shoshaCost = g.subs.filter((s: any) => s.category === '商社')
      .reduce((s: number, sub: any) => s + sub.count * (sub.unitPrice || 0), 0)
    const gyoshaCost = g.subs.filter((s: any) => s.category === '業者')
      .reduce((s: number, sub: any) => s + sub.count * (sub.unitPrice || 0), 0)
    const total = shoshaCost + gyoshaCost + laborCost
      + g.parkingYen + g.fuelCost + g.highwayCost
      + g.hotelCost + g.entertainCost + g.garbageCost + g.trainCost + g.homeCost

    const workerNames   = [...new Set(g.workers.map((w: any) => w.workerName))] as string[]
    const workerSummary = workerNames.join('・')

    map[g.siteName].push({
      ...g,
      laborCost, shoshaCost, gyoshaCost, total,
      workerSummary,
    })
  }

  // 下請け請求の行を各現場に追加（日報の無い現場もタブに出す）
  for (const [name, rows] of Object.entries(invoiceRowsBySite)) {
    ;(map[name] ??= []).push(...rows)
  }

  // 日付順ソート
  for (const rows of Object.values(map)) rows.sort((a, b) => a.date.localeCompare(b.date))

  siteMap.value = map
  const sorted = Object.keys(map).sort((a, b) => a.localeCompare(b, 'ja'))
  activeSite.value = sorted[0] ?? ''
  loading.value = false
}

onMounted(load)
watch(dateFrom, load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.empty { color: #888; padding: 60px; text-align: center; }

.tabs-wrap { overflow-x: auto; margin-bottom: 16px; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid #e0e0e0; min-width: max-content; }
.tab { background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -2px; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #888; cursor: pointer; white-space: nowrap; transition: color .15s, border-color .15s; }
.tab:hover { color: #333; }
.tab.active { color: #06C755; border-bottom-color: #06C755; }

.table-wrap { background: #fff; border-radius: 12px; overflow: auto; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f9f9f9; padding: 9px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; white-space: nowrap; }
.table td { padding: 9px 10px; border-top: 1px solid #f0f0f0; vertical-align: middle; }
.table tfoot td { background: #f5f5f5; font-weight: 700; border-top: 2px solid #e0e0e0; font-size: 13px; }
.data-row { cursor: pointer; transition: background .1s; }
.data-row:hover { background: #f9fff9; }
.invoice-row { background: #eef4ff; cursor: default; }
.invoice-row:hover { background: #e6efff; }
.invoice-row .hint { color: #1a3a7a; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.date-cell { font-weight: 700; white-space: nowrap; }
.sun { color: #E53935; font-size: 10px; font-weight: 700; margin-left: 4px; }
.worker-cell { font-size: 12px; max-width: 180px; }
.sub-cell { font-size: 12px; color: #555; white-space: nowrap; }
.total-col { color: #06C755; font-weight: 700; }
.hint { font-size: 11px; color: #bbb; white-space: nowrap; }
.muted { color: #bbb; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-start; justify-content: center; z-index: 100; padding: 32px 16px; overflow-y: auto; }
.modal { background: #fff; border-radius: 16px; width: 100%; max-width: 720px; padding: 28px; display: flex; flex-direction: column; gap: 20px; }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; }
.modal-title { font-size: 18px; font-weight: 900; }
.modal-date { font-size: 13px; color: #888; margin-top: 4px; }
.btn-close { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 12px; font-size: 14px; cursor: pointer; }
.modal-section { display: flex; flex-direction: column; gap: 8px; }
.section-label { font-size: 11px; font-weight: 700; color: #06C755; letter-spacing: 1px; }
.inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.inner-table th { background: #f9f9f9; padding: 7px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.inner-table td { padding: 8px 10px; border-top: 1px solid #f5f5f5; }
.role-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
.role-badge.factory { background: #e8f4ff; color: #1a6fc4; }
.role-badge.site { background: #e8fff0; color: #0a8a3a; }
.simple-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; }
.num-text { font-variant-numeric: tabular-nums; }
.flex-rows { display: flex; flex-direction: column; gap: 4px; }
.modal-total { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e0e0e0; padding-top: 16px; font-size: 16px; font-weight: 700; }
.modal-total span:last-child { font-size: 20px; color: #06C755; }
</style>
