<template>
  <div>
    <div class="page-header">
      <div>
        <RouterLink to="/calendar" class="back-link">‹ 予定管理へ戻る</RouterLink>
        <h1 class="page-title">予定カテゴリ設定</h1>
      </div>
      <button class="btn-add" @click="openAdd">＋ カテゴリ追加</button>
    </div>
    <p class="page-note">予定管理カレンダーのカテゴリと色を管理します。色はカレンダー上の予定チップに反映されます。</p>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:56px">順序</th>
            <th style="width:64px">色</th>
            <th>カテゴリ名</th>
            <th style="width:90px">状態</th>
            <th style="width:120px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in cats" :key="c.id" :class="{ inactive: !c.active }">
            <td class="order-cell">
              <div class="order-btns">
                <button class="btn-order" :disabled="i === 0" @click="move(c, -1)">▲</button>
                <button class="btn-order" :disabled="i === cats.length - 1" @click="move(c, 1)">▼</button>
              </div>
            </td>
            <td><span class="swatch" :style="{ background: c.color }" /></td>
            <td class="name">{{ c.label }} <span class="key">{{ c.key }}</span></td>
            <td><span class="status" :class="c.active ? 'active' : 'off'">{{ c.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(c)">編集</button>
            </td>
          </tr>
          <tr v-if="cats.length === 0"><td colspan="5" class="empty">カテゴリがありません</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? 'カテゴリを編集' : 'カテゴリを追加' }}</h2>
        <div class="field">
          <label>カテゴリ名</label>
          <input v-model="modal.label" class="input" placeholder="例：現場作業" />
        </div>
        <div class="field">
          <label>色</label>
          <div class="color-row">
            <input v-model="modal.color" type="color" class="color-input" />
            <input v-model="modal.color" class="input" placeholder="#06C755" />
          </div>
        </div>
        <div v-if="modal.id" class="field">
          <label>状態</label>
          <div class="toggle">
            <button :class="{ active: modal.active === true }" @click="modal.active = true">有効</button>
            <button :class="{ active: !modal.active }" @click="modal.active = false">無効</button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
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
import { loadScheduleCategories, type ScheduleCategory } from '../lib/scheduleCategories'

const cats      = ref<ScheduleCategory[]>([])
const loading   = ref(true)
const modal     = ref<Partial<ScheduleCategory> | null>(null)
const saving    = ref(false)
const saveError = ref('')

async function load() {
  loading.value = true
  cats.value = await loadScheduleCategories()
  loading.value = false
}
onMounted(load)

function openAdd() { modal.value = { label: '', color: '#06C755', active: true }; saveError.value = '' }
function openEdit(c: ScheduleCategory) { modal.value = { ...c }; saveError.value = '' }

// ラベルから安全な key を生成（英数以外は除去→空なら cat + 連番）。既存keyと衝突しないようにする。
function makeKey(label: string): string {
  const base = label.trim().toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  let key = base || 'cat'
  const used = new Set(cats.value.map(c => c.key))
  let n = 1
  while (used.has(key)) { key = `${base || 'cat'}-${n++}` }
  return key
}

async function save() {
  const label = (modal.value?.label ?? '').trim()
  if (!label) { saveError.value = 'カテゴリ名を入力してください'; return }
  const color = (modal.value?.color ?? '').trim() || '#94a3b8'
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    if (modal.value?.id) {
      await supabase.from('schedule_categories').update({ label, color, active: modal.value.active ?? true }).eq('id', modal.value.id)
    } else {
      const sort_order = cats.value.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1
      await supabase.from('schedule_categories').insert({ account_id: accountId, key: makeKey(label), label, color, sort_order, active: true })
    }
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally { saving.value = false }
}

// 並び替え（sort_order を隣と交換）
async function move(c: ScheduleCategory, dir: -1 | 1) {
  const idx = cats.value.findIndex(x => x.id === c.id)
  const j = idx + dir
  if (j < 0 || j >= cats.value.length) return
  const other = cats.value[j]
  await Promise.all([
    supabase.from('schedule_categories').update({ sort_order: other.sort_order }).eq('id', c.id),
    supabase.from('schedule_categories').update({ sort_order: c.sort_order }).eq('id', other.id),
  ])
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { display: inline-block; margin-bottom: 4px; font-size: 13px; color: #4338ca; text-decoration: none; font-weight: 600; }
.page-note { color: #64748b; font-size: 13px; margin: 0 0 20px; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.table tr.inactive td { opacity: .45; }
.order-cell { text-align: center; }
.order-btns { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.btn-order { background: #f5f5f5; border: none; border-radius: 4px; width: 28px; height: 22px; font-size: 11px; cursor: pointer; color: #555; }
.btn-order:disabled { opacity: .3; cursor: default; }
.swatch { display: inline-block; width: 28px; height: 28px; border-radius: 6px; border: 1px solid #e0e0e0; }
.name { font-weight: 600; }
.key { font-size: 11px; color: #aaa; font-weight: 400; margin-left: 6px; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.empty { color: #aaa; text-align: center; padding: 32px; }
.actions { text-align: right; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 400px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.color-row { display: flex; gap: 10px; align-items: center; }
.color-input { width: 48px; height: 40px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 2px; cursor: pointer; background: #fff; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
