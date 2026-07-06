<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場別集計
        <HelpButton title="現場別集計の使い方" :items="[
          '現場ごとに日報の稼働（人工）と経費を集計して表示します。',
          '上部の月ナビで対象月を切り替えられます。',
          '行を開くと、日報単位の内訳（作業員・経費）を確認できます。',
        ]" />
      </h1>
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

      <!-- 出力（※表の表示月は上の ‹ 年月 › ナビで切替。ここはCSV/PDF出力の範囲だけ） -->
      <div v-if="activeSite" class="export-bar">
        <label class="export-range-lbl">出力範囲
          <select v-model="exportRange" class="export-range" data-testid="export-range">
            <option value="month">表示中の月（{{ yearMonth }}）</option>
            <option value="range">年月範囲を指定</option>
            <option value="all">全期間</option>
          </select>
        </label>
        <template v-if="exportRange === 'range'">
          <input type="month" v-model="exportFromYM" class="export-ym" data-testid="export-from" />
          <span>〜</span>
          <input type="month" v-model="exportToYM" class="export-ym" data-testid="export-to" />
        </template>
        <button class="btn-export" :disabled="exporting" data-testid="export-site" @click="exportSite">{{ exporting ? '出力中…' : '⬇ CSV＋見積書PDFを出力' }}</button>
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
              <th v-if="canViewWages" class="num">
                社員<span v-if="wageMode === 'real'" class="wage-mode-tag">実質</span>
                <button
                  v-if="canViewHourlyWage"
                  type="button"
                  class="wage-toggle-btn"
                  :class="{ on: wageMode === 'real' }"
                  :title="wageMode === 'real' ? '日当ベースに戻す' : '実質賃金(時給×稼働)で集計'"
                  @click.stop="toggleWageMode"
                >{{ wageMode === 'real' ? '日当に戻す' : '実質賃金' }}</button>
              </th>
              <th class="num">駐車場</th>
              <th class="num">燃料</th>
              <th class="num">高速</th>
              <th class="num">宿泊</th>
              <th class="num">接待費</th>
              <th class="num">ゴミ</th>
              <th class="num">交通費</th>
              <th class="num">ホーム</th>
              <th class="num">出張費</th>
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
              <td v-if="canViewWages" class="num">{{ row.laborCost     ? yen(row.laborCost)     : '—' }}</td>
              <td class="num">{{ row.parkingYen    ? yen(row.parkingYen)    : '—' }}</td>
              <td class="num">{{ row.fuelCost      ? yen(row.fuelCost)      : '—' }}</td>
              <td class="num">{{ row.highwayCost   ? yen(row.highwayCost)   : '—' }}</td>
              <td class="num">{{ row.hotelCost     ? yen(row.hotelCost)     : '—' }}</td>
              <td class="num">{{ row.entertainCost ? yen(row.entertainCost) : '—' }}</td>
              <td class="num">{{ row.garbageCost ? yen(row.garbageCost) : '—' }}</td>
              <td class="num">{{ row.trainCost     ? yen(row.trainCost)     : '—' }}</td>
              <td class="num">{{ row.homeCost      ? yen(row.homeCost)      : '—' }}</td>
              <td class="num">{{ row.tripCost      ? yen(row.tripCost)      : '—' }}</td>
              <td class="num total-col">{{ yen(row.total) }}</td>
              <td class="hint">{{ row._isInvoice ? '請求' : '詳細 →' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="2">月計</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'shoshaCost'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'gyoshaCost'))    }}</td>
              <td v-if="canViewWages" class="num">{{ yen(sumF(siteMap[activeSite], 'laborCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'parkingYen'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'fuelCost'))      }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'highwayCost'))   }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'hotelCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'entertainCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'garbageCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'trainCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'homeCost'))      }}</td>
              <td class="num">{{ yen(sumF(siteMap[activeSite], 'tripCost'))     }}</td>
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

        <!-- 出張費（別費目・主たる現場に計上／社員には含めない） -->
        <div class="modal-section" v-if="selected.tripCost" data-testid="trip-cost-section">
          <div class="section-label">出張費（{{ yen(selected.tripCost) }}）</div>
          <p class="muted" style="font-size:12px;margin:2px 0 0">出張日の手当 ¥3,000/人。主たる現場（最長稼働）に1回計上。社員（人件費）には含みません。</p>
        </div>

        <!-- 稼働 -->
        <div class="modal-section" v-if="selected.workers.length">
          <div class="section-label">稼働<template v-if="canViewWages">（社員 {{ yen(selected.laborCost) }}）</template></div>
          <table class="inner-table">
            <thead>
              <tr>
                <th>作業員</th><th>区分</th>
                <th class="num">通常</th><th class="num">残業</th><th class="num">深夜</th>
                <th v-if="canViewWages" class="num">単価</th><th v-if="canViewWages" class="num">人件費</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(w, i) in selected.workers" :key="i">
                <td>{{ w.workerName }}</td>
                <td><span class="role-badge" :class="w.role">{{ w.role === 'factory' ? '工場' : '現場' }}</span></td>
                <td class="num">{{ fmt(w.hoursNormal) }}</td>
                <td class="num">{{ fmt(w.hoursOT) }}</td>
                <td class="num">{{ fmt(w.hoursNight) }}</td>
                <td v-if="canViewWages" class="num">{{ !w.unitPrice ? '—' : yen(w.unitPrice) + (w._wageMode === 'real' ? '/h' : '/日') }}</td>
                <td v-if="canViewWages" class="num">{{ w.laborCost ? yen(w.laborCost) : '—' }}</td>
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
          <div class="section-label">協力業者（区分未設定）</div>
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
              <!-- 新形式 hotels[]（複数） -->
              <template v-if="(selected._exp?.hotels || []).some((h: any) => h.yen)">
                <tr v-for="(h, hi) in (selected._exp.hotels || []).filter((x: any) => x.yen)" :key="hi">
                  <td>宿泊</td>
                  <td>{{ h.label || '—' }}</td>
                  <td class="num">{{ yen(h.yen) }}</td>
                </tr>
              </template>
              <!-- 旧スカラー（後方互換） -->
              <template v-else>
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
              </template>
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
import { useQueryParam, useYearMonthParam } from '../composables/useQueryParam'
import { resolveDocUrl } from '../lib/docUrl'
import HelpButton from '../components/HelpButton.vue'
import { laborBreakdownForReport, laborCostForBreakdown, ZERO_BREAKDOWN, buildWageTimelines, wageForDate, businessTripMainEntries, BUSINESS_TRIP_ALLOWANCE } from '../lib/workerHours'
import type { WageMode } from '../lib/workerHours'
import { canViewWages, canViewHourlyWage } from '../lib/auth'
import JSZip from 'jszip'

const exporting = ref(false)
// エクスポート期間の選択（当月／年月範囲／全期間）
const _nowYM = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
const exportRange  = ref<'month' | 'range' | 'all'>('month')
const exportFromYM = ref(_nowYM)   // 'YYYY-MM'
const exportToYM   = ref(_nowYM)
function ymToFrom(ym: string) { return `${ym}-01` }
function ymToTo(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()   // 当月末日（m は1-12のまま=翌月0日）
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
// 選択中の期間を {from, to, label} に解決（label はファイル名に使う）
function exportPeriod(): { from: string; to: string; label: string } {
  if (exportRange.value === 'all') return { from: '2000-01-01', to: '2999-12-31', label: '全期間' }
  if (exportRange.value === 'range' && exportFromYM.value && exportToYM.value) {
    const [a, b] = exportFromYM.value <= exportToYM.value
      ? [exportFromYM.value, exportToYM.value] : [exportToYM.value, exportFromYM.value]
    return { from: ymToFrom(a), to: ymToTo(b), label: `${a}〜${b}` }
  }
  return { from: dateFrom.value, to: dateTo.value, label: yearMonth.value }
}
// 現場別集計（当該現場の表・選択期間）＋ 紐づく見積書PDF を zip でエクスポート（見積書フォルダ内包）
async function exportSite() {
  const site = activeSite.value
  if (!site) return
  exporting.value = true
  try {
    const { from, to, label } = exportPeriod()
    // 表示中の当月ならロード済みの siteMap を流用、それ以外は選択期間で再集計
    const map = (exportRange.value === 'month') ? siteMap.value : await computeSiteMap(from, to)
    const rows = (map[site] ?? []).filter((r: any) => !r._isInvoice)
    const head = ['日付','作業員','商社','業者','社員','駐車場','燃料','高速','宿泊','接待費','ゴミ','交通費','ホーム','出張費','合計']
    const csv = [head.join(',')].concat(rows.map((r: any) => [
      r.date, '"' + String(r.workerSummary ?? '').replace(/"/g, '""') + '"',
      r.shoshaCost||0, r.gyoshaCost||0, r.laborCost||0, r.parkingYen||0, r.fuelCost||0, r.highwayCost||0,
      r.hotelCost||0, r.entertainCost||0, r.garbageCost||0, r.trainCost||0, r.homeCost||0, r.tripCost||0, r.total||0,
    ].join(','))).join('\r\n')
    const zip = new JSZip()
    zip.file(`現場別集計_${site}_${label}.csv`, '﻿' + csv) // BOM付き=Excelで文字化けしない
    // 紐づく見積書PDF（estimates.site_id）を「見積書」フォルダに内包（期間に依らず当該現場の全見積）
    const accountId = await getAccountId()
    const { data: siteRow } = await supabase.from('sites').select('id').eq('account_id', accountId).eq('name', site).maybeSingle()
    if (siteRow?.id) {
      const { data: ests } = await supabase.from('estimates')
        .select('estimate_number, pdf_path, pdf_bucket').eq('site_id', siteRow.id).eq('is_deleted', false)
      const folder = zip.folder('見積書')
      for (const e of (ests ?? []) as any[]) {
        if (!e.pdf_path) continue
        try {
          // pdf_bucket で出し分け（admin-docs=署名URL / expense-receipts=公開URL）
          const url = await resolveDocUrl(e.pdf_path, e.pdf_bucket); if (!url) continue
          const resp = await fetch(url); if (!resp.ok) continue
          folder?.file(`${e.estimate_number || 'estimate'}.pdf`, await resp.blob())
        } catch { /* 1件失敗しても続行 */ }
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `現場別集計_${site}_${label}.zip`
    a.click(); URL.revokeObjectURL(a.href)
  } finally { exporting.value = false }
}

const baseDate  = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期
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
const activeSite = useQueryParam('site', '')   // URL ?site= に同期（ページ跨ぎで復元）
// 賃金モード（office以上のみ切替可）。既定=日当/8×稼働（現場管理者も閲覧OK）／real=実質賃金(時給×稼働)
const wageMode = ref<WageMode>('daily')
function toggleWageMode() {
  if (!canViewHourlyWage.value) return
  wageMode.value = wageMode.value === 'daily' ? 'real' : 'daily'
}
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
// スプレッドシートの列に対応した経費列を抽出
function extractExpenseCols(exp: any) {
  let parkingYen = 0, fuelCost = 0, highwayCost = 0

  for (const v of (exp?.vehicles ?? []).filter((v: any) => v.vehicleName)) {
    parkingYen  += v.parkingYen || 0
    fuelCost    += Math.round((v.distanceKm || 0) * G_YEN) + Math.round((v.dieselKm || 0) * D_YEN)
    highwayCost += v.highwayYen || 0
  }
  // 新形式: 現場ごとの駐車場代/高速代（複数・明細ごと）も集計に含める（旧の車両埋め込みだけだと漏れる）
  parkingYen  += (exp?.parkings  ?? []).reduce((s: number, p: any) => s + (Number(p.yen) || 0), 0)
  highwayCost += (exp?.highways  ?? []).reduce((s: number, h: any) => s + (Number(h.yen) || 0), 0)

  // 宿泊費: 新形式 hotels[] があればその合計、無ければ旧スカラー(hotel/leopalace)＝二重計上を防ぐ後方互換
  const hotelsSum      = (exp?.hotels || []).reduce((s: number, h: any) => s + (Number(h.yen) || 0), 0)
  const hotelCost      = hotelsSum > 0 ? hotelsSum : (exp?.hotelYen || 0) + (exp?.leopalaceYen || 0)
  const entertainCost  = (exp?.entertainments ?? []).reduce((s: number, e: any) => s + (e.yen || 0), 0) || (exp?.entertainmentYen || 0)
  const garbageFactoryM3 = exp?.garbageFactoryM3 || 0
  const garbageSiteM3    = exp?.garbageSiteM3    || 0
  const garbageCost    = Math.round(garbageFactoryM3 * GF_YEN + garbageSiteM3 * GS_YEN)
  const trainCost      = (exp?.trains ?? []).filter((t: any) => t.yen).reduce((s: number, t: any) => s + t.yen, 0)
  const homeCost       = (exp?.others ?? []).filter((o: any) => o.yen).reduce((s: number, o: any) => s + o.yen, 0)

  return { parkingYen, fuelCost, highwayCost, hotelCost, entertainCost, garbageFactoryM3, garbageSiteM3, garbageCost, trainCost, homeCost }
}

async function computeSiteMap(fromDate: string, toDate: string): Promise<Record<string, any[]>> {
  const accountId = await getAccountId()
  const [{ data: wm }, { data: sm }, { data: cfg }, { data: wh }] = await Promise.all([
    supabase.from('workers').select('id, name, daily_wage, hourly_wage').eq('account_id', accountId),
    supabase.from('subcontractors').select('name, category, unit_price').eq('account_id', accountId),
    supabase.from('settings').select('key, value').eq('account_id', accountId),
    supabase.from('worker_wage_history').select('worker_id, effective_date, changed_at, old_unit_price, new_unit_price, wage_type, old_wage_type, old_daily_wage, new_daily_wage, old_hourly_wage, new_hourly_wage').eq('account_id', accountId),
  ])
  const wageTimelines = buildWageTimelines((wh ?? []) as any[])  // 作業員ごとの昇給timeline（日付別単価解決用）
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
      .gte('item_date', fromDate)
      .lte('item_date', toDate)
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

  const dailyById    = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.daily_wage  ?? 0]))
  const dailyByName  = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.daily_wage  ?? 0]))
  const hourlyById   = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.hourly_wage ?? 0]))
  const hourlyByName = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.hourly_wage ?? 0]))
  const idByName    = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.id]))  // 日報がworkerId空でも昇給timelineを引けるように
  const subMaster   = Object.fromEntries((sm ?? []).map((s: any) => [s.name, { category: s.category, unitPrice: s.unit_price ?? 0 }]))

  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, is_business_trip, sites')
    .eq('account_id', accountId)
    .eq('is_working', true)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })
    .limit(5000) // 1ヶ月×全作業員で500件超→一部の日が溢れて欠落するため余裕を持たせる

  // 現場×日でグループ化
  const grouped: Record<string, any> = {}

  for (const report of data ?? []) {
    const isSunday = new Date((report as any).date + 'T00:00:00').getDay() === 0
    // 実勤務時間ベースで料率別時間を再計算（保存値の hoursNormal に依存しない＝通常×8h固定バグの修正）。
    // 同一作業員が複数現場に跨る場合は現場跨ぎで残業を累積する。
    const laborMap = laborBreakdownForReport((report as any).sites ?? [], isSunday)
    // 出張日：作業員ごとの主たる現場（最長稼働）にだけ +¥3,000 を計上（二重計上回避）
    const tripSet = (report as any).is_business_trip ? businessTripMainEntries((report as any).sites ?? []) : null

    for (const site of ((report as any).sites ?? [])) {
      const rawName  = site.siteName ?? ''
      const siteName = rawName === '__unset__'
        ? '現場未設定'
        : rawName === '__other__'
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
          trainCost: 0, homeCost: 0, tripCost: 0,
        }
      }
      const g = grouped[gKey]

      // 作業員
      for (const w of (site.workers ?? []).filter((w: any) => w.workerName)) {
        const curDaily  = dailyById[w.workerId]  ?? dailyByName[w.workerName]  ?? 0
        const curHourly = hourlyById[w.workerId] ?? hourlyByName[w.workerName] ?? 0
        const wid = w.workerId || idByName[w.workerName]
        // 日報の日付に有効だった日当・時給で計算（昇給で過去の人件費が動かないように）
        const { daily, hourly } = wageForDate(date, wid ? wageTimelines.get(wid) : undefined, curDaily, curHourly)
        const breakdown = laborMap.get(w) ?? ZERO_BREAKDOWN
        // 単価セルは選択中モードの単価を表示（既定=日当／実質賃金ONは時給）
        const unitPrice = wageMode.value === 'real' ? hourly : daily
        g.workers.push({ ...w, ...breakdown, role: w.workerRole ?? 'site', unitPrice, _wageMode: wageMode.value, laborCost: laborCostForBreakdown(breakdown, daily, hourly, wageMode.value) })
        // 出張費は人件費(社員)に混ぜず、主たる現場の別費目として計上（原価視点・複数現場でも主現場に1回）
        if (tripSet?.has(w)) g.tripCost += BUSINESS_TRIP_ALLOWANCE
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
      + g.hotelCost + g.entertainCost + g.garbageCost + g.trainCost + g.homeCost + g.tripCost

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

  return map
}

async function load() {
  loading.value = true
  const map = await computeSiteMap(dateFrom.value, dateTo.value)
  siteMap.value = map
  const sorted = Object.keys(map).sort((a, b) => a.localeCompare(b, 'ja'))
  activeSite.value = sorted[0] ?? ''
  loading.value = false
}

onMounted(load)
watch(dateFrom, load)
watch(wageMode, load)   // 日当↔実質賃金の切替で社員人件費を再集計
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.empty { color: #888; padding: 60px; text-align: center; }
.wage-toggle-btn { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 1px 8px; cursor: pointer; white-space: nowrap; }
.wage-toggle-btn.on { background: #4338ca; color: #fff; border-color: #4338ca; }
.wage-mode-tag { margin-left: 4px; font-size: 9px; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 3px; padding: 0 4px; }

.tabs-wrap { overflow-x: auto; margin-bottom: 16px; }
.export-bar { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin: 10px 0 0; flex-wrap: wrap; }
.export-range-lbl { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
.export-range, .export-ym { border: 1px solid #ccc; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.btn-export { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-export:disabled { opacity: .5; cursor: default; }
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
.trip-badge { display: inline-block; margin-left: 6px; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; background: #eef2ff; color: #4338ca; white-space: nowrap; }
.role-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
.role-badge.factory { background: #e8f4ff; color: #1a6fc4; }
.role-badge.site { background: #e8fff0; color: #0a8a3a; }
.simple-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; }
.num-text { font-variant-numeric: tabular-nums; }
.flex-rows { display: flex; flex-direction: column; gap: 4px; }
.modal-total { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e0e0e0; padding-top: 16px; font-size: 16px; font-weight: 700; }
.modal-total span:last-child { font-size: 20px; color: #06C755; }
</style>
