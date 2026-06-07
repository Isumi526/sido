<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">下請け業者マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>業者名</th><th>区分</th><th>単価（日）</th><th>状態</th><th></th></tr></thead>
        <tbody>
          <tr v-for="s in subs" :key="s.id" :class="{ inactive: !s.active }">
            <td class="name">{{ s.name }}</td>
            <td><span v-if="s.category" class="cat-badge" :class="s.category === '商社' ? 'shosha' : 'gyosha'">{{ s.category }}</span><span v-else class="muted">—</span></td>
            <td>{{ s.unit_price ? '¥' + s.unit_price.toLocaleString() : '—' }}</td>
            <td><span class="status" :class="s.active ? 'active' : 'off'">{{ s.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(s)">編集</button>
              <button class="btn-toggle" @click="toggleActive(s)">{{ s.active ? '無効化' : '有効化' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '業者を編集' : '業者を追加' }}</h2>
        <div class="field">
          <label>業者名</label>
          <input v-model="modal.name" class="input" placeholder="例：○○工務店" />
        </div>
        <div class="field">
          <label>区分 <span class="req">*</span></label>
          <select v-model="modal.category" class="input">
            <option value="" disabled>選択してください</option>
            <option value="商社">商社</option>
            <option value="業者">業者</option>
          </select>
          <span class="hint">集計の商社/業者の振り分けに使います</span>
        </div>
        <div class="field">
          <label>単価（日当・円）</label>
          <input v-model.number="modal.unit_price" class="input" type="number" placeholder="例：20000" />
        </div>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
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

type Sub = { id: string; name: string; active: boolean; category: string | null; unit_price: number | null }
const subs      = ref<Sub[]>([])
const modal     = ref<Partial<Sub> | null>(null)
const saving    = ref(false)
const saveError = ref('')

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('subcontractors').select('id, name, active, category, unit_price').eq('account_id', accountId).order('sort_order')
  subs.value = (data ?? []) as Sub[]
}
onMounted(load)

function openAdd()        { modal.value = { name: '', category: '', unit_price: null }; saveError.value = '' }
function openEdit(s: Sub) { modal.value = { ...s };                                     saveError.value = '' }

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '業者名を入力してください'; return }
  if (!modal.value?.category) { saveError.value = '区分（商社/業者）を選択してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const payload = {
      name:       modal.value.name!.trim(),
      category:   modal.value.category,
      unit_price: modal.value.unit_price || null,
    }
    if (modal.value.id) {
      await supabase.from('subcontractors').update(payload).eq('id', modal.value.id)
    } else {
      const accountId = await getAccountId()
      await supabase.from('subcontractors').insert({ ...payload, account_id: accountId })
    }
    modal.value = null; await load()
  } catch (e: any) { saveError.value = e.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}

async function toggleActive(s: Sub) {
  await supabase.from('subcontractors').update({ active: !s.active }).eq('id', s.id); await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table tr.inactive td { opacity: .4; }
.name { font-weight: 600; }
.cat-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.cat-badge.shosha { background: #fff3e0; color: #e65100; }
.cat-badge.gyosha { background: #e8f4ff; color: #1a6fc4; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 8px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.muted { color: #bbb; font-size: 12px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 360px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; }
.hint { font-size: 11px; color: #aaa; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
