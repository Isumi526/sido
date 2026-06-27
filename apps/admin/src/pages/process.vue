<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">工程管理
        <HelpButton title="工程管理の使い方" :items="[
          '現場を選び、工程（タスク）を開始日・終了日・担当・進捗で登録します。',
          'バーは各工程の期間、緑の塗りは進捗%を表します。',
          '「＋ 工程を追加」から登録。各行の編集/削除で更新できます。',
        ]" />
      </h1>
      <div class="header-actions">
        <select v-model="siteId" class="input" @change="load">
          <option :value="''" disabled>現場を選択</option>
          <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="btn-add" :disabled="!siteId" @click="openAdd">＋ 工程を追加</button>
      </div>
    </div>

    <div v-if="!siteId" class="empty">現場を選択してください。</div>
    <div v-else-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!tasks.length" class="empty">この現場の工程はまだありません。「＋ 工程を追加」から登録してください。</div>
    <div v-else class="gantt-wrap">
      <div class="gantt-range">{{ rangeStart }} 〜 {{ rangeEnd }}</div>
      <div class="gantt">
        <div v-for="t in tasks" :key="t.id" class="g-row">
          <div class="g-label">
            <div class="g-name">{{ t.name }}</div>
            <div class="g-sub">{{ t.assignee || '担当未設定' }} ・ {{ t.start_date || '—' }}〜{{ t.end_date || '—' }}</div>
          </div>
          <div class="g-track">
            <div class="g-bar" :style="barStyle(t)">
              <div class="g-fill" :style="{ width: (t.progress || 0) + '%' }" />
              <span class="g-pct">{{ t.progress || 0 }}%</span>
            </div>
          </div>
          <div class="g-actions">
            <button class="btn-edit" @click="openEdit(t)">編集</button>
            <button class="btn-ghost-sm danger" @click="remove(t)">削除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '工程を編集' : '工程を追加' }}</h2>
        <label class="fld"><span>工程名 <em>*</em></span><input v-model="modal.name" class="input" placeholder="例：内装ボード" /></label>
        <label class="fld"><span>担当</span><input v-model="modal.assignee" class="input" placeholder="例：山田" /></label>
        <div class="grid2">
          <label class="fld"><span>開始日</span><input v-model="modal.start_date" type="date" class="input" /></label>
          <label class="fld"><span>終了日</span><input v-model="modal.end_date" type="date" class="input" /></label>
        </div>
        <label class="fld"><span>進捗：{{ modal.progress || 0 }}%</span>
          <input v-model.number="modal.progress" type="range" min="0" max="100" step="5" />
        </label>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'

type Task = { id: string; site_id: string; name: string; assignee: string | null; start_date: string | null; end_date: string | null; progress: number; sort_order: number }

const sites   = ref<{ id: string; name: string }[]>([])
const siteId  = ref('')
const tasks   = ref<Task[]>([])
const loading = ref(false)
const modal   = ref<Partial<Task> | null>(null)
const saving  = ref(false)
const saveError = ref('')

const DAY = 86400000
const rangeStart = computed(() => tasks.value.reduce((m, t) => (t.start_date && (!m || t.start_date < m) ? t.start_date : m), '' as string))
const rangeEnd   = computed(() => tasks.value.reduce((m, t) => (t.end_date && (!m || t.end_date > m) ? t.end_date : m), '' as string))

function barStyle(t: Task) {
  const s = rangeStart.value ? new Date(rangeStart.value).getTime() : 0
  const e = rangeEnd.value ? new Date(rangeEnd.value).getTime() : 0
  const span = Math.max(e - s, DAY)
  const ts = t.start_date ? new Date(t.start_date).getTime() : s
  const te = t.end_date ? new Date(t.end_date).getTime() : ts + DAY
  const left = Math.max(0, ((ts - s) / span) * 100)
  const width = Math.max(4, ((te - ts + DAY) / span) * 100)
  return { left: left + '%', width: Math.min(width, 100 - left) + '%' }
}

async function loadSites() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name')
  sites.value = (data ?? []) as any[]
}
async function load() {
  if (!siteId.value) return
  loading.value = true
  const { data } = await supabase.from('process_tasks').select('id, site_id, name, assignee, start_date, end_date, progress, sort_order').eq('site_id', siteId.value).order('start_date', { nullsFirst: false }).order('sort_order')
  tasks.value = (data ?? []) as Task[]
  loading.value = false
}
onMounted(loadSites)

function openAdd()  { modal.value = { name: '', assignee: '', start_date: null, end_date: null, progress: 0 }; saveError.value = '' }
function openEdit(t: Task) { modal.value = { ...t }; saveError.value = '' }

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '工程名を入力してください'; return }
  if (modal.value.start_date && modal.value.end_date && modal.value.end_date < modal.value.start_date) { saveError.value = '終了日は開始日以降にしてください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const payload = {
      name: modal.value.name!.trim(), assignee: modal.value.assignee?.trim() || null,
      start_date: modal.value.start_date || null, end_date: modal.value.end_date || null,
      progress: Math.max(0, Math.min(100, Number(modal.value.progress) || 0)), updated_at: new Date().toISOString(),
    }
    if (modal.value.id) await supabase.from('process_tasks').update(payload).eq('id', modal.value.id)
    else await supabase.from('process_tasks').insert({ ...payload, account_id: accountId, site_id: siteId.value, sort_order: tasks.value.length })
    modal.value = null; await load()
  } catch (e: any) { saveError.value = e.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}
async function remove(t: Task) {
  if (!confirm(`工程「${t.name}」を削除しますか？`)) return
  await supabase.from('process_tasks').delete().eq('id', t.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 14px; font-family: inherit; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-add:disabled { opacity: .5; }
.empty { color: #888; padding: 50px; text-align: center; }

.gantt-wrap { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.gantt-range { font-size: 12px; color: #888; margin-bottom: 12px; }
.gantt { display: flex; flex-direction: column; gap: 8px; }
.g-row { display: grid; grid-template-columns: 220px 1fr 120px; gap: 12px; align-items: center; }
.g-label { min-width: 0; }
.g-name { font-size: 14px; font-weight: 700; color: #222; }
.g-sub { font-size: 11px; color: #999; }
.g-track { position: relative; height: 26px; background: #f4f6f8; border-radius: 6px; }
.g-bar { position: absolute; top: 3px; height: 20px; background: #cdd8f0; border-radius: 5px; overflow: hidden; min-width: 8px; }
.g-fill { position: absolute; left: 0; top: 0; height: 100%; background: #06C755; opacity: .7; }
.g-pct { position: absolute; right: 6px; top: 2px; font-size: 11px; font-weight: 700; color: #333; z-index: 1; }
.g-actions { display: flex; gap: 6px; justify-content: flex-end; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-ghost-sm { background: none; border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; color: #666; }
.btn-ghost-sm.danger { color: #E53935; border-color: #f5c6c6; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal { background: #fff; border-radius: 14px; padding: 22px; width: 100%; max-width: 420px; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 16px; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.fld em { color: #E53935; font-style: normal; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; cursor: pointer; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.error { color: #E53935; font-size: 13px; margin: 4px 0; }
</style>
