<template>
  <div>
    <!-- ── 画面ヘッダー（印刷非表示） ── -->
    <div class="page-header no-print">
      <h1 class="page-title">有給管理</h1>
      <div class="header-actions">
        <select v-model.number="printYear" class="year-select">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年度</option>
        </select>
        <button class="btn-print" @click="doPrint">管理簿を印刷</button>
      </div>
    </div>

    <div v-if="loading" class="loading no-print">読み込み中...</div>
    <div v-else>

      <!-- 自動付与の通知（開いた時に基準日到来分を自動付与＝A方式）。誤りは詳細から修正可。 -->
      <div v-if="autoGrantNotice" class="autogrant-notice no-print" data-testid="autogrant-notice">
        <span class="material-symbols-rounded" style="font-size:18px;vertical-align:middle;line-height:1">check_circle</span>
        <span class="autogrant-text">{{ autoGrantNotice }}</span>
        <button class="notice-close" aria-label="閉じる" @click="autoGrantNotice = ''"><span class="material-symbols-rounded" style="font-size:16px;line-height:1">close</span></button>
      </div>
      <!-- 未付与が残る場合の手動フォールバック（自動付与が権限/エラーで走らなかった時のみ表示） -->
      <div v-if="canViewHourlyWage && !autoGrantNotice && pendingWorkers.length" class="pending-banner no-print" data-testid="pending-banner">
        <span class="pending-badge"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">schedule</span> 付与待ち {{ pendingWorkers.length }}人</span>
        <span class="pending-text">基準日を過ぎた未付与の有給があります。</span>
        <button class="btn-batch-grant" :disabled="batchGranting" data-testid="batch-grant" @click="batchGrantPending">{{ batchGranting ? '付与中…' : 'まとめて法令付与' }}</button>
      </div>

      <!-- 在籍/退職・無効 の絞り込みタブ（業務委託は有給の概念が無いため一覧・集計から除外） -->
      <div class="status-tabs no-print">
        <button class="status-tab" :class="{ active: leaveTab === 'active' }" @click="leaveTab = 'active'">在籍<span class="tab-count">{{ tabCounts.active }}</span></button>
        <button class="status-tab" :class="{ active: leaveTab === 'inactive' }" @click="leaveTab = 'inactive'">退職・無効<span class="tab-count">{{ tabCounts.inactive }}</span></button>
      </div>

      <!-- ── 画面: サマリーテーブル（印刷非表示） ── -->
      <div class="table-wrap no-print">
        <table class="table">
          <thead>
            <tr>
              <th>名前</th>
              <th>雇用形態</th>
              <th>入社日</th>
              <th>付与済（有効）</th>
              <th>基準期間 使用</th>
              <th>残日数</th>
              <th>義務5日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredWorkers.length"><td colspan="8" class="empty">該当する作業員がいません</td></tr>
            <tr v-for="w in filteredWorkers" :key="w.id" :class="{ inactive: !w.active }">
              <td class="name">{{ w.name }}</td>
              <td>
                <span class="emp-badge" :class="w.employment_type ?? 'fulltime'">
                  {{ w.employment_type === 'contractor' ? '業務委託' : (w.employment_type ?? 'fulltime') === 'fulltime' ? '正社員' : 'パート' }}
                </span>
              </td>
              <td class="mono">{{ w.hire_date ?? '—' }}</td>
              <td class="mono">
                {{ w.totalGranted > 0 ? w.totalGranted + ' 日' : '—' }}
                <span v-if="canViewHourlyWage && w.pendingCount > 0" class="pending-row-badge" :title="`未付与の基準日が${w.pendingCount}件あります`">付与待ち{{ w.pendingCount }}</span>
              </td>
              <td class="mono">{{ w.duty.usedInPeriod }} 日</td>
              <td>
                <span class="remaining" :class="remainingClass(w.remaining)">
                  {{ w.remaining >= 0 ? w.remaining + ' 日' : '計算不可' }}
                </span>
              </td>
              <td>
                <template v-if="w.duty.isSubject">
                  <span class="duty-badge" :class="w.duty.isMet ? 'ok' : 'ng'">
                    {{ w.duty.isMet ? '達成' : `あと ${w.duty.remaining} 日` }}
                  </span>
                  <div class="duty-deadline">期限: {{ w.duty.deadline }}</div>
                </template>
                <span v-else class="duty-na">対象外</span>
              </td>
              <td class="actions">
                <button class="btn-detail" @click="openDetail(w)">詳細・付与</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── 詳細ドロワー（印刷非表示） ── -->
      <div v-if="detail" class="drawer-overlay no-print" @click.self="detail = null">
        <div class="drawer">
          <div class="drawer-head">
            <div>
              <div class="drawer-name">{{ detail.name }}</div>
              <div class="drawer-sub">
                {{ detail.employment_type === 'contractor' ? '業務委託' : (detail.employment_type ?? 'fulltime') === 'fulltime' ? '正社員' : `パート(週${detail.weekly_scheduled_days ?? '?'}日)` }}
                <template v-if="detail.hire_date"> ・ 入社 {{ detail.hire_date }}</template>
                <span v-else class="hire-missing">・ 入社日未設定</span>
              </div>
            </div>
            <button class="btn-close" @click="detail = null">✕</button>
          </div>

          <!-- ① 残高（読み取り最優先・残日数を強調） -->
          <div class="balance-summary">
            <div class="balance-card">
              <div class="balance-label">付与合計（有効期限内）</div>
              <div class="balance-val">{{ detail.totalGranted }} 日</div>
            </div>
            <div class="balance-card">
              <div class="balance-label">使用済み（全期間）</div>
              <div class="balance-val">{{ detail.totalUsed }} 日</div>
              <div v-if="detail.initialUsed > 0" class="balance-sub">うち導入前 {{ detail.initialUsed }} 日</div>
            </div>
            <div class="balance-card highlight">
              <div class="balance-label">残日数</div>
              <div class="balance-val">{{ detail.remaining >= 0 ? detail.remaining + ' 日' : '—' }}</div>
            </div>
          </div>

          <!-- ② 付与する（主アクション＝法令の自動付与）＝付与操作は役員経理以上のみ -->
          <div class="section-title">有給を付与する</div>
          <div v-if="!canViewHourlyWage" class="info-note">有給の付与操作は役員・経理以上の権限者のみ行えます（閲覧のみ可）。</div>
          <template v-else-if="detail.employment_type === 'contractor'"><div class="info-note">業務委託は年次有給の付与対象外です。</div></template>
          <template v-else>
            <div v-if="detail.hire_date" class="auto-grant-panel">
              <div class="auto-grant-lead">
                <span class="auto-grant-ref">法令の付与日数 <b>{{ suggestedGrant(detail) }} 日</b><span class="ref-note">（勤続 {{ tenureMonths(detail.hire_date) }} ヶ月）</span></span>
              </div>
              <template v-if="detail.pendingCount > 0">
                <button type="button" class="btn-auto-grant" :disabled="grantSaving" data-testid="auto-grant" @click="autoGrantFromHireDate(detail)">
                  <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">calendar_month</span> 未付与の基準日 {{ detail.pendingCount }}件 を付与
                </button>
                <div class="auto-grant-hint">入社日＋労基法スケジュールに基づく付与です（重複しません）。</div>
              </template>
              <div v-else class="auto-grant-done">
                <span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">check_circle</span>
                法令どおり付与済みです。次の基準日が来ると自動で付与されます。
              </div>
              <p v-if="grantError" class="grant-error">{{ grantError }}</p>
            </div>
            <div v-else class="info-note warn">
              入社日が未設定のため自動付与できません。下の<strong>「入社日・移行設定」</strong>で入社日を設定してください。
            </div>
          </template>

          <!-- 手動で付与（特別付与・調整・移行初期残高）＝折りたたみ・役員経理以上のみ -->
          <button v-if="canViewHourlyWage" type="button" class="collapse-toggle" data-testid="toggle-manual-grant" @click="showManualGrant = !showManualGrant">
            {{ showManualGrant ? '▾' : '▸' }} 手動で付与する（特別付与・手動調整・残日数の直接登録）
          </button>
          <div v-show="showManualGrant && canViewHourlyWage" class="grant-form">
            <div class="form-row">
              <div class="form-field">
                <label>付与日</label>
                <input v-model="newGrant.granted_at" type="date" class="input" />
              </div>
              <div class="form-field">
                <label>有効期限</label>
                <input v-model="newGrant.expires_at" type="date" class="input" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>付与日数</label>
                <input v-model.number="newGrant.days" type="number" step="0.5" min="0.5" class="input" placeholder="10" />
              </div>
              <div class="form-field">
                <label>備考</label>
                <input v-model="newGrant.note" class="input" placeholder="例: 2024年度付与 / 移行初期残高" />
              </div>
            </div>
            <p v-if="manualGrantOverlapWarning" class="grant-warning" data-testid="grant-overlap-warning">{{ manualGrantOverlapWarning }}</p>
            <button class="btn-grant" :disabled="grantSaving" @click="addGrant">
              {{ grantSaving ? '保存中...' : '付与を追加' }}
            </button>
            <p v-if="grantError && !showManualGrant" class="error">{{ grantError }}</p>
          </div>

          <!-- ③ 入社日・移行設定（折りたたみ・初期セットアップ用） -->
          <button type="button" class="collapse-toggle" data-testid="toggle-settings" @click="showSettings = !showSettings">
            {{ showSettings ? '▾' : '▸' }} <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">settings</span> 入社日・移行設定
          </button>
          <div v-show="showSettings" class="settings-panel">
            <div v-if="canViewHourlyWage" class="setting-field">
              <label class="setting-lbl">入社日</label>
              <div class="setting-row">
                <input v-model="hireDateInput" type="date" class="input setting-input" data-testid="hire-date-edit" />
                <button class="btn-setting-save" :disabled="savingHire || hireDateInput === (detail.hire_date ?? '')" data-testid="save-hire-date" @click="saveHireDate">{{ savingHire ? '保存中…' : '保存' }}</button>
              </div>
              <p class="setting-hint">自動付与の前提。役員・経理以上のみ編集できます。</p>
              <p v-if="hireError" class="grant-error">{{ hireError }}</p>
            </div>
            <div class="setting-field">
              <label class="setting-lbl">導入前に消化した有給（初期使用済み日数）</label>
              <div class="setting-row">
                <input v-model.number="initialUsedInput" type="number" min="0" step="0.5" class="input setting-input" data-testid="initial-used" />
                <span class="setting-unit">日</span>
                <button class="btn-setting-save" :disabled="savingUsed || initialUsedInput === detail.initialUsed" data-testid="save-initial-used" @click="saveInitialUsed">{{ savingUsed ? '保存中…' : '保存' }}</button>
              </div>
              <p class="setting-hint">システム導入前に取得済みの日数。残日数から控除（導入後はアプリが自動集計）。</p>
              <p v-if="usedError" class="grant-error">{{ usedError }}</p>
            </div>
            <div v-if="detail.excludedDates.length" class="setting-field">
              <label class="setting-lbl">自動付与から除外中の基準日</label>
              <div v-for="d in detail.excludedDates" :key="d" class="excluded-row">
                <span class="mono">{{ d }}</span>
                <button class="btn-unexclude" data-testid="unexclude" :disabled="grantMutating" @click="unexcludeDate(d)">除外解除</button>
              </div>
              <p class="setting-hint">削除で除外した基準日。解除すると再び法令の自動付与対象になります。</p>
            </div>
          </div>

          <div class="section-title">付与履歴</div>
          <div v-if="detailGrants.length === 0" class="empty">付与記録がありません</div>
          <table v-else class="sub-table">
            <thead>
              <tr><th>付与日</th><th>日数</th><th>有効期限</th><th>状態</th><th>備考</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="g in detailGrants" :key="g.id" :class="{ expired: isExpired(g.expires_at) }">
                <td class="mono">{{ g.granted_at }}</td>
                <td class="mono">{{ g.days }} 日</td>
                <td class="mono">{{ g.expires_at }}</td>
                <td><span class="exp-badge" :class="isExpired(g.expires_at) ? 'expired' : 'valid'">{{ isExpired(g.expires_at) ? '期限切れ' : '有効' }}</span></td>
                <td class="note-cell">{{ g.note ?? '—' }}</td>
                <td><button v-if="canViewHourlyWage" class="btn-del" :disabled="grantMutating" @click="deleteGrant(g)">削除</button></td>
              </tr>
            </tbody>
          </table>

          <div class="section-title">使用履歴</div>
          <div v-if="detailUsage.length === 0" class="empty">使用記録がありません</div>
          <table v-else class="sub-table">
            <thead><tr><th>日付</th><th>備考</th></tr></thead>
            <tbody>
              <tr v-for="u in detailUsage" :key="u.date">
                <td class="mono">{{ u.date }}</td>
                <td class="note-cell">{{ u.note ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── 印刷専用: 年次有給休暇管理簿 ── -->
      <div class="print-only ledger">
        <div class="ledger-header">
          <div class="ledger-title">年次有給休暇管理簿</div>
          <div class="ledger-meta">
            <span>対象年度: {{ printYear }}年</span>
            <span>作成日: {{ today }}</span>
          </div>
        </div>

        <table class="ledger-table">
          <thead>
            <tr>
              <th class="col-name">氏名</th>
              <th class="col-hire">入社日</th>
              <th class="col-type">雇用形態</th>
              <th class="col-grant-date">基準日</th>
              <th class="col-grant-days">付与日数</th>
              <th class="col-dates">取得日</th>
              <th class="col-used">取得<br>日数</th>
              <th class="col-remaining">残日数</th>
              <th class="col-duty">5日義務</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in printRows" :key="row.workerId">
              <td class="col-name fw">{{ row.name }}</td>
              <td class="col-hire sm">{{ row.hireDate ?? '—' }}</td>
              <td class="col-type sm">{{ row.employmentType === 'contractor' ? '業務委託' : row.employmentType === 'fulltime' ? '正社員' : `パート\n(週${row.weeklyDays ?? '?'}日)` }}</td>
              <td class="col-grant-date sm">{{ row.latestGrantDate ?? '—' }}</td>
              <td class="col-grant-days center">{{ row.totalGranted > 0 ? row.totalGranted : '—' }}</td>
              <td class="col-dates dates-cell">{{ row.usedDates.join('　') || '—' }}</td>
              <td class="col-used center">{{ row.usedCount }}</td>
              <td class="col-remaining center fw">{{ row.remaining >= 0 ? row.remaining : '—' }}</td>
              <td class="col-duty center">
                <template v-if="row.duty.isSubject">
                  {{ row.duty.isMet ? '○達成' : `残${row.duty.remaining}日` }}
                  <div style="font-size:9px;color:#666;">〜{{ row.duty.deadline }}</div>
                </template>
                <template v-else>対象外</template>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="ledger-footer">
          ※ 付与日数は有効期限内（{{ printYear }}年内に有効）の合計。取得日は{{ printYear }}年中の有給取得日を記載。
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { canViewHourlyWage } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'
import { tenureMonths, suggestedGrantDays, pendingBaseDatesFor, fifoBalance } from '../lib/paidLeaveGrant'

// 法令付与計算は lib/paidLeaveGrant.ts（付与待ちバッジ navBadges と共用）。
function suggestedGrant(w: WorkerStat): number {
  return suggestedGrantDays(w.hire_date, w.employment_type, w.weekly_scheduled_days)
}

// PostgRESTは既定でmax_rows(既定1000)を超えると黙って切り詰める。
// 有給消化履歴は日付範囲で絞れない（account全期間が対象）ため、上限に達すると
// FIFO残日数計算が一部消化を見落として過大表示になる（2026-07-11・データ取得上限超過の横断調査で発覚）。
// .range()でページングして全件取得する。
async function fetchAllPaidLeaveReports(accountId: string): Promise<{ user_id: string; date: string; note: string | null }[]> {
  const PAGE = 1000
  const all: { user_id: string; date: string; note: string | null }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('user_id, date, note')
      .eq('account_id', accountId)
      .eq('leave_type', 'paid_leave')
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as any[]))
    if (!data || data.length < PAGE) break
  }
  return all
}

// ── 型定義 ────────────────────────────────────────────────────
type WorkerStat = {
  id: string
  name: string
  active: boolean
  hire_date: string | null
  employment_type: 'fulltime' | 'parttime' | 'contractor' | null
  weekly_scheduled_days: number | null
  initialUsed: number   // 導入前に既に消化した有給日数（控除）
  excludedDates: string[]  // 法令自動付与から恒久除外する基準日
  totalGranted: number
  totalUsed: number     // 初期使用済み ＋ システム使用の合計
  remaining: number
  pendingCount: number  // 未付与の基準日の件数（付与待ちバッジ用）
  duty: {
    isSubject: boolean   // 10日以上付与で義務対象
    isMet: boolean
    usedInPeriod: number
    remaining: number    // あと何日取ればよいか
    grantedAt: string | null  // 基準日
    deadline: string | null   // 義務期限（基準日+1年-1日）
  }
}

type Grant = {
  id: string
  worker_id: string
  granted_at: string
  expires_at: string
  days: number
  note: string | null
}

type UsageEntry = { date: string; note: string | null }

// ── State ────────────────────────────────────────────────────
const loading      = ref(true)
const workerStats  = ref<WorkerStat[]>([])
// 一覧の絞り込みタブ（業務委託は有給の概念が無い＝一覧・集計・印刷簿から除外。レビュー指摘⑨で2タブ化）
const leaveTab = ref<'active' | 'inactive'>('active')
const filteredWorkers = computed(() => workerStats.value.filter(w => {
  if (w.employment_type === 'contractor') return false
  return leaveTab.value === 'inactive' ? !w.active : w.active
}))
const tabCounts = computed(() => ({
  active:   workerStats.value.filter(w => w.active && w.employment_type !== 'contractor').length,
  inactive: workerStats.value.filter(w => !w.active && w.employment_type !== 'contractor').length,
}))
const detail       = ref<WorkerStat | null>(null)
const detailGrants = ref<Grant[]>([])
const detailUsage  = ref<UsageEntry[]>([])
const grantSaving  = ref(false)
const grantError   = ref('')
const initialUsedInput = ref(0)   // 初期使用済み日数の編集値
const savingUsed   = ref(false)
const usedError    = ref('')
const hireDateInput = ref('')   // 入社日の編集値
const savingHire   = ref(false)
const hireError    = ref('')
const showManualGrant = ref(false)   // 手動付与フォームの折りたたみ
const showSettings    = ref(false)   // 入社日・移行設定の折りたたみ

// 全作業員の使用履歴・付与履歴（印刷用）
const allUsageByWorker:  Record<string, UsageEntry[]> = {}
const allGrantsByWorker: Record<string, Grant[]>      = {}

const today     = new Date().toISOString().split('T')[0]
const thisYear  = new Date().getFullYear()
const printYear = ref(thisYear)

const yearOptions = computed(() => {
  const years = []
  for (let y = thisYear; y >= thisYear - 4; y--) years.push(y)
  return years
})

const newGrant = ref({ granted_at: today, expires_at: `${thisYear + 2}-${today.slice(5)}`, days: 10, note: '' })

// ── ヘルパー ─────────────────────────────────────────────────
function isExpired(expiresAt: string): boolean { return expiresAt < today }

// 手動付与の注意喚起（ブロックはしない・特別付与/移行残高等の正当なケースもあるため）:
// 有給は時効2年＝通常は同時に有効な付与が2件(当年+前年)を超えることは無い。
// この新規付与を加えると3件以上同時有効になる場合、意図しない重複登録の可能性を警告する
// （2026-07-11・実際に本番で1名だけ3件同時有効=60日になっていたケースが起点・[[project_sido]]）。
const manualGrantOverlapWarning = computed(() => {
  const g = newGrant.value
  if (!g.granted_at || !g.expires_at) return ''
  const validOthers = detailGrants.value.filter(x => !isExpired(x.expires_at))
  const willOverlap = validOthers.filter(x => x.granted_at <= g.expires_at && g.granted_at <= x.expires_at)
  const total = validOthers.length + 1
  if (willOverlap.length >= 2) {
    return `⚠ この付与を追加すると、同時に有効な付与が${total}件になります（通常は繰越込みで最大2件＝当年+前年）。誤って重複登録していないか確認してください。`
  }
  return ''
})

function remainingClass(days: number): string {
  if (days < 0)  return 'neg'
  if (days <= 5) return 'low'
  return 'ok'
}


// ── 印刷用データ ──────────────────────────────────────────────
const printRows = computed(() => {
  const yr = String(printYear.value)
  return workerStats.value.filter(w => w.employment_type !== 'contractor').map(w => {
    const grants  = allGrantsByWorker[w.id] ?? []
    // 選択年に有効な付与（付与日が選択年以前 かつ 有効期限が選択年以後）
    const validGrants = grants.filter(g => g.granted_at.slice(0, 4) <= yr && g.expires_at.slice(0, 4) >= yr)
    const totalGranted = validGrants.reduce((s, g) => s + Number(g.days), 0)
    const latestGrant  = validGrants.sort((a, b) => b.granted_at.localeCompare(a.granted_at))[0]

    const usage = (allUsageByWorker[w.id] ?? []).filter(u => u.date.startsWith(yr))
    const usedDates = usage.map(u => u.date.slice(5).replace('-', '/')).sort()  // MM/DD

    return {
      workerId:        w.id,
      name:            w.name,
      hireDate:        w.hire_date,
      employmentType:  w.employment_type ?? 'fulltime',
      weeklyDays:      w.weekly_scheduled_days,
      latestGrantDate: latestGrant?.granted_at ?? null,
      totalGranted,
      usedDates,
      usedCount:       usage.length,
      remaining:       w.remaining,   // FIFO残高（workerStatsで算出済み）
      duty:            w.duty,
    }
  })
})

// ── データ取得 ────────────────────────────────────────────────
async function load() {
  loading.value = true
  const accountId = await getAccountId()

  const [{ data: workersData }, { data: grantsData }, { data: usersData }, leaveData] = await Promise.all([
    supabase.from('workers').select('id, name, active, hire_date, employment_type, weekly_scheduled_days, initial_used_leave_days, excluded_grant_dates').eq('account_id', accountId).order('name'),
    supabase.from('paid_leave_grants').select('id, worker_id, granted_at, expires_at, days, note').eq('account_id', accountId),
    supabase.from('users').select('id, worker_id').eq('account_id', accountId).not('worker_id', 'is', null),
    fetchAllPaidLeaveReports(accountId),
  ])

  const userToWorker: Record<string, string> = {}
  for (const u of usersData ?? []) userToWorker[(u as any).id] = (u as any).worker_id

  // 全使用履歴を worker_id でインデックス
  Object.keys(allUsageByWorker).forEach(k => delete allUsageByWorker[k])
  for (const r of leaveData ?? []) {
    const workerId = userToWorker[(r as any).user_id]
    if (!workerId) continue
    if (!allUsageByWorker[workerId]) allUsageByWorker[workerId] = []
    allUsageByWorker[workerId].push({ date: (r as any).date, note: (r as any).note })
  }

  // 全付与履歴を worker_id でインデックス
  Object.keys(allGrantsByWorker).forEach(k => delete allGrantsByWorker[k])
  for (const g of grantsData ?? []) {
    const wid = (g as any).worker_id
    if (!allGrantsByWorker[wid]) allGrantsByWorker[wid] = []
    allGrantsByWorker[wid].push(g as Grant)
  }

  workerStats.value = (workersData ?? []).map((w: any) => {
    const wGrants     = allGrantsByWorker[w.id] ?? []
    const initialUsed  = Number(w.initial_used_leave_days ?? 0)   // 導入前に消化した分（控除）
    const systemUsed   = (allUsageByWorker[w.id] ?? []).length    // 導入後のアプリ有給申請
    const totalUsed    = initialUsed + systemUsed
    // FIFO残高: 消化を古い付与から充当し、有効付与の未消化分を残とする（失効の未使用分のみ消滅）。
    const bal = fifoBalance(wGrants, totalUsed, today)
    const totalGranted = bal.validGranted   // 有効期限内の付与合計
    // 未付与の基準日（付与待ち）。恒久除外された基準日は除く。
    const existingDates = new Set(wGrants.map(g => g.granted_at))
    const excludedDates = (Array.isArray(w.excluded_grant_dates) ? w.excluded_grant_dates : []).map((d: any) => String(d))
    const pendingCount  = pendingBaseDatesFor(w.hire_date, w.employment_type, w.weekly_scheduled_days, existingDates, today, new Set(excludedDates)).length

    // ── 年5日義務: 最新の基準日から1年間で判定 ──
    const latestGrant = wGrants.filter(g => !isExpired(g.expires_at)).sort((a, b) => b.granted_at.localeCompare(a.granted_at))[0]
    let duty: WorkerStat['duty']
    if (!latestGrant) {
      duty = { isSubject: false, isMet: false, usedInPeriod: 0, remaining: 5, grantedAt: null, deadline: null }
    } else {
      // 基準日から1年後の前日が義務期限
      const deadlineDate = new Date(latestGrant.granted_at)
      deadlineDate.setFullYear(deadlineDate.getFullYear() + 1)
      deadlineDate.setDate(deadlineDate.getDate() - 1)
      const deadline = deadlineDate.toISOString().split('T')[0]

      // 基準日〜期限内の付与合計が10日以上なら義務対象
      const grantsInPeriod = wGrants.filter(g => g.granted_at >= latestGrant.granted_at && g.granted_at <= deadline)
      const grantedInPeriod = grantsInPeriod.reduce((s, g) => s + Number(g.days), 0)
      const isSubject = grantedInPeriod >= 10

      // 基準日〜期限内の使用日数
      const usage = allUsageByWorker[w.id] ?? []
      const usedInPeriod = usage.filter(u => u.date >= latestGrant.granted_at && u.date <= deadline).length

      duty = {
        isSubject,
        isMet:        usedInPeriod >= 5,
        usedInPeriod,
        remaining:    Math.max(0, 5 - usedInPeriod),
        grantedAt:    latestGrant.granted_at,
        deadline,
      }
    }

    return {
      id:                    w.id,
      name:                  w.name,
      active:                w.active,
      hire_date:             w.hire_date,
      employment_type:       w.employment_type,
      weekly_scheduled_days: w.weekly_scheduled_days,
      initialUsed,
      excludedDates,
      totalGranted,
      totalUsed,
      remaining: bal.remaining,   // FIFO残高（失効の未使用分のみ消滅・過少計上バグ修正）
      pendingCount,
      duty,
    }
  })

  loading.value = false
  refreshNavBadges()   // ナビの付与待ちバッジを同期（付与操作後も即反映）
}

async function openDetail(w: WorkerStat) {
  detail.value   = w
  grantError.value = ''
  usedError.value = ''
  hireError.value = ''
  initialUsedInput.value = w.initialUsed   // 初期使用済み日数の編集値をセット
  hireDateInput.value = w.hire_date ?? ''   // 入社日の編集値をセット
  showManualGrant.value = false
  // 入社日が未設定なら設定パネルを開いた状態で出す（次にやるべきことが分かるように）
  showSettings.value = !w.hire_date && canViewHourlyWage.value
  newGrant.value = {
    granted_at: today,
    expires_at: `${thisYear + 2}-${today.slice(5)}`,
    days:       suggestedGrant(w),
    note:       `${thisYear}年度付与`,
  }
  await loadDetailData(w.id)
}

// 初期使用済み日数（導入前に消化した分）を保存し、残日数を再計算。
async function saveInitialUsed() {
  if (!detail.value) return
  const v = Number(initialUsedInput.value)
  if (!Number.isFinite(v) || v < 0) { usedError.value = '0以上の日数を入力してください'; return }
  savingUsed.value = true; usedError.value = ''
  try {
    await supabase.from('workers').update({ initial_used_leave_days: v }).eq('id', detail.value.id)
    await load()
    detail.value = workerStats.value.find(x => x.id === detail.value!.id) ?? detail.value
    if (detail.value) initialUsedInput.value = detail.value.initialUsed
  } catch (e: any) {
    usedError.value = e.message ?? '保存に失敗しました'
  } finally {
    savingUsed.value = false
  }
}

// 作業員の恒久除外基準日セット（workerStatsから）。
function excludedSetFor(workerId: string): Set<string> {
  return new Set(workerStats.value.find(x => x.id === workerId)?.excludedDates ?? [])
}

// 1作業員の未付与の基準日を法令付与（確認なし・A自動用）。入社日保存直後などに使う。除外基準日はスキップ。
async function autoGrantWorkerSilently(workerId: string, hireDate: string | null, empType: string | null | undefined, weeklyDays: number | null | undefined): Promise<number> {
  if (!canViewHourlyWage.value || !hireDate || empType === 'contractor') return 0
  const accountId = await getAccountId()
  const existing = new Set((allGrantsByWorker[workerId] ?? []).map(g => g.granted_at))
  const rows = pendingBaseDatesFor(hireDate, empType, weeklyDays, existing, today, excludedSetFor(workerId))
    .map(p => ({ worker_id: workerId, account_id: accountId, granted_at: p.granted, expires_at: p.expires, days: p.days, note: p.note }))
  if (rows.length === 0) return 0
  await supabase.from('paid_leave_grants').insert(rows)
  return rows.length
}

// 入社日を保存（役員経理以上のみ・自動付与の前提）。空なら null にする。保存後、その場で法令付与も自動反映（A）。
async function saveHireDate() {
  if (!detail.value) return
  if (!canViewHourlyWage.value) { hireError.value = '権限がありません'; return }
  savingHire.value = true; hireError.value = ''
  try {
    const wid = detail.value.id
    await supabase.from('workers').update({ hire_date: hireDateInput.value || null }).eq('id', wid)
    await load()   // allGrantsByWorker/workerStats を最新化（既存付与の把握）
    // A: 入社日を設定したら、その場で法令付与を自動反映（押す動作なし）
    const w = workerStats.value.find(x => x.id === wid)
    const granted = w ? await autoGrantWorkerSilently(wid, w.hire_date, w.employment_type, w.weekly_scheduled_days) : 0
    if (granted > 0) { autoGrantNotice.value = `入社日の設定に伴い、法令の有給 ${granted}件 を自動付与しました。`; await load() }
    await loadDetailData(wid)
    detail.value = workerStats.value.find(x => x.id === wid) ?? detail.value
    if (detail.value) hireDateInput.value = detail.value.hire_date ?? ''
  } catch (e: any) {
    hireError.value = e.message ?? '保存に失敗しました'
  } finally {
    savingHire.value = false
  }
}

async function loadDetailData(workerId: string) {
  const accountId = await getAccountId()
  const [{ data: grants }, { data: usersData }] = await Promise.all([
    supabase.from('paid_leave_grants').select('id, worker_id, granted_at, expires_at, days, note').eq('worker_id', workerId).order('granted_at', { ascending: false }),
    supabase.from('users').select('id').eq('worker_id', workerId).eq('account_id', accountId),
  ])
  detailGrants.value = (grants ?? []) as Grant[]

  // 付与履歴がない場合は移行登録用のデフォルト値をセット
  if (detailGrants.value.length === 0) {
    newGrant.value = {
      granted_at: today,
      expires_at: `${thisYear + 2}-${today.slice(5)}`,
      days:       0,
      note:       '移行初期残高（導入時点）',
    }
  }

  const userIds = (usersData ?? []).map((u: any) => u.id)
  if (userIds.length > 0) {
    const { data: usage } = await supabase.from('daily_reports').select('date, note').in('user_id', userIds).eq('leave_type', 'paid_leave').order('date', { ascending: false })
    detailUsage.value = (usage ?? []).map((r: any) => ({ date: r.date, note: r.note }))
  } else {
    detailUsage.value = []
  }
}

async function addGrant() {
  if (!detail.value) return
  if (!canViewHourlyWage.value) { grantError.value = '付与操作は役員・経理以上の権限者のみです'; return }
  if (!newGrant.value.granted_at || !newGrant.value.expires_at || !newGrant.value.days) {
    grantError.value = '付与日・有効期限・日数を入力してください'; return
  }
  grantSaving.value = true
  grantError.value  = ''
  try {
    const accountId = await getAccountId()
    await supabase.from('paid_leave_grants').insert({
      worker_id:  detail.value.id,
      account_id: accountId,
      granted_at: newGrant.value.granted_at,
      expires_at: newGrant.value.expires_at,
      days:       newGrant.value.days,
      note:       newGrant.value.note || null,
    })
    await loadDetailData(detail.value.id)
    await load()
    detail.value = workerStats.value.find(w => w.id === detail.value!.id) ?? detail.value
  } catch (e: any) {
    grantError.value = e.message ?? '保存に失敗しました'
  } finally {
    grantSaving.value = false
  }
}

// 入社日から法令付与を自動生成（回答A: 付与履歴ゼロの作業員のみ＝既存の移行初期残高運用と二重付与しない）。
// 各基準日(入社+6ヶ月, +18, +30…每12ヶ月)を今日まで生成。既に失効した過去分(基準日+2年<今日)は残に影響しないのでスキップ。
// 法令の自動付与（差分追加）: 入社日から今日までの基準日のうち、まだ付与していないものだけ追加。
// 既存の付与日(granted_at)は skip＝何度押しても重複しない。毎年押せば法令どおり付与される。
async function autoGrantFromHireDate(w: WorkerStat) {
  if (!canViewHourlyWage.value) { grantError.value = '付与操作は役員・経理以上の権限者のみです'; return }
  if (!w.hire_date) { grantError.value = '入社日が未設定です'; return }
  if (w.employment_type === 'contractor') { grantError.value = '業務委託は有給付与対象外です'; return }
  const existingDates = new Set(detailGrants.value.map(g => g.granted_at))   // 既存付与日（重複防止）
  const accountId = await getAccountId()
  const pending = pendingBaseDatesFor(w.hire_date, w.employment_type, w.weekly_scheduled_days, existingDates, today, excludedSetFor(w.id))
  const rows = pending.map(p => ({ worker_id: w.id, account_id: accountId, granted_at: p.granted, expires_at: p.expires, days: p.days, note: p.note }))
  if (rows.length === 0) { grantError.value = '追加する基準日がありません（すべて付与済み・除外済み、または入社6ヶ月未満）'; return }
  if (!confirm(`法令の有給を ${rows.length}件 追加付与します（未付与の基準日）。よろしいですか？`)) return
  grantSaving.value = true; grantError.value = ''
  try {
    await supabase.from('paid_leave_grants').insert(rows)
    await loadDetailData(w.id)
    await load()
    detail.value = workerStats.value.find(x => x.id === w.id) ?? detail.value
  } catch (e: any) {
    grantError.value = e.message ?? '自動付与に失敗しました'
  } finally {
    grantSaving.value = false
  }
}

// 付与待ち（未付与の基準日がある）作業員をまとめて法令付与。
const batchGranting = ref(false)
const pendingWorkers = computed(() => workerStats.value.filter(w => w.pendingCount > 0))
async function batchGrantPending() {
  if (!canViewHourlyWage.value) return
  const targets = pendingWorkers.value
  if (targets.length === 0) return
  if (!confirm(`付与待ちの ${targets.length}人 に法令の有給をまとめて付与します。よろしいですか？`)) return
  batchGranting.value = true
  try {
    const accountId = await getAccountId()
    const rows: { worker_id: string; account_id: string; granted_at: string; expires_at: string; days: number; note: string }[] = []
    for (const w of targets) {
      const existing = new Set((allGrantsByWorker[w.id] ?? []).map(g => g.granted_at))
      for (const p of pendingBaseDatesFor(w.hire_date, w.employment_type, w.weekly_scheduled_days, existing, today, new Set(w.excludedDates))) {
        rows.push({ worker_id: w.id, account_id: accountId, granted_at: p.granted, expires_at: p.expires, days: p.days, note: p.note })
      }
    }
    if (rows.length > 0) await supabase.from('paid_leave_grants').insert(rows)
    await load()
  } catch (e: any) {
    alert(e.message ?? 'まとめて付与に失敗しました')
  } finally {
    batchGranting.value = false
  }
}

// 付与を削除。自動付与(法令の基準日)を消す時は、その基準日を恒久除外に記録
// ＝再検知・再付与しない（A＋修正の除外機能）。誤りは「除外解除」で戻せる。
const grantMutating = ref(false)   // 削除/除外解除の二重実行ガード
async function deleteGrant(g: Grant) {
  if (!canViewHourlyWage.value || !detail.value || grantMutating.value) return
  const isAuto = (g.note ?? '').startsWith('自動付与')
  const msg = isAuto
    ? 'この自動付与を削除し、今後の自動付与からもこの基準日を除外しますか？（誤ったら除外解除で戻せます）'
    : 'この付与記録を削除しますか？'
  if (!confirm(msg)) return
  grantMutating.value = true
  try {
    const accountId = await getAccountId()   // 多層防御: RLSに加えクライアント側でも account_id で絞る
    await supabase.from('paid_leave_grants').delete().eq('id', g.id).eq('account_id', accountId)
    if (isAuto) {
      const w = workerStats.value.find(x => x.id === detail.value!.id)
      const excluded = new Set(w?.excludedDates ?? [])
      excluded.add(g.granted_at)
      await supabase.from('workers').update({ excluded_grant_dates: [...excluded] }).eq('id', detail.value.id).eq('account_id', accountId)
    }
    await loadDetailData(detail.value.id)
    await load()
    detail.value = workerStats.value.find(w => w.id === detail.value!.id) ?? detail.value
  } finally { grantMutating.value = false }
}

// 恒久除外を解除（再び自動付与の対象に）。解除後その場で再付与する。
async function unexcludeDate(dateStr: string) {
  if (!canViewHourlyWage.value || !detail.value || grantMutating.value) return
  grantMutating.value = true
  try {
    const accountId = await getAccountId()
    const w = workerStats.value.find(x => x.id === detail.value!.id)
    const excluded = (w?.excludedDates ?? []).filter(d => d !== dateStr)
    await supabase.from('workers').update({ excluded_grant_dates: excluded }).eq('id', detail.value.id).eq('account_id', accountId)
    await load()
    // 解除に伴い、その基準日を再付与（差分）
    const w2 = workerStats.value.find(x => x.id === detail.value!.id)
    if (w2) await autoGrantWorkerSilently(w2.id, w2.hire_date, w2.employment_type, w2.weekly_scheduled_days)
    await load()
    await loadDetailData(detail.value.id)
    detail.value = workerStats.value.find(x => x.id === detail.value!.id) ?? detail.value
  } finally { grantMutating.value = false }
}

function doPrint() {
  window.print()
}

// ── A: 無人自動付与（ページを開いた時に未付与の基準日を自動反映） ──
// 役員経理以上のみ・差分（既存付与日はskip）・付与日は基準日にバックデート＝残高は正しい。
// マウント時に1回だけ実行（毎load実行にすると、誤りを削除しても即再作成されてしまうため）。
const autoGrantNotice = ref('')
async function initialAutoGrant() {
  if (!canViewHourlyWage.value) return
  const accountId = await getAccountId()
  const rows: { worker_id: string; account_id: string; granted_at: string; expires_at: string; days: number; note: string }[] = []
  for (const w of workerStats.value) {
    if (w.pendingCount <= 0) continue
    const existing = new Set((allGrantsByWorker[w.id] ?? []).map(g => g.granted_at))
    for (const p of pendingBaseDatesFor(w.hire_date, w.employment_type, w.weekly_scheduled_days, existing, today, new Set(w.excludedDates))) {
      rows.push({ worker_id: w.id, account_id: accountId, granted_at: p.granted, expires_at: p.expires, days: p.days, note: p.note })
    }
  }
  if (rows.length === 0) return
  try {
    await supabase.from('paid_leave_grants').insert(rows)
    autoGrantNotice.value = `法令に基づき ${rows.length}件 を自動付与しました（付与履歴で確認できます。誤りは各作業員の詳細から削除・調整できます）`
    await load()
  } catch (e: any) {
    autoGrantNotice.value = `自動付与でエラー: ${e.message ?? '失敗'}（手動で付与してください）`
  }
}

onMounted(async () => {
  await load()
  await initialAutoGrant()   // A: 開いた時点で法令付与を自動反映
})
</script>

<style scoped>
/* ── 共通 ── */
.page-header  { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title   { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; gap: 12px; align-items: center; }
.year-select  { background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
.btn-print    { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.btn-print:hover { background: #333; }
.loading      { color: #888; padding: 40px; text-align: center; }

/* ── 絞り込みタブ ── */
.status-tabs { display: flex; gap: 4px; margin-bottom: 14px; }
.status-tab { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
.status-tab.active { background: #06C755; border-color: #06C755; color: #fff; }
.status-tab .tab-count { font-size: 11px; opacity: .8; margin-left: 4px; }

/* ── 画面テーブル ── */
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table      { width: 100%; border-collapse: collapse; }
.table th   { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td   { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table tr.inactive td { opacity: .4; }
.name   { font-weight: 600; }
.mono   { font-variant-numeric: tabular-nums; font-size: 13px; }
.actions { display: flex; gap: 8px; }

.emp-badge          { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.emp-badge.fulltime { background: #f0f4ff; color: #4f46e5; }
.emp-badge.parttime { background: #fff7ed; color: #c2710c; }
.emp-badge.contractor { background: #ecfdf5; color: #047857; }
.remaining     { font-size: 13px; font-weight: 700; }
.remaining.ok  { color: #0a8a3a; }
.remaining.low { color: #e67e22; }
.remaining.neg { color: #e53935; }
.duty-badge    { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.duty-badge.ok { background: #e8fff0; color: #0a8a3a; }
.duty-badge.ng { background: #fff3e0; color: #e67e22; }
.duty-na       { font-size: 11px; color: #ccc; }
.duty-deadline { font-size: 10px; color: #999; margin-top: 2px; }
.btn-detail    { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; cursor: pointer; }

/* ── ドロワー ── */
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 100; display: flex; justify-content: flex-end; }
.drawer { width: 520px; max-width: 95vw; background: #fff; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; padding: 28px; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; }
.drawer-name { font-size: 20px; font-weight: 700; }
.drawer-sub  { font-size: 12px; color: #888; margin-top: 4px; }
.btn-close   { background: none; border: none; font-size: 18px; cursor: pointer; color: #888; }
.balance-summary { display: flex; gap: 12px; }
.balance-card    { flex: 1; background: #f9f9f9; border-radius: 10px; padding: 14px; text-align: center; }
.balance-card.highlight { background: #e8fff0; }
.balance-label   { font-size: 11px; color: #888; margin-bottom: 6px; }
.balance-val     { font-size: 22px; font-weight: 700; color: #1a1a1a; }
.balance-sub     { font-size: 10px; color: #a16207; margin-top: 4px; }
.balance-card.highlight .balance-val { color: #0a8a3a; }
.hire-missing { color: #d97706; font-weight: 700; }
.ref-note   { font-size: 12px; color: #888; font-weight: 400; margin-left: 4px; }
.section-title { font-size: 13px; font-weight: 700; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
.info-note { font-size: 12px; color: #667; background: #f7f8fa; border-radius: 8px; padding: 10px 12px; line-height: 1.6; }
.info-note.warn { color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; }
/* ② 自動付与パネル（主アクション） */
.auto-grant-panel { background: #f4fdf7; border: 1px solid #bfe6cd; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.auto-grant-lead { display: flex; align-items: baseline; justify-content: space-between; }
.auto-grant-ref { font-size: 13px; color: #256b45; }
.auto-grant-ref b { font-size: 16px; }
.btn-auto-grant { display: block; width: 100%; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-auto-grant:disabled { opacity: .5; cursor: default; }
.auto-grant-hint { font-size: 11px; color: #4b7a5e; line-height: 1.6; margin: 0; }
.auto-grant-done { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #256b45; }
/* 折りたたみトグル */
.collapse-toggle { background: none; border: none; text-align: left; width: 100%; font-size: 13px; font-weight: 700; color: #555; cursor: pointer; padding: 8px 0; }
.collapse-toggle:hover { color: #06843c; }
/* ③ 設定パネル */
.settings-panel { display: flex; flex-direction: column; gap: 14px; background: #f7f9fc; border: 1px solid #e2e8f2; border-radius: 10px; padding: 14px; }
.setting-field { display: flex; flex-direction: column; gap: 4px; }
.setting-lbl { font-size: 12px; font-weight: 700; color: #556; }
.setting-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.setting-input { width: 170px; }
.setting-unit { font-size: 13px; color: #555; }
.btn-setting-save { background: #4338ca; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-setting-save:disabled { opacity: .5; cursor: default; }
.setting-hint { font-size: 11px; color: #889; margin: 4px 0 0; line-height: 1.6; }
.grant-form    { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
.form-row      { display: flex; gap: 12px; }
.form-field    { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.form-field label { font-size: 11px; font-weight: 700; color: #888; }
.input         { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px 12px; font-size: 14px; width: 100%; box-sizing: border-box; }
.btn-grant     { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; font-size: 14px; }
.btn-grant:disabled { opacity: .5; }
.error         { color: #e53935; font-size: 13px; margin: 0; }
.grant-warning { color: #b45309; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; font-size: 12px; padding: 8px 10px; margin: 4px 0; }
.sub-table    { width: 100%; border-collapse: collapse; font-size: 13px; }
.sub-table th { background: #f9f9f9; padding: 8px 12px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.sub-table td { padding: 10px 12px; border-top: 1px solid #f0f0f0; }
.sub-table tr.expired td { opacity: .5; }
.note-cell    { color: #888; max-width: 160px; }
.exp-badge         { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
.exp-badge.valid   { background: #e8fff0; color: #0a8a3a; }
.exp-badge.expired { background: #f5f5f5; color: #aaa; }
.btn-del { background: none; border: 1px solid #fca5a5; color: #e53935; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
.excluded-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.btn-unexclude { background: #eef2ff; border: 1px solid #c7d2fe; color: #4338ca; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
.empty   { color: #aaa; font-size: 13px; padding: 12px 0; }
.grant-error { color: #e53935; font-size: 12px; margin: 4px 0 0; }
/* 付与待ちバナー・バッジ */
.pending-banner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #fff7ed; border: 1px solid #fdba74; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
.pending-badge { font-size: 14px; font-weight: 800; color: #c2410c; white-space: nowrap; }
.pending-text { font-size: 12px; color: #9a3412; flex: 1; min-width: 0; }
.btn-batch-grant { background: #ea580c; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-batch-grant:disabled { opacity: .5; cursor: default; }
.pending-row-badge { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #c2410c; background: #ffedd5; border-radius: 4px; padding: 1px 6px; vertical-align: middle; }
.autogrant-notice { display: flex; align-items: center; gap: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; color: #065f46; }
.autogrant-text { flex: 1; font-size: 13px; }
.notice-close { background: none; border: none; cursor: pointer; color: #065f46; display: inline-flex; align-items: center; padding: 2px; }

/* ── 印刷専用: 管理簿 ── */
.print-only { display: none; }

.ledger-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; }
.ledger-title  { font-size: 20px; font-weight: 900; letter-spacing: 2px; }
.ledger-meta   { font-size: 12px; color: #555; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }

.ledger-table           { width: 100%; border-collapse: collapse; font-size: 11px; }
.ledger-table th        { background: #eee; border: 1px solid #999; padding: 5px 6px; text-align: center; font-weight: 700; white-space: nowrap; }
.ledger-table td        { border: 1px solid #bbb; padding: 5px 6px; vertical-align: top; }
.ledger-table .fw       { font-weight: 700; }
.ledger-table .sm       { font-size: 10px; }
.ledger-table .center   { text-align: center; }
.ledger-table .dates-cell { font-size: 10px; line-height: 1.8; word-break: break-all; }

.col-name       { width: 80px; }
.col-hire       { width: 70px; }
.col-type       { width: 55px; }
.col-grant-date { width: 70px; }
.col-grant-days { width: 45px; }
.col-dates      { min-width: 200px; }
.col-used       { width: 40px; }
.col-remaining  { width: 45px; }
.col-duty       { width: 50px; }

.ledger-footer { margin-top: 12px; font-size: 10px; color: #555; }

/* ── 印刷メディア ── */
@media print {
  .no-print   { display: none !important; }
  .print-only { display: block !important; }

  .ledger {
    font-family: 'Hiragino Kaku Gothic Pro', 'Meiryo', sans-serif;
  }

  /* 改ページ制御 */
  .ledger-table tr { page-break-inside: avoid; }
}
</style>
