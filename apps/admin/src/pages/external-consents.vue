<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">外部者の規約同意</h1>
    </div>
    <p class="hint">
      協力業者ポータル・チャット招待の外部者が、いつ・どの文言に同意したかの記録です。
      同意しないとポータルの操作へ進めません。
    </p>

    <div class="reminder-box" style="margin-bottom:20px">
      <div class="reminder-title">今の同意文言（バージョン {{ version }}）</div>
      <div class="reminder-config">
        <textarea
          v-model="text" class="terms-input" rows="6"
          data-testid="terms-text" placeholder="外部者に表示する同意文言"
        ></textarea>
        <p class="hint" style="margin:8px 0">
          文言を変えたらバージョンも上げてください。バージョンが変わると、外部者は次のアクセスで
          あらためて同意を求められます。<b>過去の同意記録は文面ごと残る</b>ので遡って確認できます。
        </p>
        <div class="config-row">
          <label class="ver-label">バージョン</label>
          <input v-model="version" class="input-inline" data-testid="terms-version" />
          <button class="btn-save" :disabled="saving" data-testid="terms-save" @click="save">保存</button>
        </div>
        <p v-if="msg" class="hint" data-testid="terms-result">{{ msg }}</p>
      </div>
    </div>

    <div v-if="!rows.length" class="empty" data-testid="consents-empty">まだ同意の記録はありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="consents-table">
        <thead>
          <tr><th>相手</th><th>種別</th><th>同意した版</th><th>日時</th><th>同意した文面</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="consent-row">
            <td class="name">{{ r.subject_label || '—' }}</td>
            <td>{{ KIND_LABEL[r.subject_kind] ?? r.subject_kind }}</td>
            <td>{{ r.terms_version }}</td>
            <td class="muted">{{ fmt(r.consented_at) }}</td>
            <td class="terms-cell">{{ r.consented_text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  外部者の規約同意（契約対応②・契約 別紙2§9）
//
//  ★契約は「協力業者ポータル・チャット招待ゲストに同意文言を表示・記録する機能を提供」と
//   書いているのに未実装だった。ここは記録の確認と文言の差し替えを行う画面。
//
//  ★同意記録は「版」だけでなく **同意した時点の文面そのもの** を持っている。
//   文言を差し替えた後で「あの業者は何に同意したのか」が分からなくなるのを防ぐため。
//   なので一覧にも文面を出す（証跡として見えないと意味がない）。
// ============================================================
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Row = {
  id: string; subject_kind: string; subject_label: string | null
  terms_version: string; consented_text: string; consented_at: string
}

const KIND_LABEL: Record<string, string> = {
  subcontractor_portal: '協力業者ポータル',
  chat_guest: 'チャット招待',
}

const rows = ref<Row[]>([])
const text = ref('')
const version = ref('0')
const saving = ref(false)
const msg = ref('')

function fmt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function load() {
  const accountId = await getAccountId()
  if (!accountId) return
  const [{ data: cs }, { data: st }] = await Promise.all([
    supabase.from('external_consents')
      .select('id, subject_kind, subject_label, terms_version, consented_text, consented_at')
      .eq('account_id', accountId).order('consented_at', { ascending: false }).limit(200),
    supabase.from('settings').select('key, value').eq('account_id', accountId)
      .in('key', ['external_terms_text', 'external_terms_version']),
  ])
  rows.value = (cs ?? []) as Row[]
  const kv = Object.fromEntries((st ?? []).map((r: any) => [r.key, r.value]))
  text.value = String(kv['external_terms_text'] ?? '')
  version.value = String(kv['external_terms_version'] ?? '0')
}

async function save() {
  saving.value = true; msg.value = ''
  try {
    const accountId = await getAccountId()
    if (!accountId) throw new Error('アカウントを特定できませんでした')
    const rowsToSave = [
      { account_id: accountId, key: 'external_terms_text', value: text.value, label: '外部者向け同意文言' },
      { account_id: accountId, key: 'external_terms_version', value: version.value.trim() || '0', label: '外部者向け同意文言のバージョン' },
    ]
    const { error } = await supabase.from('settings').upsert(rowsToSave, { onConflict: 'account_id,key' })
    if (error) throw new Error(error.message)
    msg.value = '保存しました'
    await load()
  } catch (e) {
    msg.value = `保存できませんでした: ${String((e as Error).message)}`
  } finally { saving.value = false }
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { color: #6b7280; font-size: 13px; line-height: 1.7; }
.empty { color: #6b7280; padding: 24px; text-align: center; }
.reminder-box { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden; max-width: 820px; }
.reminder-title { padding: 10px 14px; font-weight: 700; font-size: 14px; background: #f9fafb; }
.reminder-config { padding: 14px; }
.terms-input { width: 100%; padding: 10px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 13px; font-family: inherit; line-height: 1.7; }
.config-row { display: flex; gap: 10px; align-items: center; }
.ver-label { font-size: 13px; color: #6b7280; }
.input-inline { padding: 6px 10px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 13px; width: 80px; }
.btn-save { background: #047857; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; cursor: default; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; text-align: left; vertical-align: top; }
.table th { background: #f9fafb; font-weight: 700; white-space: nowrap; }
.name { font-weight: 600; }
.muted { color: #6b7280; white-space: nowrap; }
.terms-cell { color: #6b7280; font-size: 12px; max-width: 420px; white-space: pre-wrap; }
</style>
