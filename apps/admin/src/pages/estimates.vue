<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積書管理</h1>
      <button class="btn-add" @click="openAdd">＋ 見積書を登録</button>
    </div>
    <p class="hint">業者から受け取った見積書PDFをアップロードし、業者・現場に紐付けて保存します。合計金額・工事内容は目視で入力してください（AIによる自動抽出は今後対応）。</p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!rows.length" class="empty">まだ見積書がありません。「＋ 見積書を登録」から追加してください。</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>見積番号</th><th>業者</th><th>現場</th><th>発行日</th><th class="num">合計金額</th><th>PDF</th><th></th>
        </tr></thead>
        <tbody>
          <tr v-for="e in rows" :key="e.id">
            <td class="mono">{{ e.estimate_number }}</td>
            <td>{{ subName(e.subcontractor_id) }}</td>
            <td>{{ siteName(e.site_id) }}</td>
            <td>{{ e.estimate_date || '—' }}</td>
            <td class="num">{{ e.total_amount != null ? `¥${e.total_amount.toLocaleString()}` : '—' }}</td>
            <td><a v-if="e.pdf_path" :href="pdfUrl(e.pdf_path)" target="_blank" rel="noopener" class="pdf-link">📄 PDF</a><span v-else class="muted">—</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(e)">編集</button>
              <button class="btn-ghost-sm danger" @click="remove(e)">削除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 登録・編集モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal wide">
        <h2>{{ modal.id ? '見積書を編集' : '見積書を登録' }}</h2>
        <div class="grid2">
          <label class="fld"><span>業者 <em>*</em></span>
            <select v-model="modal.subcontractor_id" class="inp">
              <option :value="null" disabled>選択してください</option>
              <option v-for="s in subs" :key="s.id" :value="s.id">{{ s.name }}{{ s.category ? `（${s.category}）` : '' }}</option>
            </select>
          </label>
          <label class="fld"><span>現場</span>
            <select v-model="modal.site_id" class="inp">
              <option :value="null">—</option>
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
          <label class="fld"><span>見積書発行日</span>
            <input v-model="modal.estimate_date" type="date" class="inp" />
          </label>
          <label class="fld"><span>合計金額（円）</span>
            <input v-model.number="modal.total_amount" type="number" min="0" class="inp" placeholder="例：500000" />
          </label>
        </div>

        <label class="fld"><span>工事内容</span>
          <textarea v-model="modal.construction_details" class="inp" rows="3" placeholder="例：1F内装ボード・クロス工事 一式"></textarea>
        </label>

        <label class="fld"><span>見積書PDF</span>
          <input ref="fileInput" type="file" accept="application/pdf,image/*" class="file-input" @change="onFile" />
          <span v-if="modal.pdf_path && !file" class="hint">登録済み：<a :href="pdfUrl(modal.pdf_path)" target="_blank" rel="noopener" class="pdf-link">📄 現在のPDF</a>（新しく選ぶと差し替え）</span>
        </label>

        <label class="fld"><span>メモ</span>
          <input v-model="modal.note" class="inp" placeholder="任意" />
        </label>

        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Estimate = {
  id: string; subcontractor_id: string | null; site_id: string | null
  estimate_number: string; estimate_date: string | null; total_amount: number | null
  construction_details: string | null; pdf_path: string | null; note: string | null
}
type Opt = { id: string; name: string; category?: string | null }

const BUCKET = 'expense-receipts'
const EST_COLS = 'id, subcontractor_id, site_id, estimate_number, estimate_date, total_amount, construction_details, pdf_path, note'

const rows    = ref<Estimate[]>([])
const subs    = ref<Opt[]>([])
const sites   = ref<Opt[]>([])
const loading = ref(true)
const saving  = ref(false)
const saveError = ref('')
const modal   = ref<(Partial<Estimate>) | null>(null)
const file    = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const subName  = (id: string | null) => subs.value.find((s) => s.id === id)?.name ?? '—'
const siteName = (id: string | null) => sites.value.find((s) => s.id === id)?.name ?? '—'
function pdfUrl(path: string) { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: estRows }, { data: su }, { data: si }] = await Promise.all([
    supabase.from('estimates').select(EST_COLS).eq('account_id', accountId).eq('is_deleted', false).order('estimate_number', { ascending: false }),
    supabase.from('subcontractors').select('id, name, category').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
  ])
  rows.value  = (estRows ?? []) as Estimate[]
  subs.value  = (su ?? []) as Opt[]
  sites.value = (si ?? []) as Opt[]
  loading.value = false
}
onMounted(load)

function openAdd()  { modal.value = { subcontractor_id: null, site_id: null, estimate_date: null, total_amount: null, construction_details: '', note: '' }; file.value = null; saveError.value = ''; if (fileInput.value) fileInput.value.value = '' }
function openEdit(e: Estimate) { modal.value = { ...e }; file.value = null; saveError.value = ''; if (fileInput.value) fileInput.value.value = '' }
function onFile(ev: Event) { file.value = (ev.target as HTMLInputElement).files?.[0] ?? null }

// 見積書番号採番：EST-<年>-<4桁連番>（accountごと・年ごと）
async function nextEstimateNumber(accountId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `EST-${year}-`
  const { data } = await supabase.from('estimates')
    .select('estimate_number')
    .eq('account_id', accountId)
    .like('estimate_number', `${prefix}%`)
    .order('estimate_number', { ascending: false })
    .limit(1)
  const last = data?.[0]?.estimate_number as string | undefined
  const lastSeq = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`
}

async function save() {
  if (!modal.value?.subcontractor_id) { saveError.value = '業者を選択してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const payload = {
      subcontractor_id:     modal.value.subcontractor_id,
      site_id:              modal.value.site_id || null,
      estimate_date:        modal.value.estimate_date || null,
      total_amount:         modal.value.total_amount ?? null,
      construction_details: modal.value.construction_details?.trim() || null,
      note:                 modal.value.note?.trim() || null,
    }
    let estId = modal.value.id
    if (estId) {
      await supabase.from('estimates').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', estId)
    } else {
      const estimate_number = await nextEstimateNumber(accountId)
      const { data, error } = await supabase.from('estimates')
        .insert({ ...payload, account_id: accountId, estimate_number })
        .select('id').single()
      if (error) throw error
      estId = data?.id
    }
    // PDF差し替え（任意）
    if (estId && file.value) {
      const path = `estimates/${accountId}/${estId}.pdf`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file.value, { upsert: true, contentType: file.value.type || 'application/pdf' })
      if (upErr) throw upErr
      await supabase.from('estimates').update({ pdf_path: path }).eq('id', estId)
    }
    modal.value = null; await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function remove(e: Estimate) {
  if (!confirm(`見積書「${e.estimate_number}」を削除しますか？`)) return
  await supabase.from('estimates').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', e.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { font-size: 12px; color: #999; margin: 0 0 20px; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.empty { background: #fff; border-radius: 12px; padding: 40px; text-align: center; color: #aaa; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table th.num, .table td.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; font-weight: 600; }
.muted { color: #bbb; }
.actions { display: flex; gap: 6px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-ghost-sm { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; color: #888; }
.btn-ghost-sm.danger { color: #c0392b; border-color: #f0caca; }
.pdf-link { display: inline-block; font-size: 13px; color: #1a56c4; text-decoration: none; border: 1px solid #cdd8f0; border-radius: 6px; padding: 3px 10px; }
.pdf-link:hover { background: #f0f4ff; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 360px; max-height: 88vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.modal.wide { width: 560px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.fld { display: flex; flex-direction: column; gap: 6px; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.fld em { color: #E53935; font-style: normal; }
.inp { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; font-family: inherit; }
.file-input { font-size: 13px; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
