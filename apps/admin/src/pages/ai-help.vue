<template>
  <div class="ai-help">
    <div class="page-header">
      <h1 class="page-title">AIヘルプ
        <HelpButton title="AIヘルプの使い方" :items="[
          'アプリの操作や仕様について質問すると、仕様を理解したAIが回答します。',
          '不具合かもと思ったら「バグとして報告」でバックログに起票できます。',
          '回答はAIによる参考情報です。重要な操作は実際の画面でご確認ください。',
        ]" />
      </h1>
    </div>

    <div class="chat" ref="chatEl">
      <div v-if="!messages.length" class="chat-empty">
        <div class="ai-emoji">🤖</div>
        <p>アプリの使い方や仕様について聞いてください。<br>例:「見積書の業者を選ぶと現場が絞られるのはなぜ？」</p>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="bubble">{{ m.text }}</div>
      </div>
      <div v-if="thinking" class="msg ai"><div class="bubble thinking">考え中…</div></div>
    </div>

    <div class="composer">
      <input v-model="draft" class="composer-input" placeholder="質問を入力…" @keydown.enter.prevent="send" :disabled="thinking" />
      <button class="btn-send" :disabled="thinking || !draft.trim()" @click="send">送信</button>
    </div>
    <div class="composer-actions">
      <button class="btn-bug" @click="openBug">🐛 バグとして報告</button>
      <span v-if="lastTicketUrl" class="ticket-link">起票しました → <a :href="lastTicketUrl" target="_blank" rel="noopener">バックログで開く</a></span>
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
import HelpButton from '../components/HelpButton.vue'

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Msg = { role: 'user' | 'ai'; text: string }
const messages = ref<Msg[]>([])
const draft = ref('')
const thinking = ref(false)
const chatEl = ref<HTMLElement | null>(null)
const lastTicketUrl = ref('')

const bug = ref<{ title: string; body: string } | null>(null)
const bugBusy = ref(false)
const bugError = ref('')

async function callEF(fn: string, payload: any) {
  if (!EDGE_URL) return { ok: false, error: 'Edge Function URL未設定' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: '再ログインしてください' }
  const res = await fetch(`${EDGE_URL}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) })
  return await res.json().catch(() => ({ ok: false, error: `エラー (${res.status})` }))
}
async function scrollDown() { await nextTick(); if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight }

async function send() {
  const msg = draft.value.trim()
  if (!msg || thinking.value) return
  messages.value.push({ role: 'user', text: msg })
  draft.value = ''; thinking.value = true; await scrollDown()
  const r = await callEF('ai-chat', { message: msg, history: messages.value.slice(-9, -1) })
  thinking.value = false
  if (r?.ok) messages.value.push({ role: 'ai', text: r.answer })
  else messages.value.push({ role: 'ai', text: r?.error === 'ai_unavailable' || r?.error === 'ai_unconfigured' ? 'AIが一時的に利用できません。時間をおいて再度お試しください。' : '回答できませんでした。' })
  await scrollDown()
}

function openBug() {
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
  else bugError.value = '起票に失敗しました: ' + (r?.error ?? '')
}
</script>

<style scoped>
.ai-help { display: flex; flex-direction: column; height: calc(100vh - 90px); }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
.chat { flex: 1; overflow-y: auto; background: #f7f9fa; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.chat-empty { margin: auto; text-align: center; color: #999; }
.ai-emoji { font-size: 40px; }
.chat-empty p { font-size: 13px; line-height: 1.8; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.bubble { max-width: 76%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.msg.user .bubble { background: #06C755; color: #fff; border-bottom-right-radius: 4px; }
.msg.ai .bubble { background: #fff; color: #222; border: 1px solid #e8ebee; border-bottom-left-radius: 4px; }
.bubble.thinking { color: #999; }
.composer { display: flex; gap: 8px; margin-top: 12px; }
.composer-input { flex: 1; border: 1px solid #ddd; border-radius: 10px; padding: 11px 14px; font-size: 14px; font-family: inherit; }
.btn-send { background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 11px 22px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-send:disabled { opacity: .5; }
.composer-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.btn-bug { background: #fff4e5; color: #b8741a; border: 1px solid #f0d8b8; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
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
