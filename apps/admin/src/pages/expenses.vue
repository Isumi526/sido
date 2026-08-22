<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">経費管理</h1>
      <div class="month-nav">
        <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
        <span class="month-label">{{ yearMonth }}</span>
        <button class="btn-nav" @click="shiftMonth(1)">›</button>
      </div>
    </div>

    <p class="note">
      作業員 × 期（前半・後半）ごとに経費を集計しています。前半・後半は別の精算として扱います。
    </p>

    <!-- フィルタ -->
    <div class="filter-bar">
      <button class="filter-btn" :class="{ active: filter === 'all' }" @click="filter = 'all'">すべて</button>
      <button class="filter-btn" :class="{ active: filter === 'todo' }" @click="filter = 'todo'">
        要対応（申請中）<span v-if="todoCount" class="filter-badge">{{ todoCount }}</span>
      </button>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="visibleRows.length === 0" class="empty">
      {{ filter === 'todo' ? '申請中の精算はありません' : 'この月の経費がありません' }}
    </div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>作業員</th>
            <th>期</th>
            <th class="num">件数</th>
            <th class="num">経費合計</th>
            <th class="num">立替（振込額）</th>
            <th>ステータス</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.key" class="data-row" @click="selected = row">
            <td class="worker-cell">{{ row.workerName }}</td>
            <td><span class="period-chip">{{ row.shortLabel }}</span></td>
            <td class="num">{{ row.count }}</td>
            <td class="num">{{ yen(row.total) }}</td>
            <td class="num">{{ row.tategaeTotal ? yen(row.tategaeTotal) : '—' }}</td>
            <td><span class="badge" :class="`st-${row.statusClass}`">{{ row.statusLabel }}</span></td>
            <td class="chevron">›</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="2">合計</td>
            <td class="num">{{ grandCount }}</td>
            <td class="num">{{ yen(grandTotal) }}</td>
            <td class="num">{{ grandTategae ? yen(grandTategae) : '—' }}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 科目別 月次集計（科目×月クロス集計・直近12ヶ月）#6bba03b2 -->
    <section class="crosstab">
      <button class="crosstab-toggle" data-testid="crosstab-toggle" @click="toggleCrossTab">
        <span class="material-symbols-rounded ct-ico">table_chart</span>
        科目別 月次集計（直近12ヶ月）
        <span class="material-symbols-rounded ct-caret">{{ showCrossTab ? 'expand_less' : 'expand_more' }}</span>
      </button>
      <div v-if="showCrossTab" class="crosstab-body">
        <p class="note">
          現場経費（日報の経費）と個人経費を、科目ごと・月ごとに合計しています。車両の距離按分（内部原価の配賦分）は含みません。金額は税込です。
        </p>
        <div v-if="crossLoading" class="empty">読み込み中...</div>
        <div v-else-if="crossRows.length === 0" class="empty">この期間の経費がありません</div>
        <div v-else class="table-wrap crosstab-wrap">
          <table class="table crosstab-table" data-testid="crosstab-table">
            <thead>
              <tr>
                <th class="ct-acct">科目</th>
                <th v-for="m in crossMonths" :key="m" class="num" :class="{ 'ct-cur': m === currentMonthKey }">{{ monthShort(m) }}</th>
                <th class="num ct-total">年計</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in crossRows" :key="r.account" class="data-row">
                <td class="ct-acct">{{ r.account }}</td>
                <td v-for="m in crossMonths" :key="m" class="num" :class="{ 'ct-cur': m === currentMonthKey }">{{ r.byMonth[m] ? yen(r.byMonth[m]) : '—' }}</td>
                <td class="num ct-total">{{ yen(r.total) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td class="ct-acct">合計</td>
                <td v-for="m in crossMonths" :key="m" class="num" :class="{ 'ct-cur': m === currentMonthKey }">{{ crossColTotals[m] ? yen(crossColTotals[m]) : '—' }}</td>
                <td class="num ct-total">{{ yen(crossGrandTotal) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>

    <!-- 明細モーダル（1期分） -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head no-print">
          <h2>{{ selected.workerName }} — {{ yearMonth }} {{ selected.shortLabel }} の経費明細</h2>
          <div class="modal-head-actions">
            <button class="btn-pdf" @click="printExpenseDoc('meisai')"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> 明細PDF</button>
            <button class="btn-pdf btn-pdf-seikyu" @click="printExpenseDoc('seikyu')"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> 請求書PDF（立替）</button>
            <button class="modal-close" @click="selected = null">×</button>
          </div>
        </div>
        <div class="modal-body" :class="{ 'print-seikyu': printMode === 'seikyu' }">
          <!-- 印刷/PDF出力時のみ表示するドキュメントヘッダ -->
          <div class="print-only print-doc-head">
            <h1 class="print-doc-title">{{ printMode === 'seikyu' ? '請　求　書' : '明　細' }}</h1>
            <div class="print-doc-top">
              <div class="print-doc-left">
                <div v-if="accountName" class="print-addressee">{{ accountName }}　御中</div>
                <p class="print-lead">{{ printMode === 'seikyu' ? '下記のとおり、個人立替分の経費をご請求します。' : '下記のとおり、経費の明細をご報告します。' }}</p>
              </div>
              <div class="print-doc-meta">
                <div>請求日 {{ printIssueDate }}</div>
                <div>対象期間 {{ yearMonth }} {{ selected.shortLabel }}</div>
                <div class="print-doc-name">氏名：{{ selected.workerName }}</div>
              </div>
            </div>
          </div>
          <!-- 申請状況 -->
          <div class="settle-row no-print">
            <span class="badge" :class="`st-${selected.statusClass}`">{{ selected.statusLabel }}</span>
            <span class="settle-pay">振込額（立替）<strong>{{ yen(selected.tategaeTotal) }}</strong></span>
            <span class="settle-amt">経費合計 {{ yen(selected.total) }}（{{ selected.count }}件）</span>
            <span v-if="selected.settlement?.reject_reason && selected.status === '差し戻し'" class="settle-reason">理由: {{ selected.settlement.reject_reason }}</span>
            <span v-if="selected.status === '支払い済み' && selected.settlement?.paid_on" class="settle-paid-info">支払日 {{ selected.settlement.paid_on }}</span>
            <template v-if="selected.status === '申請中'">
              <button class="btn-reject" @click="openReject(selected)">差し戻し</button>
              <button class="btn-pay" @click="openPay(selected)">支払い済みにする</button>
            </template>
            <button v-else-if="selected.status === '支払い済み'" class="btn-status-link" @click="undoPaid(selected)">申請中に戻す</button>
            <button v-else-if="selected.status === '期限超過'" class="btn-rescue" @click="rescueOverdue(selected)">未申請に戻す（救済）</button>
          </div>
          <p class="settle-hint no-print">※ 会社が作業員へ振り込むのは「立替（個人建て替え）」分のみです。経費合計は参考値です。</p>

          <!-- 申請PDF（作業員申請時にStorageへ保存された 明細/請求書 を閲覧・DL） -->
          <div v-if="selected.settlement?.applied_at" class="pdf-row no-print">
            <span class="pdf-label">申請PDF：</span>
            <a href="#" @click.prevent="openApplicationPdf(selected, 'meisai')" class="pdf-link"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> 明細</a>
            <a href="#" @click.prevent="openApplicationPdf(selected, 'seikyu')" class="pdf-link"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> 請求書</a>
          </div>

          <!-- 科目の絞り込み（2026-08-10 運用者要望）。逐語:「旅費交通費だけとかさ、
               旅費交通費だけでもPDFが出せたりとか、雑費だけの経費が出せたりとか、その選びたい」 -->
          <div v-if="availableAccounts.length > 1" class="acct-filter no-print" data-testid="acct-filter">
            <span class="af-label">科目で絞る</span>
            <button
              v-for="a in availableAccounts" :key="a"
              class="af-chip" :class="{ on: acctFilter.has(a) }"
              :data-testid="`acct-chip-${a}`"
              @click="toggleAcct(a)"
            >{{ a }}</button>
            <button v-if="acctFilter.size" class="af-clear" data-testid="acct-clear" @click="acctFilter = new Set()">クリア</button>
          </div>
          <!-- 支払先の絞り込み（科目とAND・2026-08-22）。科目とは独立に選べ、両方選ぶと両条件を満たす明細だけになる。 -->
          <div v-if="availablePayees.length > 1" class="acct-filter no-print" data-testid="payee-filter">
            <span class="af-label">支払先で絞る</span>
            <button
              v-for="p in availablePayees" :key="p"
              class="af-chip" :class="{ on: payeeFilter.has(p) }"
              :data-testid="`payee-chip-${p}`"
              @click="togglePayee(p)"
            >{{ p }}</button>
            <button v-if="payeeFilter.size" class="af-clear" data-testid="payee-clear" @click="payeeFilter = new Set()">クリア</button>
          </div>
          <span v-if="acctFilter.size || payeeFilter.size" class="af-count no-print" data-testid="filter-count">
            {{ filteredDetails.length }} / {{ selected.details.length }} 件 ・ {{ yen(filteredTotal) }}
          </span>
          <!-- ★絞り込み中はPDFにもその旨を出す。出力だけ見た人が「全部の経費」と誤解しないように。 -->
          <p v-if="acctFilter.size" class="acct-filter-note print-only" data-testid="acct-print-note">
            ※ 科目「{{ [...acctFilter].join('・') }}」のみを抽出した明細です。
          </p>
          <p v-if="payeeFilter.size" class="acct-filter-note print-only" data-testid="payee-print-note">
            ※ 支払先「{{ [...payeeFilter].join('・') }}」のみを抽出した明細です。
          </p>

          <table class="table detail-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>支払い先</th>
                <th>インボイス番号</th>
                <th>科目</th>
                <th>品名</th>
                <th class="num">ℓ</th>
                <th>現場名</th>
                <th>使用車</th>
                <th class="num">金額</th>
                <th class="no-print">立替</th>
                <th class="no-print">領収書</th>
              </tr>
            </thead>
            <tbody>
              <!-- 請求書(立替のみ)印刷時は 立替でない行を隠す（画面表示は常に全件） -->
              <tr v-for="(d, i) in filteredDetails" :key="i" :class="{ 'pdf-hide-row': printMode === 'seikyu' && !d.tategae }">
                <td class="date-cell">{{ mdW(d.date) }}</td>
                <td class="muted">{{ d.payee || '—' }}</td>
                <td class="muted">{{ d.registrationNumber || '—' }}</td>
                <td>{{ expenseAccountCategory(d) }}</td>
                <!-- ★品名は科目とは別物（科目=会計仕訳用／品名=何を買ったか）。
                     個人経費は category に勘定科目が入るので note（実際の品名）を出す。
                     導出は expenseDisplayCategory / note の1経路だけ（帳票と同じ規則）。 -->
                <td class="muted">{{ itemName(d) }}</td>
                <td class="num muted">{{ d.liters ?? '' }}</td>
                <td>{{ isPersonalExpenseRow(d) ? '現場外' : (d.siteName || '—') }}</td>
                <td class="muted">{{ d.vehicle || '' }}</td>
                <td class="num">{{ yen(d.amount) }}</td>
                <td class="no-print">{{ d.tategae ? '○' : '' }}</td>
                <td class="receipt-cell no-print">
                  <template v-if="d.fileUrls && d.fileUrls.length">
                    <a v-for="(u, ui) in d.fileUrls" :key="ui" :href="u" target="_blank" rel="noopener" class="receipt-link">
                      <span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>{{ d.fileUrls.length > 1 ? ui + 1 : '' }}
                    </a>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="detail-total-row">
                <!-- ★列数と合わせる（日付/支払い先/インボイス/科目/品名/ℓ/現場/使用車 = 8）。
                     2026-08-10 に品名列を足した時にここを直し忘れ、合計の位置が1列ずれていた。 -->
                <td colspan="8" class="right">{{ printMode === 'seikyu' ? '振込額（立替）' : '合計' }}</td>
                <!-- ★合計は必ず「いま表に出ている行」から出す。絞り込んだPDFに全体の合計が
                     残ると、渡された側は絞り込みに気づかず金額だけ信じてしまう。 -->
                <td class="num">{{ yen(printMode === 'seikyu' ? filteredTategaeTotal : filteredTotal) }}</td>
                <td colspan="2" class="no-print"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>

    <!-- 差し戻し理由モーダル -->
    <div v-if="rejectTarget" class="modal-overlay" @click.self="rejectTarget = null">
      <div class="modal reject-modal">
        <div class="modal-head">
          <h2>差し戻し — {{ rejectTarget.workerName }}（{{ rejectTarget.shortLabel }}）</h2>
          <button class="modal-close" @click="rejectTarget = null">×</button>
        </div>
        <div class="modal-body">
          <label class="reject-label">差し戻し理由（必須）</label>
          <textarea v-model="rejectReason" class="reject-textarea" rows="4" placeholder="例: 領収書の添付漏れがあります"></textarea>
          <p v-if="rejectError" class="reject-error">{{ rejectError }}</p>
          <div class="reject-actions">
            <button class="btn-cancel" @click="rejectTarget = null">キャンセル</button>
            <button class="btn-reject-confirm" :disabled="rejecting" @click="doReject">
              {{ rejecting ? '処理中…' : '差し戻す' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 支払い完了モーダル（区分・支払日を必ず入力させる） -->
    <div v-if="payTarget" class="modal-overlay confirm-overlay" @click.self="payTarget = null">
      <div class="confirm-box">
        <p class="confirm-msg">「{{ payTarget.workerName }}（{{ payTarget.shortLabel }}）」を支払い済みにします。</p>
        <label class="pay-label">支払い区分（必須）</label>
        <select v-model="payMethod" class="pay-input">
          <option value="" disabled>選択してください</option>
          <option value="銀行振込">銀行振込</option>
          <option value="手渡し">手渡し</option>
        </select>
        <label class="pay-label">支払日（必須）</label>
        <input v-model="payDate" type="date" class="pay-input" />
        <p v-if="payError" class="reject-error">{{ payError }}</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="payTarget = null">キャンセル</button>
          <button class="btn-confirm-ok" :disabled="!payMethod || !payDate || paying" @click="doPay">
            {{ paying ? '処理中…' : '支払い済みにする' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 救済（未申請に戻す）確認 -->
    <div v-if="rescueTarget" class="modal-overlay confirm-overlay" @click.self="rescueTarget = null">
      <div class="confirm-box">
        <p class="confirm-msg">「{{ rescueTarget.workerName }}（{{ rescueTarget.shortLabel }}）」を未申請に戻し、作業員が再申請できるようにします。<br>よろしいですか？</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="rescueTarget = null">キャンセル</button>
          <button class="btn-confirm-ok" :disabled="rescuing" @click="doRescue">{{ rescuing ? '処理中…' : '未申請に戻す' }}</button>
        </div>
      </div>
    </div>

    <!-- 取消（申請中に戻す）確認 -->
    <div v-if="undoTarget" class="modal-overlay confirm-overlay" @click.self="undoTarget = null">
      <div class="confirm-box">
        <p class="confirm-msg">「{{ undoTarget.workerName }}（{{ undoTarget.shortLabel }}）」を申請中に戻します。<br>支払い区分・支払日は消去されます。よろしいですか？</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="undoTarget = null">キャンセル</button>
          <button class="btn-confirm-ok danger" :disabled="undoing" @click="doUndoPaid">{{ undoing ? '処理中…' : '申請中に戻す' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useYearMonthParam } from '../composables/useQueryParam'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug, getAccountName } from '../lib/account'
import { notifyWorker, workerIdOfUser } from '../lib/appNotify'
import { openConventionDoc } from '../lib/docUrl'
import { flattenReportExpenses, flattenGasolineItems, flattenPersonalExpenses, isPersonalExpenseRow, ratesFromSettings, effectiveStatus, expenseAccountCategory, expenseDisplayCategory, EXPENSE_ACCOUNT_OPTIONS, expenseMonthKey, type ExpenseRow, type SettlementStatus } from '../lib/expenses'

/** 品名欄。個人経費は category＝勘定科目なので note（実際の品名）を出す（liff の帳票と同一規則）。 */
function itemName(row: ExpenseRow): string {
  if (isPersonalExpenseRow(row)) return row.note || ''
  return expenseDisplayCategory(row.category)
}

/** 申請PDF(明細/請求書)を開く。パスは generateExpensePdf.uploadApplicationPdf と一致。
 *  ★公開URLを直接 href に入れるのをやめた。新規分は非公開バケットに入るので
 *   署名URLの取得（非同期）が要る。既存分は dual-read で公開URLに落ちる。 */
async function openApplicationPdf(row: { userId: string; periodKey: string }, kind: 'meisai' | 'seikyu'): Promise<void> {
  const path = `expense-applications/${getAccountSlug()}/${row.userId}/${row.periodKey}_${kind}.pdf`
  await openConventionDoc(path)
}

// 1行 = 作業員 × 期(period)
interface PeriodRow {
  key: string                 // userId|periodKey
  userId: string
  workerName: string
  periodKey: string
  shortLabel: string          // 前半 / 後半
  count: number
  total: number
  tategaeTotal: number
  details: ExpenseRow[]
  settlement: any | null
  status: SettlementStatus
  statusLabel: string
  statusClass: string
}

const baseDate  = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期
const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const loading   = ref(false)
const rows      = ref<PeriodRow[]>([])
const selected  = ref<PeriodRow | null>(null)
const filter    = ref<'all' | 'todo'>('all')

const visibleRows = computed(() => filter.value === 'todo'
  ? rows.value.filter(r => r.status === '申請中')
  : rows.value)
const todoCount = computed(() => rows.value.filter(r => r.status === '申請中').length)

const grandCount   = computed(() => visibleRows.value.reduce((s, r) => s + r.count, 0))
const grandTotal   = computed(() => visibleRows.value.reduce((s, r) => s + r.total, 0))
const grandTategae = computed(() => visibleRows.value.reduce((s, r) => s + r.tategaeTotal, 0))

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }
// 明細の日付を「MM/DD(曜)」で表示（経費PDFに曜日を出す・2026-08-22）。不正な日付は従来の月日表記にフォールバック。
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']
function mdW(dateStr: string): string {
  const s = String(dateStr || '')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s.slice(5).replace('-', '/')
  const wd = WEEKDAY_JA[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()]
  return `${m[2]}/${m[3]}(${wd})`
}

// PDF出力（印刷CSS方式＝liff /expense/print と同方式。ブラウザの印刷→PDF保存で明細を出力）
const printIssueDate = (() => { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` })()
// 宛先（請求先＝アカウント名 御中）
const accountName = ref<string | null>(null)
// PDF出力モード: 明細(全経費) / 請求書(個人立替のみ)。liff の全経費/立替分と同じ2モード。
// ── 科目での絞り込み（2026-08-10 運用者要望）──
//  ★表示だけでなく合計とPDFの中身も必ず追随させる。ここがズレると
//   「旅費交通費だけのPDF」に全体の合計が乗って、受け取った側が金額を誤認する。
const acctFilter = ref<Set<string>>(new Set())
function toggleAcct(a: string) {
  const next = new Set(acctFilter.value)
  next.has(a) ? next.delete(a) : next.add(a)
  acctFilter.value = next
}
/** その作業員×期に実在する科目だけを選択肢に出す（EXPENSE_ACCOUNT_OPTIONS の順に並べる） */
const availableAccounts = computed<string[]>(() => {
  const present = new Set((selected.value?.details ?? []).map((d) => expenseAccountCategory(d)))
  const ordered = (EXPENSE_ACCOUNT_OPTIONS as readonly string[]).filter((a) => present.has(a))
  // 選択肢に無い科目（将来 account を自由入力した等）も落とさない
  const rest = [...present].filter((a) => !ordered.includes(a)).sort((x, y) => x.localeCompare(y, 'ja'))
  return [...ordered, ...rest]
})
const PAYEE_NONE = '（支払先なし）'
const payeeFilter = ref<Set<string>>(new Set())
function togglePayee(p: string) {
  const next = new Set(payeeFilter.value)
  next.has(p) ? next.delete(p) : next.add(p)
  payeeFilter.value = next
}
const availablePayees = computed<string[]>(() => {
  const set = new Set<string>()
  for (const d of (selected.value?.details ?? [])) set.add(d.payee || PAYEE_NONE)
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'))
})
const filteredDetails = computed<ExpenseRow[]>(() => {
  const rows = selected.value?.details ?? []
  // 科目・支払先は独立フィルタで AND 条件（どちらも未選択なら従来どおり全件）
  return rows.filter((d) =>
    (!acctFilter.value.size || acctFilter.value.has(expenseAccountCategory(d))) &&
    (!payeeFilter.value.size || payeeFilter.value.has(d.payee || PAYEE_NONE)),
  )
})
const filteredTotal        = computed(() => filteredDetails.value.reduce((s, d) => s + (Number(d.amount) || 0), 0))
const filteredTategaeTotal = computed(() => filteredDetails.value.filter((d) => d.tategae).reduce((s, d) => s + (Number(d.amount) || 0), 0))

const printMode = ref<'meisai' | 'seikyu'>('meisai')
// モーダルを開き直すたびに明細モードへリセット（前回の請求書モードを持ち越さない）
watch(selected, () => { printMode.value = 'meisai'; acctFilter.value = new Set(); payeeFilter.value = new Set() })
async function printExpenseDoc(mode: 'meisai' | 'seikyu') {
  printMode.value = mode
  await nextTick()
  window.print()
}

const STATUS_CLASS: Record<SettlementStatus, string> = {
  '未申請': 'todo', '申請中': 'applied', '差し戻し': 'rejected', '期限超過': 'expired', '支払い済み': 'paid',
}
function halfOf(date: string): 'first' | 'second' { return Number(date.slice(8, 10)) <= 15 ? 'first' : 'second' }

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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

async function load() {
  loading.value = true
  selected.value = null
  const accountId = await getAccountId()
  if (!accountName.value) accountName.value = await getAccountName()

  const ym = dateFrom.value.slice(0, 7)            // YYYY-MM
  const periodKeys = [`${ym}-first`, `${ym}-second`]

  const [{ data: cfg }, { data: reports }, { data: settles }, { data: personal }, { data: userRows }] = await Promise.all([
    supabase.from('settings').select('key, value').eq('account_id', accountId),
    supabase
      .from('daily_reports')
      .select('date, sites, gasoline_items, user_id, users(real_name, worker_id, workers(name))')
      .eq('account_id', accountId)
      .eq('is_working', true)
      .gte('date', dateFrom.value)
      .lte('date', dateTo.value)
      .order('date', { ascending: true })
      .limit(5000), // 1ヶ月×全作業員で1000件超→一部の日が溢れて欠落するため余裕を持たせる
    supabase.from('expense_settlements').select('*').eq('account_id', accountId).in('period_key', periodKeys),
    // 現場に紐付かない個人経費（日報を出さない役員等の分）。個人立替を精算するのでここにも合流させる。
    supabase.from('personal_expenses')
      .select('id, worker_id, date, account_category, amount, payee, registration_number, companions, note, file_urls, tategae, workers(name)')
      .eq('account_id', accountId)
      .gte('date', dateFrom.value).lte('date', dateTo.value)
      .order('date', { ascending: true }).limit(5000),
    // 個人経費は worker_id 基準・精算行は users.id 基準なので対応表を引く
    supabase.from('users').select('id, worker_id').eq('account_id', accountId),
  ])

  const rates = ratesFromSettings(cfg)
  const settleMap: Record<string, any> = {}
  for (const s of (settles ?? []) as any[]) settleMap[`${s.user_id}|${s.period_key}`] = s

  // (userId|periodKey) ごとに集計
  const byKey: Record<string, PeriodRow> = {}
  const ensure = (userId: string, workerName: string, periodKey: string): PeriodRow => {
    const key = `${userId}|${periodKey}`
    return byKey[key] ??= {
      key, userId, workerName, periodKey,
      shortLabel: periodKey.endsWith('first') ? '前半' : '後半',
      count: 0, total: 0, tategaeTotal: 0, details: [],
      settlement: null, status: '未申請', statusLabel: '未申請', statusClass: 'todo',
    }
  }

  for (const rep of (reports ?? []) as any[]) {
    const userId = rep.user_id
    if (!userId) continue
    const workerName = rep.users?.workers?.name ?? rep.users?.real_name ?? '—'
    for (const row of flattenReportExpenses(rep.date, rep.sites ?? [], rates)) {
      // 車両の距離按分「ガソリン代/軽油代」は現場別集計(内部原価)への配賦＝作業員への精算には含めない（実費は下で加算）
      if (row.category === 'ガソリン代' || row.category === '軽油代') continue
      const pr = ensure(userId, workerName, `${ym}-${halfOf(row.date)}`)
      pr.count += 1
      pr.total += row.amount
      if (row.tategae) pr.tategaeTotal += row.amount
      pr.details.push(row)
    }
    // 日報レベルの「本日のガソリン代」（複数給油）を立替明細として加算（按分は別・ここは作業員への精算分）
    // ★共有関数を使う。以前はここで手組みしており liters と note を入れ忘れていたため、
    //   経費管理と請求書PDFの ℓ列・内訳が常に空になっていた（2026-07-30 修正）。
    for (const row of flattenGasolineItems(rep.date, rep.gasoline_items)) {
      const pr = ensure(userId, workerName, `${ym}-${halfOf(rep.date)}`)
      pr.count += 1
      pr.total += row.amount
      if (row.tategae) pr.tategaeTotal += row.amount
      pr.details.push(row)
    }
  }

  // 現場に紐付かない個人経費を同じ精算行に合流（日報が無い作業員でも精算対象になる）
  const userIdByWorker = new Map<string, string>()
  for (const u of ((userRows ?? []) as any[])) if (u.worker_id) userIdByWorker.set(u.worker_id, u.id)
  const orphanWorkers = new Set<string>()
  for (const row of flattenPersonalExpenses(personal as any)) {
    const rec = ((personal ?? []) as any[]).find((p) => p.id === row.personalExpenseId)
    const workerId = rec?.worker_id
    const userId = workerId ? userIdByWorker.get(workerId) : undefined
    if (!userId) { if (workerId) orphanWorkers.add(rec?.workers?.name ?? workerId); continue }
    const pr = ensure(userId, rec?.workers?.name ?? '—', `${ym}-${halfOf(row.date)}`)
    pr.count += 1
    pr.total += row.amount
    if (row.tategae) pr.tategaeTotal += row.amount
    pr.details.push(row)
  }
  // users 行が無い作業員の個人経費は精算行に紐付けられない（黙って落とさず気づけるようにする）
  if (orphanWorkers.size) {
    console.warn('[expenses] users行が無いため精算に合流できない個人経費の作業員:', [...orphanWorkers].join(', '))
  }

  // 経費が無くても settlement がある期は行を作る（差し戻し等の追跡）
  for (const s of (settles ?? []) as any[]) {
    ensure(s.user_id, '—', s.period_key)
  }

  // settlement と実効ステータスを付与（作業員名は settlement だけの行用に補完）
  const now = new Date()
  const nameById: Record<string, string> = {}
  for (const r of Object.values(byKey)) nameById[r.userId] = r.workerName
  if (Object.values(byKey).some(r => r.workerName === '—')) {
    const ids = [...new Set(Object.values(byKey).map(r => r.userId))]
    const { data: us } = await supabase.from('users').select('id, real_name, workers(name)').in('id', ids)
    for (const u of (us ?? []) as any[]) nameById[u.id] = u.workers?.name ?? u.real_name ?? '—'
  }
  for (const r of Object.values(byKey)) {
    r.workerName = nameById[r.userId] ?? r.workerName
    r.settlement = settleMap[`${r.userId}|${r.periodKey}`] ?? null
    r.status = effectiveStatus(r.settlement, r.periodKey, now)
    // 支払い済みは区分を併記（旧データ=区分なしは「支払済」のみにフォールバック）
    r.statusLabel = r.status === '支払い済み' && r.settlement?.payment_method
      ? `支払済（${r.settlement.payment_method}）`
      : r.status
    r.statusClass = STATUS_CLASS[r.status]
  }

  rows.value = Object.values(byKey)
    .filter(r => r.count > 0 || r.settlement)
    .sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja') || a.periodKey.localeCompare(b.periodKey))
  loading.value = false
}

// ---------- 差し戻し ----------
const rejectTarget = ref<PeriodRow | null>(null)
const rejectReason = ref('')
const rejecting    = ref(false)
const rejectError  = ref('')

function openReject(row: PeriodRow) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectError.value = ''
}

async function doReject() {
  if (!rejectTarget.value) return
  if (!rejectReason.value.trim()) { rejectError.value = '差し戻し理由を入力してください'; return }
  rejecting.value = true
  rejectError.value = ''
  try {
    const accountId = await getAccountId()
    const t = rejectTarget.value
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('expense_settlements')
      .update({ status: '差し戻し', reject_reason: rejectReason.value.trim(), rejected_at: now, updated_at: now })
      .eq('account_id', accountId)
      .eq('user_id', t.userId)
      .eq('period_key', t.periodKey)
    if (error) throw error

    // ★差し戻したことを本人に届ける。これが無いと、作業員は経費PDFの画面を
    //  自分で開いて該当期を選ばない限り気づけない（締切アラート期間を過ぎると
    //  ホームにも出ない）。通知の失敗で差し戻し自体を巻き戻さない。
    const wid = await workerIdOfUser(accountId, t.userId)
    if (wid) {
      await notifyWorker({
        accountId, workerId: wid, kind: 'expense_reject',
        title: `${t.periodKey} の経費申請が差し戻されました`,
        body: `理由: ${rejectReason.value.trim()}\n内容を直して再申請してください。`,
        linkPath: '/expense/download',
      })
    }

    rejectTarget.value = null
    selected.value = null
    await load()
  } catch (e: any) {
    rejectError.value = '差し戻しに失敗しました: ' + (e?.message ?? '')
  } finally {
    rejecting.value = false
  }
}

// ---------- 支払い済みにする ----------
const todayStr = new Date().toISOString().slice(0, 10)
const payTarget = ref<PeriodRow | null>(null)
const payMethod = ref('')
const payDate   = ref(todayStr)
const paying    = ref(false)
const payError  = ref('')

function openPay(row: PeriodRow) {
  payTarget.value = row
  payMethod.value = row.settlement?.payment_method ?? ''
  payDate.value   = row.settlement?.paid_on ?? todayStr
  payError.value  = ''
}

async function doPay() {
  if (!payTarget.value) return
  if (!payMethod.value || !payDate.value) { payError.value = '支払い区分と支払日を入力してください'; return }
  paying.value = true
  payError.value = ''
  try {
    const accountId = await getAccountId()
    const t = payTarget.value
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('expense_settlements')
      .update({ status: '支払い済み', payment_method: payMethod.value, paid_on: payDate.value, updated_at: now })
      .eq('account_id', accountId)
      .eq('user_id', t.userId)
      .eq('period_key', t.periodKey)
    if (error) throw error
    payTarget.value = null
    selected.value = null
    await load()
  } catch (e: any) {
    payError.value = '支払い確定に失敗しました: ' + (e?.message ?? '')
  } finally {
    paying.value = false
  }
}

// ---------- 取消（支払い済み → 申請中） ----------
const undoTarget = ref<PeriodRow | null>(null)
const undoing    = ref(false)

function undoPaid(row: PeriodRow) { undoTarget.value = row }

async function doUndoPaid() {
  if (!undoTarget.value) return
  undoing.value = true
  try {
    const accountId = await getAccountId()
    const t = undoTarget.value
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('expense_settlements')
      .update({ status: '申請中', payment_method: null, paid_on: null, updated_at: now })
      .eq('account_id', accountId)
      .eq('user_id', t.userId)
      .eq('period_key', t.periodKey)
    if (error) throw error
    undoTarget.value = null
    selected.value = null
    await load()
  } finally {
    undoing.value = false
  }
}

// ---------- 救済（期限超過 → 未申請） ----------
// 期限超過は行なしで導出されるため UPDATE ではなく upsert（行を新規作成）。
// status='未申請' を保存することで締切超過でも未申請として扱われ、作業員が再申請できる。
const rescueTarget = ref<PeriodRow | null>(null)
const rescuing     = ref(false)

function rescueOverdue(row: PeriodRow) { rescueTarget.value = row }

async function doRescue() {
  if (!rescueTarget.value) return
  rescuing.value = true
  try {
    const accountId = await getAccountId()
    const t = rescueTarget.value
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('expense_settlements')
      .upsert({
        account_id: accountId, user_id: t.userId, period_key: t.periodKey,
        status: '未申請', applied_at: null, pdf_path: null,
        reject_reason: null, rejected_at: null, payment_method: null, paid_on: null,
        notified_at: null, updated_at: now,
      }, { onConflict: 'account_id,user_id,period_key' })
    if (error) throw error
    rescueTarget.value = null
    selected.value = null
    await load()
  } finally {
    rescuing.value = false
  }
}

// ── 科目別 月次集計（科目×月のクロス集計・直近12ヶ月）#6bba03b2 ──
//  会計向けの俯瞰ビュー。行=科目 / 列=直近12ヶ月 / セル=月合計 / 行末=年計（表示12ヶ月の合計）。
//  集計元は現場経費（日報の sites[].expenses と本日のガソリン代）＋個人経費を科目別に合算。
//  ★車両の距離按分（category='ガソリン代'/'軽油代'＝内部原価の配賦）は実費でないため除外。
//   これは作業員精算(load)が精算対象から外しているのと同じ扱い。
//  表示のみ・DBへの書込みは無い。重いので開いた時だけ遅延ロードする。
const showCrossTab = ref(false)
const crossLoading = ref(false)
const crossData    = ref<Record<string, Record<string, number>>>({})

// 対象月を末尾に置いた直近12ヶ月の 'YYYY-MM' 配列（古い→新しい）
const crossMonths = computed<string[]>(() => {
  const out: string[] = []
  const base = new Date(baseDate.value); base.setDate(1)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base); d.setMonth(d.getMonth() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
})
const currentMonthKey = computed(() => dateFrom.value.slice(0, 7))
function monthShort(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y.slice(2)}/${Number(m)}`
}

async function loadCrossTab() {
  crossLoading.value = true
  try {
    const accountId = await getAccountId()
    const months = crossMonths.value
    const from = `${months[0]}-01`
    const [ly, lm] = months[months.length - 1].split('-').map(Number)
    const lastDay = new Date(ly, lm, 0).getDate()          // 末月の末日
    const to = `${ly}-${String(lm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const [{ data: cfg }, { data: reports }, { data: personal }] = await Promise.all([
      supabase.from('settings').select('key, value').eq('account_id', accountId),
      supabase.from('daily_reports')
        .select('date, sites, gasoline_items')
        .eq('account_id', accountId)
        .eq('is_working', true)
        .gte('date', from).lte('date', to)
        .order('date', { ascending: true })
        .limit(20000),
      supabase.from('personal_expenses')
        .select('id, worker_id, date, account_category, amount, payee, registration_number, companions, note, file_urls, tategae')
        .eq('account_id', accountId)
        .gte('date', from).lte('date', to)
        .limit(20000),
    ])

    const rates = ratesFromSettings(cfg)
    const acc: Record<string, Record<string, number>> = {}
    const add = (account: string, ym: string, amount: number) => {
      const byMonth = (acc[account] ??= {})
      byMonth[ym] = (byMonth[ym] || 0) + amount
    }
    for (const rep of (reports ?? []) as any[]) {
      for (const row of flattenReportExpenses(rep.date, rep.sites ?? [], rates)) {
        if (row.category === 'ガソリン代' || row.category === '軽油代') continue  // 距離按分(内部原価)は除外
        add(expenseAccountCategory(row), expenseMonthKey(row.date), row.amount)
      }
      for (const row of flattenGasolineItems(rep.date, rep.gasoline_items)) {
        add(expenseAccountCategory(row), expenseMonthKey(row.date), row.amount)
      }
    }
    for (const row of flattenPersonalExpenses(personal as any)) {
      add(expenseAccountCategory(row), expenseMonthKey(row.date), row.amount)
    }
    crossData.value = acc
  } finally {
    crossLoading.value = false
  }
}

// 行=科目（EXPENSE_ACCOUNT_OPTIONS 順・未知科目は後ろ）。年計>0 の科目だけ出す。
const crossRows = computed(() => {
  const acc = crossData.value
  const present = Object.keys(acc)
  const ordered = (EXPENSE_ACCOUNT_OPTIONS as readonly string[]).filter((a) => present.includes(a))
  const rest = present.filter((a) => !ordered.includes(a)).sort((x, y) => x.localeCompare(y, 'ja'))
  const months = crossMonths.value
  return [...ordered, ...rest]
    .map((account) => {
      const byMonth = acc[account] || {}
      const total = months.reduce((s, m) => s + (byMonth[m] || 0), 0)
      return { account, byMonth, total }
    })
    .filter((r) => r.total > 0)
})
const crossColTotals = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const m of crossMonths.value) out[m] = crossRows.value.reduce((s, r) => s + (r.byMonth[m] || 0), 0)
  return out
})
const crossGrandTotal = computed(() => crossRows.value.reduce((s, r) => s + r.total, 0))

function toggleCrossTab() {
  showCrossTab.value = !showCrossTab.value
  if (showCrossTab.value) loadCrossTab()
}
// 対象月を動かしたら（開いていれば）12ヶ月窓もその月末基準で引き直す
watch(dateFrom, () => { if (showCrossTab.value) loadCrossTab() })

onMounted(load)
watch(dateFrom, load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.note { font-size: 13px; color: #555; margin: 0 0 16px; }
.empty { color: #888; padding: 60px; text-align: center; }

.table-wrap { background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 14px; border-bottom: 1px solid #eee; text-align: left; }
.table thead th { background: #fafafa; font-weight: 700; font-size: 12px; color: #666; position: sticky; top: 0; z-index: 2;}
.table .num { text-align: right; }
.worker-cell { font-weight: 600; }
.period-chip { display: inline-block; padding: 2px 10px; border-radius: 6px; background: #eef1f5; color: #445; font-size: 12px; font-weight: 600; }
.data-row { cursor: pointer; }
.data-row:hover { background: #f7f7f7; }
.chevron { color: #bbb; text-align: right; }
.total-row td { font-weight: 700; background: #fafafa; border-top: 2px solid #ddd; }

.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.st-todo     { background: #fff7e6; color: #b26a00; }
.st-applied  { background: #e6f7ed; color: #1a8a4d; }
.st-rejected { background: #fdeaea; color: #c0392b; }
.st-expired  { background: #f0f0f0; color: #999; }
.st-paid     { background: #e8f0fe; color: #1a56c4; }

.filter-bar { display: flex; gap: 8px; margin-bottom: 14px; }
.filter-btn { background: #f0f0f0; border: none; border-radius: 999px; padding: 6px 16px; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; }
.filter-btn.active { background: #1a1a1a; color: #fff; }
.filter-badge { display: inline-block; margin-left: 6px; background: #ef4444; color: #fff; border-radius: 999px; padding: 0 7px; font-size: 11px; }

.muted { color: #999; }
.date-cell { white-space: nowrap; }

/* 申請状況（モーダル内） */
.settle-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; background: #fafafa; border-radius: 8px; margin-bottom: 6px; }
.settle-pay { font-size: 13px; color: #1a8a4d; }
.settle-pay strong { font-size: 17px; font-weight: 800; margin-left: 4px; }
.settle-amt { font-size: 12px; color: #888; }
.settle-reason { font-size: 12px; color: #c0392b; flex-basis: 100%; }
.settle-hint { font-size: 11px; color: #999; margin: 0 0 16px; }
.pdf-row { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; flex-wrap: wrap; }
.pdf-label { font-size: 12px; color: #888; font-weight: 700; }
.pdf-link { display: inline-block; font-size: 13px; color: #1a56c4; text-decoration: none; border: 1px solid #cdd8f0; border-radius: 6px; padding: 4px 12px; }
.pdf-link:hover { background: #f0f4ff; }
.receipt-cell { white-space: nowrap; }
.receipt-link { display: inline-block; font-size: 13px; color: #1a56c4; text-decoration: none; margin: 0 3px; }
.btn-reject { margin-left: auto; background: #fff; border: 1px solid #f5c0bb; color: #c0392b; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-reject:hover { background: #fdeaea; }
.btn-pay { background: #fff; color: #06951f; border: 1px solid #9bd9ad; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-pay:hover { background: #f1faf3; border-color: #06C755; }
.btn-rescue { margin-left: auto; background: #fff; color: #b26a00; border: 1px solid #f0cd8a; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-rescue:hover { background: #fff7e6; }
.btn-status-link { margin-left: auto; background: none; border: none; color: #aaa; font-size: 12px; text-decoration: underline; cursor: pointer; padding: 0; }
.settle-paid-info { font-size: 12px; color: #1a56c4; }

/* 差し戻しモーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { background: #fff; border-radius: 12px; max-width: 760px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-head h2 { font-size: 16px; font-weight: 700; }
.modal-close { background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer; color: #888; }
.modal-body { overflow-y: auto; padding: 8px 20px 20px; }
.detail-table { font-size: 13px; }
.reject-modal { max-width: 480px; }
.reject-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.reject-textarea { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 10px; font-size: 14px; font-family: inherit; resize: vertical; box-sizing: border-box; }
.reject-error { color: #c0392b; font-size: 13px; margin-top: 8px; }
.reject-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; }
.btn-reject-confirm { background: #c0392b; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-reject-confirm:disabled { opacity: .6; cursor: default; }

/* 支払い／取消ダイアログ（confirm-box） */
.confirm-overlay { z-index: 200; }
.confirm-box { background: #fff; border-radius: 12px; padding: 22px 22px 16px; max-width: 380px; width: 100%; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
.confirm-msg { font-size: 14px; line-height: 1.6; color: #222; white-space: pre-line; margin-bottom: 16px; }
.pay-label { display: block; font-size: 12px; font-weight: 600; color: #666; margin: 10px 0 4px; }
.pay-input { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; box-sizing: border-box; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.btn-confirm-ok { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 20px; font-weight: 700; cursor: pointer; }
.btn-confirm-ok.danger { background: #c0392b; }
.btn-confirm-ok:disabled { opacity: .6; cursor: default; }

/* 科目の絞り込み */
.acct-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 8px; }
.af-label { font-size: 12px; font-weight: 700; color: #888; margin-right: 2px; }
.af-chip { font-size: 12px; border: 1px solid #d0d0d0; background: #fff; color: #475569; border-radius: 999px; padding: 3px 12px; cursor: pointer; }
.af-chip:hover { background: #f5f5f5; }
.af-chip.on { background: #06C755; border-color: #06C755; color: #fff; font-weight: 700; }
.af-clear { font-size: 12px; border: 1px solid #d0d0d0; background: #fff; color: #555; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.af-count { font-size: 12px; color: #888; font-variant-numeric: tabular-nums; }
.acct-filter-note { font-size: 11px; color: #444; margin: 0 0 6px; }

/* PDF出力ボタン・詳細合計 */
.modal-head-actions { display: flex; align-items: center; gap: 8px; }
.btn-pdf { background: #0ea5e9; color: #fff; border: none; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-pdf:hover { background: #0284c7; }
.btn-pdf-seikyu { background: #7c3aed; }
.btn-pdf-seikyu:hover { background: #6d28d9; }
.detail-total-row td { font-weight: 700; border-top: 2px solid #333; padding: 8px 10px; }
.detail-total-row .right { text-align: right; }

/* 印刷/PDF出力（liff /expense/print と同じ印刷CSS方式） */
.print-only { display: none; }
.print-doc-head { margin-bottom: 14px; }
.print-doc-title { font-size: 22px; font-weight: 800; letter-spacing: 6px; text-align: center; margin: 0 0 12px; }
.print-doc-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.print-doc-left { flex: 1; min-width: 0; }
.print-addressee { font-size: 18px; font-weight: 700; letter-spacing: 1px; border-bottom: 1px solid #111; display: inline-block; padding-bottom: 2px; margin-bottom: 8px; }
.print-lead { font-size: 12px; color: #111; }
.print-doc-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 13px; flex-shrink: 0; }
.print-doc-name { font-weight: 700; font-size: 15px; margin-top: 4px; }
@media print {
  /* 画面の全要素を隠し、開いている明細モーダルだけをドキュメントとして印刷する */
  body * { visibility: hidden; }
  .modal-overlay, .modal-overlay * { visibility: visible; }
  .modal-overlay { position: absolute; inset: 0; background: #fff; display: block; padding: 0; }
  .modal { box-shadow: none; max-width: 100%; width: 100%; max-height: none; border-radius: 0; }
  .modal-body { padding: 12px 4px !important; overflow: visible !important; }
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  .pdf-hide-row { display: none !important; }   /* 請求書(立替のみ)で非立替行を隠す */
  .detail-table { font-size: 10px; }
  /* 行の縦幅のバラつき対策（2026-08-22）：上揃えで基準を合わせ、折返しの無い列（日付・数量・金額）は
     nowrap で1行に固定して不要な改行を防ぐ。品名・支払先など長文列は可読性のため折返しは許容する。 */
  .detail-table th, .detail-table td { padding: 4px 6px !important; vertical-align: top; }
  .detail-table td.date-cell, .detail-table td.num { white-space: nowrap; }
  .receipt-link { text-decoration: none; }
}

/* 科目別 月次集計（クロス集計）#6bba03b2 */
.crosstab { margin-top: 20px; }
.crosstab-toggle { display: inline-flex; align-items: center; gap: 6px; background: #f5f7fa; border: 1px solid #e2e6ec; border-radius: 10px; padding: 9px 16px; font-size: 14px; font-weight: 700; color: #334; cursor: pointer; }
.crosstab-toggle:hover { background: #eef1f5; }
.ct-ico { font-size: 18px; line-height: 1; }
.ct-caret { font-size: 18px; line-height: 1; color: #889; }
.crosstab-body { margin-top: 12px; }
.crosstab-wrap { max-height: none; }
.crosstab-table { font-size: 13px; white-space: nowrap; }
.crosstab-table .ct-acct { font-weight: 600; position: sticky; left: 0; background: #fff; z-index: 1; }
.crosstab-table thead .ct-acct { z-index: 3; background: #fafafa; }
.crosstab-table .ct-total { font-weight: 700; background: #fafafa; }
.crosstab-table .ct-cur { background: #f0f6ff; }
.crosstab-table .total-row td { font-weight: 700; background: #fafafa; border-top: 2px solid #ddd; }
.crosstab-table .total-row .ct-acct { background: #fafafa; }
</style>
