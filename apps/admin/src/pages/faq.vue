<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">FAQナレッジ（AIヘルプ）</h1>
      </div>
      <button class="btn-add" @click="openAdd">＋ FAQ追加</button>
    </div>
    <p class="page-note">
      ここに登録した Q&amp;A を
      <RouterLink to="/ai-help" class="inline-link">AIヘルプ</RouterLink>
      が回答の根拠として読み込みます。実際に聞かれた質問を運用で足していくと精度が上がります（想像で埋めない）。
      「言い換え」に別の聞かれ方を足すとヒットしやすくなります。「無効」にしたものはAIに渡しません。
    </p>

    <div class="toolbar">
      <input v-model="q" class="search" placeholder="質問・回答・カテゴリで検索" />
      <span class="count">{{ filtered.length }} 件</span>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:56px">順序</th>
            <th style="width:120px">カテゴリ</th>
            <th>質問</th>
            <th>回答</th>
            <th style="width:80px">言い換え</th>
            <th style="width:80px">状態</th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, i) in filtered" :key="f.id" :class="{ inactive: !f.is_active }">
            <td class="order-cell">
              <div class="order-btns">
                <button class="btn-order" :disabled="i === 0 || !!q" @click="move(f, -1)">▲</button>
                <button class="btn-order" :disabled="i === filtered.length - 1 || !!q" @click="move(f, 1)">▼</button>
              </div>
            </td>
            <td><span v-if="f.category" class="cat">{{ f.category }}</span></td>
            <td class="q-cell">{{ f.question }}</td>
            <td class="a-cell">{{ f.answer }}</td>
            <td class="var-cell">{{ f.variations.length ? f.variations.length + '個' : '—' }}</td>
            <td><span class="status" :class="f.is_active ? 'active' : 'off'">{{ f.is_active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(f)">編集</button>
            </td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="7" class="empty">{{ q ? '該当するFAQがありません' : 'FAQがまだありません。「＋ FAQ追加」から登録してください' }}</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? 'FAQを編集' : 'FAQを追加' }}</h2>
        <div class="field">
          <label>質問 <span class="req">*</span></label>
          <input v-model="modal.question" class="input" placeholder="例：日報を後から編集したい" />
        </div>
        <div class="field">
          <label>回答 <span class="req">*</span></label>
          <textarea v-model="modal.answer" class="input textarea" rows="4" placeholder="例：日報一覧から対象を開き、編集許可を申請します。承認後に編集できます。" />
        </div>
        <div class="field">
          <label>カテゴリ（任意）</label>
          <input v-model="modal.category" class="input" placeholder="例：日報 / 経費 / 見積" list="faq-categories" />
          <datalist id="faq-categories">
            <option v-for="c in categories" :key="c" :value="c" />
          </datalist>
        </div>
        <div class="field">
          <label>言い換え（1行に1つ・別の聞かれ方）</label>
          <textarea v-model="variationsText" class="input textarea" rows="3" placeholder="日報 修正 したい&#10;過去の日報 直す&#10;送った日報 訂正" />
          <span class="hint">retrievalのヒット率を上げる下地です。空でもOK。</span>
        </div>
        <div v-if="modal.id" class="field">
          <label>状態</label>
          <div class="toggle">
            <button :class="{ active: modal.is_active === true }" @click="modal.is_active = true">有効</button>
            <button :class="{ active: !modal.is_active }" @click="modal.is_active = false">無効</button>
          </div>
        </div>
        <div class="modal-actions">
          <button v-if="modal.id" class="btn-delete" :disabled="saving" @click="remove">削除</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

interface FaqEntry {
  id: string
  question: string
  answer: string
  category: string | null
  variations: string[]
  sort_order: number
  is_active: boolean
}

const faqs      = ref<FaqEntry[]>([])
const loading   = ref(true)
const q         = ref('')
const modal     = ref<Partial<FaqEntry> | null>(null)
const variationsText = ref('')
const saving    = ref(false)
const saveError = ref('')

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return faqs.value
  return faqs.value.filter(f =>
    f.question.toLowerCase().includes(kw) ||
    f.answer.toLowerCase().includes(kw) ||
    (f.category ?? '').toLowerCase().includes(kw) ||
    f.variations.some(v => v.toLowerCase().includes(kw))
  )
})

const categories = computed(() =>
  [...new Set(faqs.value.map(f => f.category).filter((c): c is string => !!c))].sort()
)

// jsonb variations は文字列配列を想定。念のため型を吸収する。
function normVariations(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(x => x.trim())
  return []
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('faq_entries')
    .select('id, question, answer, category, variations, sort_order, is_active')
    .eq('account_id', accountId)
    .order('sort_order')
    .order('created_at')
  faqs.value = (data ?? []).map(d => ({ ...d, variations: normVariations(d.variations) })) as FaqEntry[]
  loading.value = false
}
onMounted(load)

function openAdd() {
  modal.value = { question: '', answer: '', category: '', is_active: true }
  variationsText.value = ''
  saveError.value = ''
}
function openEdit(f: FaqEntry) {
  modal.value = { ...f }
  variationsText.value = f.variations.join('\n')
  saveError.value = ''
}

function parseVariations(): string[] {
  return variationsText.value.split('\n').map(s => s.trim()).filter(Boolean)
}

async function save() {
  const question = (modal.value?.question ?? '').trim()
  const answer   = (modal.value?.answer ?? '').trim()
  if (!question) { saveError.value = '質問を入力してください'; return }
  if (!answer)   { saveError.value = '回答を入力してください'; return }
  const category = (modal.value?.category ?? '').trim() || null
  const variations = parseVariations()
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    if (modal.value?.id) {
      await supabase.from('faq_entries').update({
        question, answer, category, variations, is_active: modal.value.is_active ?? true,
        updated_at: new Date().toISOString(),
      }).eq('id', modal.value.id)
    } else {
      const sort_order = faqs.value.reduce((m, f) => Math.max(m, f.sort_order), -1) + 1
      await supabase.from('faq_entries').insert({
        account_id: accountId, question, answer, category, variations, sort_order, is_active: true,
      })
    }
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally { saving.value = false }
}

async function remove() {
  if (!modal.value?.id) return
  if (!confirm('このFAQを削除しますか？')) return
  saving.value = true; saveError.value = ''
  try {
    await supabase.from('faq_entries').delete().eq('id', modal.value.id)
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '削除に失敗しました'
  } finally { saving.value = false }
}

// 並び替え（sort_order を隣と交換）。検索中は無効。
async function move(f: FaqEntry, dir: -1 | 1) {
  const idx = faqs.value.findIndex(x => x.id === f.id)
  const j = idx + dir
  if (j < 0 || j >= faqs.value.length) return
  const other = faqs.value[j]
  await Promise.all([
    supabase.from('faq_entries').update({ sort_order: other.sort_order }).eq('id', f.id),
    supabase.from('faq_entries').update({ sort_order: f.sort_order }).eq('id', other.id),
  ])
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.page-note { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.6; }
.inline-link { color: #4338ca; font-weight: 600; text-decoration: none; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.search { flex: 1; max-width: 360px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 9px 14px; font-size: 14px; box-sizing: border-box; }
.count { font-size: 12px; color: #888; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: top; }
.table tr.inactive td { opacity: .45; }
.order-cell { text-align: center; }
.order-btns { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.btn-order { background: #f5f5f5; border: none; border-radius: 4px; width: 28px; height: 22px; font-size: 11px; cursor: pointer; color: #555; }
.btn-order:disabled { opacity: .3; cursor: default; }
.cat { display: inline-block; background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; }
.q-cell { font-weight: 600; max-width: 260px; }
.a-cell { color: #555; max-width: 340px; white-space: pre-wrap; }
.var-cell { color: #888; font-size: 12px; text-align: center; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.empty { color: #aaa; text-align: center; padding: 32px; }
.actions { text-align: right; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 480px; max-width: 100%; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; font-family: inherit; }
.textarea { resize: vertical; line-height: 1.6; }
.hint { font-size: 11px; color: #aaa; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.btn-delete { background: #fff0f0; color: #E53935; border: 1px solid #ffd0d0; border-radius: 8px; padding: 12px 16px; cursor: pointer; font-weight: 700; }
.btn-delete:disabled { opacity: .5; }
.error { color: #E53935; font-size: 13px; }
</style>
