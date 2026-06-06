<template>
  <div class="app">
    <AppNav subtitle="経費申請書" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="main">
      <div v-if="initializing" class="state-screen no-print">
        <div class="spinner" /><p class="state-text">読み込み中...</p>
      </div>

      <template v-else>
        <!-- 期間選択 -->
        <div class="period-bar no-print">
          <button
            v-for="key in periodKeys"
            :key="key"
            class="period-btn"
            :class="{ active: selectedPeriod === key }"
            @click="selectPeriod(key)"
          >{{ shortLabel(key) }}</button>
        </div>

        <!-- 表示切替（全経費 / 個人建て替え分のみ）-->
        <div class="mode-bar no-print">
          <button class="mode-btn" :class="{ active: viewMode === 'all' }" @click="viewMode = 'all'">全経費</button>
          <button class="mode-btn" :class="{ active: viewMode === 'tategae' }" @click="viewMode = 'tategae'">個人建て替え分のみ</button>
        </div>

        <!-- 申請ステータス -->
        <div class="status-bar no-print" :class="`st-${statusClass}`">
          <span class="status-label">{{ statusLabel }}</span>
          <span v-if="effStatus === '未申請' || effStatus === '差し戻し'" class="status-deadline">
            締切 {{ deadlineText }}
          </span>
        </div>
        <div v-if="effStatus === '差し戻し' && settlement?.reject_reason" class="reject-box no-print">
          <span class="reject-title">差し戻し理由</span>
          <p class="reject-reason">{{ settlement.reject_reason }}</p>
        </div>

        <!-- 申請アクション（ステータス直下で常に見える位置に） -->
        <div v-if="canApply" class="apply-actions no-print">
          <button class="btn-apply" :disabled="applying" @click="handleApply">
            {{ applying ? '申請中…' : (effStatus === '差し戻し' ? 'この期を再申請する' : 'この期を申請する') }}
          </button>
          <p v-if="applyError" class="apply-error">{{ applyError }}</p>
        </div>

        <!-- ====== 印刷エリア ====== -->
        <div ref="printAreaEl" class="print-area">
          <h1 class="doc-h1">請　求　書<span v-if="viewMode === 'tategae'" class="doc-h1-sub">（個人建て替え分）</span></h1>

          <div class="doc-top">
            <div class="doc-top-left">
              <div v-if="accountName" class="doc-addressee">{{ accountName }} 御中</div>
              <p class="doc-lead">下記のとおり、ご請求申し上げます。</p>
            </div>
            <div class="doc-top-right">
              <div class="doc-meta-row"><span class="doc-meta-label">請 求 日</span><span>{{ issueDate }}</span></div>
              <div class="doc-meta-row"><span class="doc-meta-label">対象期間</span><span>{{ periodFullLabel }}</span></div>
              <div class="doc-sender">氏名：{{ currentUser?.real_name }}</div>
            </div>
          </div>

          <div class="doc-notes-top">
            <span class="doc-note">★必ず登録番号記入</span>
            <span class="doc-note">※領収書添付</span>
          </div>

          <div v-if="loading" class="center-text no-print">読み込み中...</div>

          <template v-else-if="displayRows.length > 0">
            <div class="table-wrap">
              <table class="expense-table">
                <thead>
                  <tr>
                    <th class="col-date">月　日</th>
                    <th class="col-payee">支　払　先</th>
                    <th class="col-reg">登 録 番 号</th>
                    <th class="col-cat">品　名</th>
                    <th class="col-lit">ℓ</th>
                    <th class="col-site">現 場 名</th>
                    <th class="col-sep">/</th>
                    <th class="col-amt">金　額</th>
                    <th class="col-receipt no-print">領収書</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in displayRows" :key="i">
                    <td class="center">{{ fmtDate(row.date) }}</td>
                    <td class="small">{{ row.note || '' }}</td>
                    <td class="small">{{ row.registrationNumber || '' }}</td>
                    <td class="center">{{ row.category }}</td>
                    <td class="center">{{ row.liters ?? '' }}</td>
                    <td class="small">{{ row.siteName }}</td>
                    <td></td>
                    <td class="right">{{ row.amount ? '¥' + row.amount.toLocaleString() : '' }}</td>
                    <td class="receipt-cell no-print">
                      <template v-if="row.fileUrls?.length">
                        <a
                          v-for="(url, ui) in row.fileUrls"
                          :key="ui"
                          :href="url"
                          target="_blank"
                          rel="noopener"
                          class="receipt-link"
                        >📎{{ row.fileUrls.length > 1 ? ui + 1 : '' }}</a>
                      </template>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="7" class="right">合　計</td>
                    <td class="right">¥{{ total.toLocaleString() }}</td>
                    <td class="no-print"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div class="doc-notes">
              <p>※支払先ごとにまとめて計上のこと</p>
              <p>※登録番号がない先はなしと記入のこと</p>
            </div>
          </template>

          <div v-else class="empty-notice">
            <template v-if="viewMode === 'tategae' && rows.length > 0">
              この期間に個人建て替え分の経費はありません。
            </template>
            <template v-else>
              この期間の経費データがありません。<br>
              先に日報を送信してください。
            </template>
          </div>
        </div>

        <!-- アクション -->
        <div v-if="displayRows.length > 0" class="actions no-print">
          <div class="guide-box">
            <p class="guide-title">PDF保存の手順</p>
            <ol class="guide-steps">
              <li>下の「ブラウザで開く」をタップ</li>
              <li>Safari / Chrome で申請書が開く</li>
              <li>共有ボタン（<span class="icon-share">⎙</span>）→「PDFとして保存」または「印刷」を選択</li>
            </ol>
          </div>
          <button class="btn-open-safari primary" @click="handleOpenExternal">ブラウザで開く →</button>
          <button class="btn-print pc-only" @click="handlePrint">PDFとして保存（印刷）</button>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { User, ExpenseRow } from '~/types'
import { getCurrentPeriodKey, recentPeriodKeys, deadlineLabel, effectiveStatus, periodLabel } from '~/composables/useExpense'
import { elementToPdfBlob, uploadApplicationPdf } from '~/utils/generateExpensePdf'

const liff    = useLiff()
const expense = useExpense()
const proxy   = useProxyMode()
const router  = useRouter()
const config  = useRuntimeConfig()
const supabase = useSupabase()
const { accountName, getAccountId } = useAccount()

const initializing   = ref(true)
const loading        = ref(false)
const selfUser       = ref<User | null>(null)
const selectedPeriod = ref(getCurrentPeriodKey())
const rows           = ref<ExpenseRow[]>([])
const viewMode       = ref<'all' | 'tategae'>('all')

// 申請ステータス
const printAreaEl = ref<HTMLElement | null>(null)
const settlement  = ref<any | null>(null)
const applying    = ref(false)
const applyError  = ref('')

const effStatus    = computed(() => effectiveStatus(settlement.value, selectedPeriod.value))
const deadlineText = computed(() => deadlineLabel(selectedPeriod.value))
const statusLabel  = computed(() => {
  switch (effStatus.value) {
    case '申請中':   return '申請済み'
    case '差し戻し': return '差し戻し（要再申請）'
    case '期限超過': return '申請期限切れ'
    case '支払い済み': return '支払い済み'
    default:        return '未申請'
  }
})
const statusClass = computed(() => ({
  '未申請': 'todo', '申請中': 'applied', '差し戻し': 'rejected',
  '期限超過': 'expired', '支払い済み': 'paid',
}[effStatus.value] ?? 'todo'))
// 未申請 or 差し戻し かつ 経費行があるとき申請可能
const canApply = computed(() =>
  displayRows.value.length > 0 && (effStatus.value === '未申請' || effStatus.value === '差し戻し')
)

// 申請対象のDBユーザーID（代理中は代理先）
const applyUserId = computed(() => proxy.proxyTarget.value ? proxyUserId.value : selfUser.value?.id ?? null)

// 表示中の行（全経費 / 個人建て替え分のみ）
const displayRows = computed(() =>
  viewMode.value === 'tategae' ? rows.value.filter(r => r.tategae) : rows.value
)

// 代理中は代理先の情報を表示
const currentUser = computed(() => {
  const t = proxy.proxyTarget.value
  if (t) return { ...selfUser.value, real_name: t.name, worker_role: t.worker_role } as User
  return selfUser.value
})

const periodKeys = computed(() => recentPeriodKeys().slice(0, 4))
const total      = computed(() => displayRows.value.reduce((s, r) => s + r.amount, 0))
const periodFullLabel = computed(() => periodLabel(selectedPeriod.value))
const issueDate  = computed(() => { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` })

// 代理先のDBユーザーIDをキャッシュ
const proxyUserId = ref<string | null>(null)

onMounted(async () => {
  await liff.init()
  const userId = liff.profile.value?.userId
  if (!userId) { initializing.value = false; return }

  selfUser.value = await expense.getUser(userId)
  if (!selfUser.value) { router.push('/register'); return }

  await getAccountId()   // accountName（宛名）を populate
  await resolveProxyUserId()
  await loadRows()
  initializing.value = false
})

async function resolveProxyUserId() {
  const t = proxy.proxyTarget.value
  if (!t) { proxyUserId.value = null; return }
  const { data } = await useSupabase().from('users').select('id').eq('worker_id', t.id).maybeSingle()
  proxyUserId.value = data?.id ?? null
}

watch(() => proxy.proxyTarget.value, async () => {
  if (!selfUser.value) return
  loading.value = true
  await resolveProxyUserId()
  await loadRows()
  loading.value = false
})

async function loadRows() {
  loading.value = true
  const t = proxy.proxyTarget.value
  if (t) {
    rows.value = proxyUserId.value
      ? await expense.getExpenseRowsFromReportsById(proxyUserId.value, selectedPeriod.value)
      : []
  } else {
    rows.value = await expense.getExpenseRowsFromReports(liff.profile.value!.userId, selectedPeriod.value)
  }
  await loadSettlement()
  loading.value = false
}

async function loadSettlement() {
  applyError.value = ''
  settlement.value = applyUserId.value
    ? await expense.getSettlement(applyUserId.value, selectedPeriod.value)
    : null
}

async function selectPeriod(key: string) {
  selectedPeriod.value = key
  await loadRows()
}

/** 経費申請（未申請/差し戻し → 申請中）。PDF生成・メールは best-effort */
async function handleApply() {
  if (!applyUserId.value) { applyError.value = 'ユーザー情報が取得できません'; return }
  applying.value = true
  applyError.value = ''
  try {
    // 1. 申請書PDFを生成して Storage に保存（失敗しても申請は継続）
    let pdfPath: string | null = null
    try {
      if (printAreaEl.value) {
        const blob = await elementToPdfBlob(printAreaEl.value)
        pdfPath = await uploadApplicationPdf(
          supabase, blob, config.public.accountSlug as string,
          applyUserId.value, selectedPeriod.value,
        )
      }
    } catch (e) {
      console.error('[expense apply] PDF生成/保存に失敗（申請は継続）:', e)
    }

    // 2. 精算ステータスを 申請中 に
    settlement.value = await expense.applySettlement(applyUserId.value, selectedPeriod.value, pdfPath)

    // 3. PDFメール送信 function を呼ぶ（best-effort）
    triggerApplicationEmail(applyUserId.value, selectedPeriod.value)
  } catch (e: any) {
    console.error('[expense apply] 申請失敗:', e)
    applyError.value = '申請に失敗しました。時間をおいて再度お試しください。'
  } finally {
    applying.value = false
  }
}

/** 申請PDFメール送信 function 呼び出し（fire-and-forget） */
function triggerApplicationEmail(userId: string, periodKey: string) {
  const efUrl = config.public.edgeFunctionUrl
  if (!efUrl) return
  const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''
  fetch(`${efUrl}/${fnPrefix}send-expense-application`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.public.supabaseAnonKey}`,
    },
    body: JSON.stringify({
      accountSlug: config.public.accountSlug,
      user_id: userId,
      period_key: periodKey,
    }),
  }).catch(e => console.error('[expense apply] メール送信呼び出し失敗:', e))
}

function handlePrint() { window.print() }

async function handleOpenExternal() {
  const t   = proxy.proxyTarget.value
  const uid = t ? (proxyUserId.value ?? liff.profile.value?.userId) : liff.profile.value?.userId
  const url = `${window.location.origin}/expense/print?userId=${uid}&period=${selectedPeriod.value}&mode=${viewMode.value}`
  try {
    const liffSdk = (await import('@line/liff')).default
    liffSdk.openWindow({ url, external: true })
  } catch {
    window.open(url, '_blank')
  }
}

function fmtDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(m)}月${parseInt(day)}日`
}

function shortLabel(key: string) {
  const [, month, half] = key.split('-')
  return `${parseInt(month)}月${half === 'first' ? '前半' : '後半'}`
}

const isMobile = computed(() => {
  if (import.meta.server) return false
  return window.innerWidth < 768 || /iPhone|Android|Mobile/i.test(navigator.userAgent)
})
</script>

<style>
/* CSS変数は scoped だと :root が当たらない（var が全て未定義になりボタンが不可視に
   なる不具合）。非scopedの style に置いて html に確実に適用する。 */
:root { --bg:#EFEFEF;--surface:#fff;--border:#E0E0E0;--accent:#06C755;--text:#111;--text2:#888;--font:'Noto Sans JP',-apple-system,sans-serif;--radius:12px; }
html,body { background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh; }
</style>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
.header { background:#fff;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06); }
.header-inner { max-width:840px;margin:0 auto;padding:0 16px;height:52px;display:flex;align-items:center;justify-content:space-between; }
.brand { display:flex;align-items:baseline;gap:8px; }
.brand-name { font-size:16px;font-weight:900;letter-spacing:5px;color:var(--accent); }
.brand-divider { color:var(--border); }
.brand-sub { font-size:12px;color:var(--text2);letter-spacing:2px; }
.user-badge { font-size:12px;color:var(--text2);background:#f5f5f5;border:1px solid var(--border);padding:3px 10px;border-radius:20px; }
.main { max-width:840px;margin:0 auto;padding:16px 16px 100px;display:flex;flex-direction:column;gap:14px; }
.state-screen { display:flex;flex-direction:column;align-items:center;padding:80px 20px;gap:16px; }
.spinner { width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.state-text { font-size:14px;color:var(--text2); }
.period-bar { display:flex;gap:8px;overflow-x:auto;padding-bottom:4px; }
.period-btn { flex-shrink:0;padding:7px 14px;border-radius:20px;border:1px solid var(--border);background:#fff;font-size:12px;font-family:var(--font);color:var(--text2);cursor:pointer; }
.period-btn.active { background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700; }
.status-bar { display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700; }
.status-bar .status-deadline { font-size:11px;font-weight:600;opacity:.8; }
.st-todo { background:#fff7e6;color:#b26a00;border:1px solid #ffe0a3; }
.st-applied { background:#e6f7ed;color:#1a8a4d;border:1px solid #b5e7c8; }
.st-rejected { background:#fdeaea;color:#c0392b;border:1px solid #f5c0bb; }
.st-expired { background:#f0f0f0;color:#999;border:1px solid #ddd; }
.st-paid { background:#e8f0fe;color:#1a56c4;border:1px solid #c0d4f5; }
.reject-box { background:#fdeaea;border:1px solid #f5c0bb;border-radius:10px;padding:10px 14px; }
.reject-title { font-size:11px;font-weight:700;color:#c0392b; }
.reject-reason { font-size:13px;color:#444;margin-top:4px;white-space:pre-wrap; }
.apply-actions { display:flex;flex-direction:column;gap:8px; }
.btn-apply { width:100%;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);padding:16px;font-size:16px;font-weight:900;letter-spacing:1px;font-family:var(--font);cursor:pointer; }
.btn-apply:disabled { opacity:.6;cursor:default; }
.apply-error { color:#c0392b;font-size:13px;text-align:center; }
.mode-bar { display:flex;gap:8px; }
.mode-btn { flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:#fff;font-size:13px;font-family:var(--font);color:var(--text2);font-weight:700;cursor:pointer; }
.mode-btn.active { background:var(--accent);color:#fff;border-color:var(--accent); }
.print-area { background:#fff;border-radius:var(--radius);padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06); }
.doc-h1 { font-size:24px;font-weight:900;text-align:center;letter-spacing:8px;margin-bottom:18px; }
.doc-h1-sub { font-size:14px;font-weight:700;letter-spacing:1px;margin-left:6px; }
.doc-top { display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px; }
.doc-top-left { flex:1;min-width:0; }
.doc-addressee { font-size:18px;font-weight:700;letter-spacing:1px;border-bottom:1px solid var(--text);display:inline-block;padding-bottom:2px;margin-bottom:10px; }
.doc-lead { font-size:12px;color:var(--text); }
.doc-top-right { flex-shrink:0;text-align:left;display:flex;flex-direction:column;gap:3px; }
.doc-meta-row { display:flex;gap:10px;font-size:12px; }
.doc-meta-label { color:var(--text2);min-width:56px; }
.doc-sender { font-size:14px;font-weight:700;margin-top:6px; }
.doc-notes-top { display:flex;gap:14px;margin-bottom:6px; }
.doc-note { font-size:10px;color:var(--text2); }
.table-wrap { overflow-x:auto; }
.expense-table { width:100%;border-collapse:collapse;font-size:12px; }
.expense-table th,.expense-table td { border:1px solid #333;padding:5px 6px; }
.expense-table thead th { background:#f0f0f0;font-weight:700;text-align:center;font-size:11px; }
.col-date{width:62px}.col-payee{min-width:100px}.col-reg{width:110px}.col-cat{width:72px}.col-lit{width:28px}.col-site{width:90px}.col-sep{width:18px}.col-amt{width:82px}.col-receipt{width:60px}
.center{text-align:center}.right{text-align:right}.small{font-size:10px}
.receipt-cell{text-align:center;white-space:nowrap}
.receipt-link{display:inline-block;font-size:11px;color:var(--accent);text-decoration:none;margin:1px 2px}
.total-row td { font-weight:700;border-top:2px solid #333; }
.doc-notes { margin-top:10px;display:flex;flex-direction:column;gap:2px; }
.doc-notes p { font-size:10px;color:var(--text2); }
.center-text,.empty-notice { text-align:center;padding:40px 20px;color:var(--text2);font-size:14px;line-height:1.8; }
.actions { display:flex;flex-direction:column;gap:10px; }
.btn-print { width:100%;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);padding:16px;font-size:16px;font-weight:900;letter-spacing:1px;font-family:var(--font);cursor:pointer; }
.btn-open-safari { width:100%;background:#fff;color:var(--text);border:1px solid var(--border);border-radius:var(--radius);padding:14px;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer; }
.btn-open-safari.primary { background:var(--accent);color:#fff;border-color:var(--accent);font-size:16px;padding:16px; }
.guide-box { background:#f8f8f8;border-radius:var(--radius);padding:16px 18px;border-left:3px solid var(--accent); }
.guide-title { font-size:13px;font-weight:700;margin-bottom:10px;color:var(--text); }
.guide-steps { padding-left:18px;display:flex;flex-direction:column;gap:8px; }
.guide-steps li { font-size:13px;color:#444;line-height:1.5; }
.icon-share { font-size:15px; }
.pc-only { display: none; }
@media (min-width: 768px) { .pc-only { display: block; } }
@media print {
  .no-print { display:none !important; }
  .main { padding:0 !important; }
  .print-area { box-shadow:none !important;border-radius:0 !important;padding:10px !important; }
  .expense-table th,.expense-table td { font-size:10px !important;padding:4px 5px !important; }
  body { background:#fff !important; }
}
</style>
