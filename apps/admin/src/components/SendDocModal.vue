<template>
  <div v-if="visible" class="sdm-overlay" @click.self="close">
    <div class="sdm">
      <h2>{{ title }}</h2>

      <div v-if="loading" class="sdm-loading">読み込み中…</div>

      <!-- 送信前の確認ステップ -->
      <template v-else-if="confirming">
        <p class="sdm-confirm-lead">この内容でメールを送信します。よろしいですか？</p>
        <div class="sdm-confirm-box">
          <div class="sdm-confirm-row"><span class="sdm-label">宛先</span>
            <span><span v-for="e in selectedTo" :key="e" class="sdm-chip">{{ e }}</span></span>
          </div>
          <div class="sdm-confirm-row"><span class="sdm-label">件名</span><span>{{ subject || '（件名なし）' }}</span></div>
          <div class="sdm-confirm-row"><span class="sdm-label">本文</span><span class="sdm-confirm-body">{{ body || '（本文なし）' }}</span></div>
          <p class="sdm-note">※ 本文末尾に「リンクボタン＋URL」が自動付与されます。</p>
        </div>
        <p v-if="errorMsg" class="sdm-error">{{ errorMsg }}</p>
        <div class="sdm-actions">
          <button class="sdm-btn ghost" :disabled="!!busy" @click="confirming = false">← 戻る</button>
          <button class="sdm-btn send" :disabled="!!busy" @click="confirmSend">{{ busy === 'send' ? '送信中…' : '✓ 送信する' }}</button>
        </div>
      </template>

      <template v-else>
        <div class="sdm-recipient">
          <span class="sdm-label">宛先（複数選択可）</span>
          <span v-if="!hasRecipient" class="sdm-noto">⚠ 宛先メール未登録（送信不可・URLコピーは可能）</span>
        </div>
        <div v-if="hasRecipient" class="sdm-recips">
          <label v-for="r in recipients" :key="r.email" class="sdm-recip">
            <input type="checkbox" :value="r.email" v-model="selectedTo" />
            <span class="sdm-recip-label">{{ r.label }}</span>
            <span class="sdm-recip-email">{{ r.email }}</span>
          </label>
        </div>

        <label class="sdm-fld"><span>件名</span>
          <input v-model="subject" class="sdm-input" placeholder="メールの件名" />
        </label>
        <label class="sdm-fld"><span>本文</span>
          <textarea v-model="body" class="sdm-input sdm-textarea" rows="7" placeholder="メール本文"></textarea>
        </label>
        <p class="sdm-note">※ 本文の末尾に「リンクボタン＋URL」が自動で付きます（送信時に発行）。</p>

        <p v-if="copiedUrl" class="sdm-copied">📋 URLをコピーしました（メールは送信していません）<br><span class="sdm-url">{{ copiedUrl }}</span></p>
        <p v-if="errorMsg" class="sdm-error">{{ errorMsg }}</p>
        <p v-if="okMsg" class="sdm-ok">{{ okMsg }}</p>

        <div class="sdm-actions">
          <button class="sdm-btn ghost" @click="close">キャンセル</button>
          <button class="sdm-btn copy" :class="{ primary: !hasRecipient }" :disabled="busy === 'copy'" @click="doCopy">{{ busy === 'copy' ? '発行中…' : '🔗 URLをコピー' }}</button>
          <button class="sdm-btn send" :disabled="!!busy || !hasRecipient || !selectedTo.length"
            :title="!hasRecipient ? 'この業者は宛先メールが未登録のため送信できません（URLをコピーして手渡してください）' : (!selectedTo.length ? '送信先を1つ以上選んでください' : '')"
            @click="doSend">{{ busy === 'send' ? '送信中…' : sendLabel }}</button>
        </div>
        <p v-if="!hasRecipient" class="sdm-hint-noto">※ 宛先メール未登録のため「送信」は使えません。「🔗 URLをコピー」でリンクを取得し、LINE等で業者へ渡してください。</p>

        <div v-if="history.length" class="sdm-history">
          <div class="sdm-history-title">送信履歴（最新{{ history.length }}件）</div>
          <div v-for="(h, i) in history" :key="i" class="sdm-history-row">
            <span class="sdm-hist-kind" :class="h.kind">{{ h.kind === 'send' ? '📧送信' : '🔗コピー' }}</span>
            <span class="sdm-hist-at">{{ fmtDate(h.created_at) }}</span>
            <span class="sdm-hist-to">{{ h.kind === 'send' ? (h.recipients_masked || []).join(', ') : 'URL発行' }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'

const props = defineProps<{
  visible: boolean
  fnBase: string            // 例: 'estimate-upload' / 'purchase-order' / 'invoice-request' …
  payload: Record<string, any>  // 例: { estimate_id } / { order_id } / { change_id } / { subcontractor_id }
  title: string
  sendLabel?: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'sent'): void; (e: 'copied', url: string): void }>()

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const IS_DEV = import.meta.env.DEV

const sendLabel = props.sendLabel ?? '📧 送信する'
const loading = ref(false)
const busy = ref<'' | 'send' | 'copy'>('')
const subject = ref('')
const body = ref('')
const recipients = ref<{ email: string; label: string }[]>([])
const selectedTo = ref<string[]>([])
const hasRecipient = ref(false)
const errorMsg = ref('')
const okMsg = ref('')
const copiedUrl = ref('')
const confirming = ref(false)
const history = ref<{ kind: string; subject: string | null; created_at: string; recipients_masked: string[] }[]>([])

function fmtDate(s: string) {
  try { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` } catch { return s }
}

function fnName() { return `${IS_DEV ? 'test-send-' : 'send-'}${props.fnBase}` }

async function callEF(extra: Record<string, any>) {
  if (!EDGE_URL) return { ok: false, error: 'Edge Function URL未設定' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: '再ログインしてください' }
  const res = await fetch(`${EDGE_URL}/${fnName()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...props.payload, ...extra }),
  })
  const j = await res.json().catch(() => ({}))
  return { httpOk: res.ok, status: res.status, ...j }
}

async function loadPrepare(silent = false) {
  if (!silent) { loading.value = true; errorMsg.value = ''; okMsg.value = ''; copiedUrl.value = '' }
  const r = await callEF({ mode: 'prepare' })
  loading.value = false
  if (!r.httpOk || r.ok === false) { errorMsg.value = prettyErr(r.error) || '初期値の取得に失敗しました'; return }
  subject.value = r.default_subject ?? ''
  body.value = r.default_body ?? ''
  recipients.value = Array.isArray(r.recipients) ? r.recipients : []
  selectedTo.value = recipients.value.map((x: { email: string }) => x.email)  // 既定で全候補にチェック
  hasRecipient.value = !!r.has_recipient
  history.value = Array.isArray(r.history) ? r.history : []
}

function prettyErr(code: string | undefined): string {
  switch (code) {
    case 'no_recipient_email': return '宛先メールが未登録です'
    case 'no_subcontractor': return '業者が未設定です'
    case 'forbidden': return '権限がありません'
    case 'unauthorized': return 'ログインし直してください'
    default: return code ? `エラー: ${code}` : ''
  }
}

// 「送信」ボタン → まず確認ステップへ（即送信しない）
function doSend() {
  if (!selectedTo.value.length) { errorMsg.value = '送信先を1つ以上選んでください'; return }
  errorMsg.value = ''; okMsg.value = ''; copiedUrl.value = ''
  confirming.value = true
}
// 確認ステップで「送信する」→ 実送信
async function confirmSend() {
  busy.value = 'send'; errorMsg.value = ''
  const r = await callEF({ mode: 'send', subject: subject.value, body: body.value, to: selectedTo.value })
  busy.value = ''
  if (!r.httpOk || r.error) { errorMsg.value = prettyErr(r.error) || '送信に失敗しました'; return }
  confirming.value = false
  okMsg.value = r.test ? '送信しました（dev: 実メールは飛びません）' : `${r.sent_to ?? ''} へ送信しました`
  emit('sent')
  setTimeout(() => emit('close'), 1100)
}

async function doCopy() {
  busy.value = 'copy'; errorMsg.value = ''; okMsg.value = ''; copiedUrl.value = ''
  const r = await callEF({ mode: 'copy' })
  busy.value = ''
  if (!r.httpOk || r.ok === false || !r.url) { errorMsg.value = prettyErr(r.error) || 'URL発行に失敗しました'; return }
  try { await navigator.clipboard.writeText(r.url) } catch { /* クリップボード不可でもURLは表示する */ }
  copiedUrl.value = r.url
  emit('copied', r.url)
  loadPrepare(true)  // 履歴を更新（コピーも履歴に残る・ローディング点滅なし）
}

function close() { emit('close') }

// v-if でマウントされた瞬間 visible=true のことが多い。immediate でマウント時にも prepare を実行する。
watch(() => props.visible, (v) => { if (v) loadPrepare() }, { immediate: true })
</script>

<style scoped>
.sdm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
.sdm { background: #fff; border-radius: 14px; padding: 22px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
.sdm h2 { font-size: 18px; font-weight: 700; margin: 0 0 14px; }
.sdm-loading { padding: 30px; text-align: center; color: #888; }
.sdm-recipient { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 13px; }
.sdm-label { font-weight: 700; color: #888; }
.sdm-noto { color: #c0392b; }
.sdm-recips { display: flex; flex-direction: column; gap: 6px; margin: -4px 0 14px; border: 1px solid #eee; border-radius: 8px; padding: 8px 10px; }
.sdm-recip { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.sdm-recip-label { font-weight: 700; color: #555; white-space: nowrap; }
.sdm-recip-email { font-family: monospace; color: #777; overflow: hidden; text-overflow: ellipsis; }
.sdm-fld { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.sdm-fld span { font-size: 12px; font-weight: 700; color: #666; }
.sdm-input { border: 1px solid #ddd; border-radius: 8px; padding: 9px 12px; font-size: 14px; font-family: inherit; width: 100%; box-sizing: border-box; }
.sdm-textarea { resize: vertical; line-height: 1.6; }
.sdm-note { font-size: 11px; color: #999; margin: -4px 0 12px; }
.sdm-hint-noto { font-size: 12px; color: #b8741a; background: #fff7ec; border-radius: 8px; padding: 8px 10px; margin: 10px 0 0; }
.sdm-copied { font-size: 12px; color: #1a7a3a; background: #eefaf0; border-radius: 8px; padding: 8px 10px; word-break: break-all; }
.sdm-url { font-family: monospace; color: #444; }
.sdm-error { color: #E53935; font-size: 13px; }
.sdm-ok { color: #1a7a3a; font-size: 13px; }
.sdm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
.sdm-btn { border: none; border-radius: 8px; padding: 9px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
.sdm-btn.ghost { background: #f0f0f0; color: #444; }
/* URLコピーは常に押せる＝明確にアクティブな配色（枠付き）。宛先メール無し時は主操作として塗りつぶし強調 */
.sdm-btn.copy { background: #fff; color: #2563eb; border: 1.5px solid #2563eb; }
.sdm-btn.copy:hover { background: #eef2ff; }
.sdm-btn.copy.primary { background: #2563eb; color: #fff; }
.sdm-btn.send { background: #06C755; color: #fff; }
.sdm-btn:disabled { opacity: .4; cursor: not-allowed; }
/* 確認ステップ */
.sdm-confirm-lead { font-size: 14px; font-weight: 700; color: #333; margin: 0 0 12px; }
.sdm-confirm-box { background: #f7f9fa; border-radius: 10px; padding: 14px; }
.sdm-confirm-row { display: flex; gap: 10px; font-size: 13px; margin-bottom: 8px; }
.sdm-confirm-row .sdm-label { min-width: 40px; }
.sdm-confirm-body { white-space: pre-wrap; line-height: 1.6; }
.sdm-chip { display: inline-block; background: #e8f0fe; color: #2563eb; border-radius: 6px; padding: 2px 8px; margin: 0 4px 4px 0; font-family: monospace; font-size: 12px; }
/* 送信履歴 */
.sdm-history { margin-top: 16px; border-top: 1px solid #eee; padding-top: 10px; }
.sdm-history-title { font-size: 12px; font-weight: 700; color: #888; margin-bottom: 6px; }
.sdm-history-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
.sdm-hist-kind { font-weight: 700; white-space: nowrap; }
.sdm-hist-kind.send { color: #1a7a3a; }
.sdm-hist-kind.copy { color: #2563eb; }
.sdm-hist-at { color: #999; white-space: nowrap; }
.sdm-hist-to { color: #666; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
