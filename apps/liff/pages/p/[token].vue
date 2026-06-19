<template>
  <div class="portal">
    <div class="portal-card">
      <div class="brand">SIDO</div>

      <div v-if="loading" class="state">
        <div class="spinner" />
        <p>{{ t('token.loading') }}</p>
      </div>

      <div v-else-if="!result?.ok" class="state">
        <div class="icon-bad">⚠️</div>
        <h1>{{ t('token.invalidTitle') }}</h1>
        <p class="muted">{{ t('token.invalidMessage') }}</p>
      </div>

      <!-- 承諾完了（このセッションで承諾 or 既に承諾済み） -->
      <div v-else-if="acceptedAt" class="state ok">
        <div class="icon-ok">✓</div>
        <h1>{{ t('token.accepted.title') }}</h1>
        <p class="muted">{{ t('token.accepted.message') }}</p>
        <p class="accepted-at">{{ t('token.accepted.at') }}：{{ formatDateTime(acceptedAt) }}</p>
      </div>

      <!-- 注文書承諾フロー -->
      <div v-else-if="isOrderAccept && order" class="state">
        <p class="hello">{{ t('token.greeting', { name: result.subcontractor?.name }) }}</p>
        <h1>{{ t('token.purposeOrderAccept') }}</h1>

        <!-- 注文書内容 -->
        <div class="order-box">
          <div class="order-title">{{ t('token.order.heading') }}</div>
          <dl class="kv">
            <div class="kv-row"><dt>{{ t('token.order.number') }}</dt><dd class="mono">{{ order.order_number }}</dd></div>
            <div class="kv-row"><dt>{{ t('token.order.orderDate') }}</dt><dd>{{ order.order_date || t('token.order.none') }}</dd></div>
            <div class="kv-row"><dt>{{ t('token.order.site') }}</dt><dd>{{ order.site_name || t('token.order.none') }}</dd></div>
            <div v-if="order.construction_location" class="kv-row"><dt>{{ t('token.order.location') }}</dt><dd>{{ order.construction_location }}</dd></div>
            <div v-if="periodText" class="kv-row"><dt>{{ t('token.order.period') }}</dt><dd>{{ periodText }}</dd></div>
            <div v-if="order.manager_name" class="kv-row"><dt>{{ t('token.order.manager') }}</dt><dd>{{ order.manager_name }}</dd></div>
            <div class="kv-row amount"><dt>{{ t('token.order.amount') }}</dt><dd>{{ yen(order.total_amount) }}</dd></div>
            <div v-if="order.payment_terms" class="kv-row"><dt>{{ t('token.order.paymentTerms') }}</dt><dd>{{ order.payment_terms }}</dd></div>
            <div v-if="order.inspection_terms" class="kv-row"><dt>{{ t('token.order.inspectionTerms') }}</dt><dd>{{ order.inspection_terms }}</dd></div>
            <div v-if="order.change_rule" class="kv-row"><dt>{{ t('token.order.changeRule') }}</dt><dd>{{ order.change_rule }}</dd></div>
            <div v-if="order.special_notes" class="kv-row"><dt>{{ t('token.order.specialNotes') }}</dt><dd>{{ order.special_notes }}</dd></div>
          </dl>
          <a v-if="result.pdf_url" :href="result.pdf_url" target="_blank" rel="noopener" class="pdf-link">📄 {{ t('token.order.viewPdf') }}</a>
        </div>

        <!-- 承諾フォーム -->
        <div class="accept-box">
          <div class="accept-title">{{ t('token.accept.heading') }}</div>
          <p class="muted small">{{ t('token.accept.intro') }}</p>

          <label class="fld"><span>{{ t('token.accept.signerName') }}</span>
            <input v-model="signerName" class="inp" :placeholder="t('token.accept.signerNamePlaceholder')" maxlength="100" />
          </label>

          <div class="sig-label">{{ t('token.accept.signaturePrompt') }}</div>
          <div class="sig-wrap">
            <canvas
              ref="canvasEl"
              class="sig-canvas"
              @pointerdown="startDraw"
              @pointermove="draw"
              @pointerup="endDraw"
              @pointerleave="endDraw"
            />
            <button v-if="hasSignature" type="button" class="sig-clear" @click="clearSignature">{{ t('token.accept.clear') }}</button>
          </div>

          <p class="muted small note">{{ t('token.accept.agreeNote') }}</p>
          <p v-if="acceptError" class="err">{{ acceptError }}</p>

          <button type="button" class="btn-accept" :disabled="submitting" @click="submitAccept">
            {{ submitting ? t('token.accept.submitting') : t('token.accept.submit') }}
          </button>
        </div>
      </div>

      <!-- その他 purpose（請求等）は後続チケットでこの枠に実装 -->
      <div v-else class="state ok">
        <div class="icon-ok">✓</div>
        <p class="hello">{{ t('token.greeting', { name: result.subcontractor?.name }) }}</p>
        <h1>{{ purposeLabel }}</h1>
        <p class="muted">{{ t('token.okMessage') }}</p>
        <div class="doc-placeholder">{{ t('token.docPlaceholder', { purpose: result.purpose }) }}</div>
      </div>
    </div>
    <p class="foot">{{ t('token.footer') }}</p>
  </div>
</template>

<script setup lang="ts">
// 業者向けポータル：LINEログイン不要。トークンを Edge Function に渡して検証・スコープ取得する。
// ※ このページは LIFF 初期化を経由しない（app.vue が /p/ を除外）。
import { useI18n } from 'vue-i18n'

const { t }  = useI18n()
const route  = useRoute()
const config = useRuntimeConfig()

type OrderView = {
  order_number: string; order_date: string | null; total_amount: number | null
  site_name: string | null; construction_location: string | null
  period_start: string | null; period_end: string | null; manager_name: string | null
  vendor_name: string | null; vendor_contact_name: string | null
  payment_terms: string | null; bank_info: string | null; inspection_terms: string | null
  change_rule: string | null; special_notes: string | null
  status: string | null; accepted_at: string | null; has_pdf: boolean
}
type PortalResult = {
  ok: boolean
  purpose?: string
  document_type?: string | null
  document_id?: string | null
  subcontractor?: { id: string; name: string }
  order?: OrderView | null
  pdf_url?: string | null
}

const loading = ref(true)
const result  = ref<PortalResult | null>(null)
const acceptedAt = ref<string | null>(null)

const signerName  = ref('')
const submitting  = ref(false)
const acceptError = ref('')

const PURPOSE_LABELS: Record<string, string> = {
  order_accept:   t('token.purposeOrderAccept'),
  invoice_submit: t('token.purposeInvoiceSubmit'),
}
const purposeLabel = computed(() => (result.value?.purpose && PURPOSE_LABELS[result.value.purpose]) || t('token.purposeDefault'))
const isOrderAccept = computed(() => result.value?.purpose === 'order_accept')
const order = computed<OrderView | null>(() => result.value?.order ?? null)
const periodText = computed(() => {
  const o = order.value
  if (!o?.period_start && !o?.period_end) return ''
  return `${o?.period_start || '—'} 〜 ${o?.period_end || '—'}`
})

function yen(n: number | null | undefined): string {
  return `¥${Number(n ?? 0).toLocaleString('ja-JP')}`
}
function formatDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('ja-JP') } catch { return iso }
}

const edgeBase = () => (config.public as any).edgeFunctionUrl || `${(config.public as any).supabaseUrl}/functions/v1`
const token = () => String(route.params.token ?? '')

async function callPortal(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${edgeBase()}/subcontractor-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token(), ...body }),
  })
  return res.json()
}

// ── 署名キャンバス ──
const canvasEl = ref<HTMLCanvasElement | null>(null)
const hasSignature = ref(false)
let drawing = false
let ctx: CanvasRenderingContext2D | null = null

function setupCanvas() {
  const c = canvasEl.value
  if (!c) return
  // 表示サイズに合わせて内部解像度を設定（DPR対応で線がにじまない）
  const rect = c.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  c.width = Math.round(rect.width * dpr)
  c.height = Math.round(rect.height * dpr)
  ctx = c.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111'
  }
}
function pos(e: PointerEvent) {
  const c = canvasEl.value!
  const rect = c.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}
function startDraw(e: PointerEvent) {
  if (!ctx) setupCanvas()
  if (!ctx) return
  drawing = true
  canvasEl.value?.setPointerCapture?.(e.pointerId)
  const { x, y } = pos(e)
  ctx.beginPath()
  ctx.moveTo(x, y)
  e.preventDefault()
}
function draw(e: PointerEvent) {
  if (!drawing || !ctx) return
  const { x, y } = pos(e)
  ctx.lineTo(x, y)
  ctx.stroke()
  hasSignature.value = true
  e.preventDefault()
}
function endDraw() { drawing = false }
function clearSignature() {
  const c = canvasEl.value
  if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
  hasSignature.value = false
}

async function submitAccept() {
  acceptError.value = ''
  if (!hasSignature.value || !canvasEl.value) {
    acceptError.value = t('token.accept.errorSignature')
    return
  }
  submitting.value = true
  try {
    const signature = canvasEl.value.toDataURL('image/png')
    const r = await callPortal({ action: 'accept', signature, signer_name: signerName.value })
    if (r?.ok) {
      acceptedAt.value = r.accepted_at || new Date().toISOString()
    } else {
      acceptError.value = r?.error === 'signature_required'
        ? t('token.accept.errorSignature')
        : t('token.accept.errorFailed')
    }
  } catch {
    acceptError.value = t('token.accept.errorFailed')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    result.value = await callPortal({ action: 'resolve' })
    // 既に承諾済みの注文書なら、承諾完了画面を出す
    if (result.value?.ok && result.value.order?.accepted_at) {
      acceptedAt.value = result.value.order.accepted_at
    }
  } catch {
    result.value = { ok: false }
  } finally {
    loading.value = false
  }
  await nextTick()
  setupCanvas()
})
</script>

<style scoped>
.portal { min-height: 100dvh; background: #f2f2f7; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; gap: 14px; }
.portal-card { background: #fff; width: 100%; max-width: 460px; border-radius: 18px; padding: 28px 22px; box-shadow: 0 4px 20px rgba(0,0,0,.08); text-align: center; }
.brand { font-size: 20px; font-weight: 900; letter-spacing: 6px; color: #06C755; margin-bottom: 16px; }
.state { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.state h1 { font-size: 18px; font-weight: 700; margin: 0; color: #111; }
.hello { font-size: 15px; font-weight: 700; color: #06C755; margin: 0; }
.muted { font-size: 13px; color: #888; line-height: 1.7; margin: 0; }
.muted.small { font-size: 12px; }
.icon-ok { width: 48px; height: 48px; border-radius: 50%; background: #e8f9ef; color: #06C755; font-size: 26px; display: flex; align-items: center; justify-content: center; }
.icon-bad { font-size: 36px; }
.accepted-at { font-size: 12px; color: #555; margin: 4px 0 0; }
.doc-placeholder { margin-top: 10px; width: 100%; box-sizing: border-box; background: #f8f9fa; border: 1px dashed #d8dde3; border-radius: 10px; padding: 16px; font-size: 12px; color: #999; }
.spinner { width: 30px; height: 30px; border: 3px solid #e0e0e0; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.foot { font-size: 11px; color: #aaa; max-width: 460px; text-align: center; margin: 0; }

/* 注文書内容 */
.order-box { width: 100%; box-sizing: border-box; text-align: left; background: #fafbfc; border: 1px solid #eceff1; border-radius: 12px; padding: 16px; margin-top: 6px; }
.order-title { font-size: 13px; font-weight: 800; color: #333; margin-bottom: 10px; }
.kv { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.kv-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; align-items: baseline; }
.kv-row dt { color: #888; flex-shrink: 0; }
.kv-row dd { margin: 0; color: #222; text-align: right; word-break: break-word; }
.kv-row .mono { font-variant-numeric: tabular-nums; font-weight: 700; }
.kv-row.amount { margin-top: 4px; padding-top: 8px; border-top: 1px solid #eceff1; }
.kv-row.amount dt { font-weight: 700; color: #333; }
.kv-row.amount dd { font-size: 18px; font-weight: 800; color: #06A050; }
.pdf-link { display: inline-block; margin-top: 12px; font-size: 13px; color: #1a56c4; text-decoration: none; border: 1px solid #cdd8f0; border-radius: 6px; padding: 6px 12px; }

/* 承諾フォーム */
.accept-box { width: 100%; box-sizing: border-box; text-align: left; margin-top: 18px; }
.accept-title { font-size: 14px; font-weight: 800; color: #111; margin-bottom: 8px; }
.fld { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.inp { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; font-family: inherit; }
.sig-label { font-size: 12px; font-weight: 700; color: #888; margin-bottom: 6px; }
.sig-wrap { position: relative; }
.sig-canvas { width: 100%; height: 180px; background: #fff; border: 2px dashed #c4ccd4; border-radius: 10px; touch-action: none; display: block; }
.sig-clear { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,.9); border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #666; }
.note { margin: 10px 0 0; }
.err { color: #E53935; font-size: 13px; margin: 8px 0 0; }
.btn-accept { margin-top: 14px; width: 100%; background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 14px; font-size: 15px; font-weight: 800; cursor: pointer; }
.btn-accept:disabled { opacity: .5; cursor: not-allowed; }
</style>
