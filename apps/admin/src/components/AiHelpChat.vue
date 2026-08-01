<template>
  <div class="ai-chat-root">
    <div class="chat" ref="chatEl">
      <div v-if="!messages.length" class="chat-empty">
        <div class="ai-emoji"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">smart_toy</span></div>
        <p>アプリの使い方や仕様について聞いてください。<br>例:「見積書の業者を選ぶと現場が絞られるのはなぜ？」</p>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="msg-col">
          <div class="bubble">
            <div v-if="m.images && m.images.length" class="bubble-images">
              <img v-for="(u, k) in m.images" :key="k" :src="u" class="bubble-img" alt="添付画像" />
            </div>
            <span v-if="m.text">{{ m.text }}</span>
          </div>
          <div v-if="m.options && m.options.length && i === messages.length - 1" class="quick-replies">
            <button v-for="(op, k) in m.options" :key="k" class="qr-btn" :disabled="thinking" @click="send(op)">{{ op }}</button>
          </div>
        </div>
      </div>
      <div v-if="thinking" class="msg ai"><div class="bubble thinking">考え中…</div></div>
    </div>

    <!-- AIが不具合と判定したときだけ起票を促す（バグ検知はユーザーでなくAI） -->
    <div v-if="bugSuggestion" class="bug-suggest">
      <span class="bug-suggest-text"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">bug_report</span> 不具合の可能性があります：「{{ bugSuggestion.title }}」</span>
      <button class="btn-bug" @click="openBug(bugSuggestion)">バックログに記録</button>
      <button class="btn-dismiss" @click="bugSuggestion = null">閉じる</button>
    </div>

    <!-- 添付プレビュー（送信前に外せる） -->
    <div v-if="attachments.length" class="attach-strip" data-testid="ai-attach-strip">
      <div v-for="(a, i) in attachments" :key="i" class="attach-item">
        <img :src="a.url" :alt="a.name" class="attach-thumb" />
        <button type="button" class="attach-remove" :title="`${a.name} を外す`" @click="removeAttachment(i)">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
    </div>
    <p v-if="attachError" class="attach-error" data-testid="ai-attach-error">{{ attachError }}</p>

    <div class="composer" :class="{ dragging }"
         @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
      <label class="btn-attach" :class="{ disabled: thinking }" title="画像を添付（複数可・ドラッグ&ドロップ / 貼り付けも可）">
        <span class="material-symbols-rounded">add_photo_alternate</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
               data-testid="ai-attach-input" :disabled="thinking" @change="onPickFiles" />
      </label>
      <textarea v-model="draft" class="composer-input" rows="2" placeholder="質問を入力…（画像も添付できます / ⌘・Ctrl+Enterで送信）" :disabled="thinking" @paste="onPaste" @keydown.enter.meta.prevent="send()" @keydown.enter.ctrl.prevent="send()"></textarea>
      <button class="btn-send" :disabled="thinking || (!draft.trim() && !attachments.length)" data-testid="ai-send" @click="send()">送信</button>
    </div>
    <div class="composer-actions">
      <button class="btn-bug-manual" @click="openBug()">不具合を手動で報告</button>
      <span v-if="lastTicketUrl" class="ticket-link">記録しました → <a :href="lastTicketUrl" target="_blank" rel="noopener">バックログで開く</a></span>
    </div>

    <!-- バグ報告モーダル -->
    <div v-if="bug" class="modal-overlay" @click.self="bug = null">
      <div class="modal">
        <h2>バグとして報告</h2>
        <p class="hint">内容を確認・修正して送信すると、バックログに「未整理」で起票されます。</p>
        <label class="fld"><span>タイトル <em>*</em></span><input v-model="bug.title" class="input" placeholder="例：見積書フォームで現場が出ない" /></label>
        <label class="fld"><span>詳細</span><textarea v-model="bug.body" class="input" rows="4" placeholder="どの画面で・何をしたら・どうなったか" /></label>
        <p v-if="bugError" class="error">{{ bugError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="bug = null">キャンセル</button>
          <button class="btn-save" :disabled="bugBusy" @click="submitBug">{{ bugBusy ? '起票中…' : '起票する' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { supabase } from '../lib/supabase'
import { compressImageIfNeeded, formatMB } from '../lib/chatAttachmentLimits'

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Msg = { role: 'user' | 'ai'; text: string; options?: string[]; images?: string[] }
type Attachment = { name: string; mimeType: string; data: string; url: string; bytes: number }
const messages = ref<Msg[]>([])
const draft = ref('')
const thinking = ref(false)
const chatEl = ref<HTMLElement | null>(null)
const lastTicketUrl = ref('')

// 画像添付（複数可・D&D・貼り付け）。EF側の受け入れ条件と数値を揃えること。
//  ★上限を小さめに置く理由: base64 は元の約1.34倍に膨らみ、EFのリクエストボディを直に食う。
//   ローカル検証で 6MB の base64 を投げたら edge runtime がタイムアウトした（受け取る前に死ぬ）。
//   そこで「送る前に圧縮」＋「1枚1.5MB・合計4MBまで」に抑える。
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGES = 4
const MAX_BYTES = 1.5 * 1024 * 1024          // 圧縮後の1枚あたり
const MAX_TOTAL_BYTES = 4 * 1024 * 1024      // 全添付の合計（EFが受け取れる範囲）
const attachments = ref<Attachment[]>([])
const attachError = ref('')
const dragging = ref(false)

const bug = ref<{ title: string; body: string } | null>(null)
const bugBusy = ref(false)
const bugError = ref('')
// AIが「不具合の可能性」と判定したときだけ表示する起票サジェスト
const bugSuggestion = ref<{ title: string; body: string } | null>(null)

async function callEF(fn: string, payload: any) {
  if (!EDGE_URL) return { ok: false, error: 'Edge Function URL未設定' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: '再ログインしてください' }
  try {
    const res = await fetch(`${EDGE_URL}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) })
    return await res.json().catch(() => ({ ok: false, error: `エラー (${res.status})` }))
  } catch { return { ok: false, error: '接続できませんでした' } }
}
/** 受け入れ可能な画像だけを添付に足す。弾いた理由は必ず画面に出す（黙って落とさない） */
async function addFiles(files: File[]) {
  attachError.value = ''
  const rejected: string[] = []
  for (const raw of files) {
    if (attachments.value.length >= MAX_IMAGES) { rejected.push(`${raw.name}（上限${MAX_IMAGES}枚）`); continue }
    if (!ALLOWED_MIME.includes(raw.type)) { rejected.push(`${raw.name}（画像以外）`); continue }
    // 大きいスクショはそのままだとEFが受け取れないので、送る前に縮める（現場チャットと同じ処理）
    const f = await compressImageIfNeeded(raw)
    if (f.size > MAX_BYTES) { rejected.push(`${raw.name}（圧縮しても${formatMB(f.size)}で大きすぎる）`); continue }
    const total = attachments.value.reduce((n, a) => n + a.bytes, 0)
    if (total + f.size > MAX_TOTAL_BYTES) { rejected.push(`${raw.name}（合計${formatMB(MAX_TOTAL_BYTES)}を超える）`); continue }
    const data = await toBase64(f)
    attachments.value.push({ name: raw.name, mimeType: f.type, data, url: URL.createObjectURL(f), bytes: f.size })
  }
  if (rejected.length) attachError.value = `添付できなかったファイル: ${rejected.join(' / ')}`
}
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { const s = r.result as string; resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
function onPickFiles(e: Event) {
  const el = e.target as HTMLInputElement
  void addFiles(Array.from(el.files ?? [])).then(() => { el.value = '' })   // 同じファイルを続けて選べるようにクリア
}
function onDrop(e: DragEvent) {
  dragging.value = false
  if (thinking.value) return
  void addFiles(Array.from(e.dataTransfer?.files ?? []))
}
/** スクショの貼り付け（⌘V）。現場からの問い合わせで一番使われる導線 */
function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.items ?? [])
    .filter(it => it.kind === 'file')
    .map(it => it.getAsFile())
    .filter((f): f is File => !!f)
  if (files.length) { e.preventDefault(); void addFiles(files) }
}
function removeAttachment(i: number) {
  URL.revokeObjectURL(attachments.value[i].url)
  attachments.value.splice(i, 1)
  attachError.value = ''
}

async function scrollDown() { await nextTick(); if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight }

async function send(optionText?: string) {
  const msg = (optionText ?? draft.value).trim()
  // 画像だけの送信も許す（スクショを貼って「これ何？」と聞く使い方）
  if ((!msg && !attachments.value.length) || thinking.value) return
  const sending = optionText ? [] : attachments.value.slice()
  // 直前のAIが聞き返し(選択肢付き)なら、次は聞き返さず即答させる（聞き返しは1回まで＝ループ防止）
  const last = messages.value[messages.value.length - 1]
  const allowClarify = !(last?.role === 'ai' && !!last.options?.length)
  messages.value.push({ role: 'user', text: msg, images: sending.map(a => a.url) })
  if (!optionText) { draft.value = ''; attachments.value = []; attachError.value = '' }
  thinking.value = true; await scrollDown()
  const r = await callEF('ai-chat', {
    message: msg, history: messages.value.slice(-9, -1), allowClarify,
    images: sending.map(a => ({ mimeType: a.mimeType, data: a.data })),
  })
  thinking.value = false
  if (r?.ok) {
    const opts = r.needClarify && Array.isArray(r.options) && r.options.length ? r.options as string[] : undefined
    messages.value.push({ role: 'ai', text: r.answer, options: opts })
    // バグ検知はユーザーでなくAIが判定。isBugなら起票を促す（実起票は人の確認後）。聞き返し中は促さない。
    bugSuggestion.value = r.isBug && !opts
      ? { title: (r.bugTitle || msg).slice(0, 80), body: r.bugSummary?.trim() || `質問: ${msg}\nAI回答: ${r.answer}` }
      : null
  } else {
    messages.value.push({ role: 'ai', text: r?.error === 'ai_unavailable' || r?.error === 'ai_unconfigured' ? 'AIが一時的に利用できません。時間をおいて再度お試しください。' : '回答できませんでした。' })
    bugSuggestion.value = null
  }
  await scrollDown()
}

function openBug(preset?: { title: string; body: string }) {
  if (preset) { bug.value = { ...preset }; bugError.value = ''; bugSuggestion.value = null; return }
  const lastUser = [...messages.value].reverse().find(m => m.role === 'user')
  const lastAi = [...messages.value].reverse().find(m => m.role === 'ai')
  bug.value = { title: lastUser?.text?.slice(0, 80) ?? '', body: (lastUser ? `質問: ${lastUser.text}\n` : '') + (lastAi ? `AI回答: ${lastAi.text}` : '') }
  bugError.value = ''
}
async function submitBug() {
  if (!bug.value?.title.trim()) { bugError.value = 'タイトルを入力してください'; return }
  bugBusy.value = true; bugError.value = ''
  const r = await callEF('ai-create-ticket', { title: bug.value.title.trim(), body: bug.value.body })
  bugBusy.value = false
  if (r?.ok) { lastTicketUrl.value = r.url ?? ''; bug.value = null }
  else bugError.value = '起票に失敗しました: ' + (r?.error || '時間をおいて再度お試しください。')
}
</script>

<style scoped>
.ai-chat-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat { flex: 1; min-height: 0; overflow-y: auto; background: #f7f9fa; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.chat-empty { margin: auto; text-align: center; color: #999; }
.ai-emoji { font-size: 40px; }
.chat-empty p { font-size: 13px; line-height: 1.8; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg-col { display: flex; flex-direction: column; gap: 8px; max-width: 76%; align-items: flex-start; }
.msg.user .msg-col { align-items: flex-end; }
.quick-replies { display: flex; flex-wrap: wrap; gap: 8px; }
.qr-btn { background: #fff; color: #06843c; border: 1px solid #9fd8b6; border-radius: 16px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.qr-btn:hover { background: #eafbf1; }
.qr-btn:disabled { opacity: .5; cursor: default; }
.bubble { max-width: 100%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.msg.user .bubble { background: #06C755; color: #fff; border-bottom-right-radius: 4px; }
.msg.ai .bubble { background: #fff; color: #222; border: 1px solid #e8ebee; border-bottom-left-radius: 4px; }
.bubble.thinking { color: #999; }
.composer { display: flex; gap: 8px; margin-top: 12px; }
.attach-strip { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 0 0; }
.attach-item { position: relative; }
.attach-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #ddd; display: block; }
.attach-remove { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #444; color: #fff; cursor: pointer; display: grid; place-items: center; padding: 0; }
.attach-remove .material-symbols-rounded { font-size: 14px; }
.attach-error { color: #b91c1c; font-size: 12px; margin: 6px 0 0; }
.composer.dragging { outline: 2px dashed #2563eb; outline-offset: 4px; border-radius: 10px; }
.btn-attach { display: grid; place-items: center; width: 40px; border: 1px solid #ddd; border-radius: 10px; cursor: pointer; color: #555; background: #fff; }
.btn-attach.disabled { opacity: .5; pointer-events: none; }
.bubble-images { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.bubble-img { max-width: 180px; max-height: 180px; border-radius: 8px; display: block; }
.composer-input { flex: 1; border: 1px solid #ddd; border-radius: 10px; padding: 11px 14px; font-size: 14px; font-family: inherit; resize: vertical; line-height: 1.5; }
.btn-send { background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 11px 22px; font-size: 14px; font-weight: 700; cursor: pointer; align-self: stretch; }
.btn-send:disabled { opacity: .5; }
.bug-suggest { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; background: #fff7ec; border: 1px solid #f0d8b8; border-radius: 10px; padding: 10px 14px; }
.bug-suggest-text { font-size: 13px; color: #8a5a12; font-weight: 700; flex: 1; min-width: 0; }
.btn-bug { background: #b8741a; color: #fff; border: none; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-dismiss { background: none; border: none; color: #999; font-size: 12px; cursor: pointer; }
.composer-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.btn-bug-manual { background: none; border: none; color: #999; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 4px 0; }
.ticket-link { font-size: 12px; color: #888; }
.ticket-link a { color: #1a56c4; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal { background: #fff; border-radius: 14px; padding: 22px; width: 100%; max-width: 460px; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
.hint { font-size: 12px; color: #999; margin: 0 0 14px; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.fld em { color: #E53935; font-style: normal; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 9px 12px; font-size: 14px; font-family: inherit; width: 100%; box-sizing: border-box; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; cursor: pointer; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.error { color: #E53935; font-size: 13px; }
</style>
