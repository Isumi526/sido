<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">作業員マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>所属</th>
            <th>日当単価</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in workers" :key="w.id" :class="{ inactive: !w.active }">
            <td class="name">{{ w.name }}</td>
            <td><span class="badge" :class="w.role">{{ w.role === 'factory' ? '工場/事務所' : '現場' }}</span></td>
            <td class="price">¥{{ w.unit_price.toLocaleString() }}</td>
            <td><span class="status" :class="w.active ? 'active' : 'off'">{{ w.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(w)">編集</button>
              <button class="btn-toggle" @click="toggleActive(w)">{{ w.active ? '無効化' : '有効化' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '作業員を編集' : '作業員を追加' }}</h2>
        <div class="field">
          <label>名前</label>
          <input v-model="modal.name" class="input" placeholder="例：山田 太郎" />
        </div>
        <div class="field">
          <label>所属</label>
          <div class="toggle">
            <button :class="{ active: modal.role === 'factory' }" @click="modal.role = 'factory'">工場/事務所</button>
            <button :class="{ active: modal.role === 'site' }" @click="modal.role = 'site'">現場</button>
          </div>
        </div>
        <div class="field">
          <label>日当単価（円）</label>
          <input v-model.number="modal.unit_price" type="number" class="input" placeholder="20000" />
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

type Worker = { id: string; name: string; role: 'factory' | 'site'; unit_price: number; active: boolean }

const workers   = ref<Worker[]>([])
const modal     = ref<Partial<Worker> | null>(null)
const saving    = ref(false)
const saveError = ref('')

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('workers')
    .select('id, name, role, unit_price, active')
    .eq('account_id', accountId)
    .order('role').order('sort_order')
  workers.value = (data ?? []) as Worker[]
}

onMounted(load)

function openAdd() {
  modal.value = { name: '', role: 'site', unit_price: 20000 }
  saveError.value = ''
}

function openEdit(w: Worker) {
  modal.value = { ...w }
  saveError.value = ''
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '名前を入力してください'; return }
  saving.value = true
  saveError.value = ''
  try {
    if (modal.value.id) {
      await supabase.from('workers').update({
        name:       modal.value.name.trim(),
        role:       modal.value.role,
        unit_price: modal.value.unit_price ?? 0,
      }).eq('id', modal.value.id)
    } else {
      const accountId = await getAccountId()
      await supabase.from('workers').insert({
        name:       modal.value.name!.trim(),
        role:       modal.value.role ?? 'site',
        unit_price: modal.value.unit_price ?? 0,
        account_id: accountId,
      })
    }
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function toggleActive(w: Worker) {
  await supabase.from('workers').update({ active: !w.active }).eq('id', w.id)
  await load()
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
.price { font-variant-numeric: tabular-nums; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.factory { background: #e8f4ff; color: #1a6fc4; }
.badge.site { background: #e8fff0; color: #0a8a3a; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 8px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 400px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
