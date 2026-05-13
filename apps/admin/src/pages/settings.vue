<template>
  <div>
    <h1 class="page-title">設定</h1>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>項目</th><th>現在値</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in settings" :key="s.key">
            <td class="label-cell">{{ s.label }}</td>
            <td>
              <span v-if="editing !== s.key">{{ s.value }}</span>
              <input v-else v-model="editValue" class="input-inline" :type="s.inputType ?? 'number'" @keyup.enter="save(s)" @keyup.escape="editing = null" />
            </td>
            <td class="actions">
              <template v-if="editing !== s.key">
                <button class="btn-edit" @click="startEdit(s)">編集</button>
              </template>
              <template v-else>
                <button class="btn-save" :disabled="saving" @click="save(s)">保存</button>
                <button class="btn-cancel" @click="editing = null">戻す</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="saveError" class="error">{{ saveError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Setting = { key: string; value: string; label: string; inputType?: string }

// inputType を持たないものは 'number' 扱い（既存の燃料単価など）
const DEFAULTS: Setting[] = [
  { key: 'service_start_date', label: 'サービス開始日', value: '', inputType: 'date' },
]

const settings  = ref<Setting[]>([])
const loading   = ref(false)
const editing   = ref<string | null>(null)
const editValue = ref('')
const saving    = ref(false)
const saveError = ref('')

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data } = await supabase.from('settings').select('key, value, label').eq('account_id', accountId).order('key')
  const fromDb = (data ?? []) as Setting[]

  // DEFAULTS にあるがDBにないものを末尾に追加（value=''で表示）
  const dbKeys = new Set(fromDb.map(s => s.key))
  const merged = [
    ...fromDb.map(s => ({ ...s, inputType: DEFAULTS.find(d => d.key === s.key)?.inputType })),
    ...DEFAULTS.filter(d => !dbKeys.has(d.key)),
  ]
  settings.value = merged
  loading.value = false
}
onMounted(load)

function startEdit(s: Setting) {
  editing.value   = s.key
  editValue.value = s.value
  saveError.value = ''
}

async function save(s: Setting) {
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const { error } = await supabase.from('settings').upsert(
      { key: s.key, value: String(editValue.value), label: s.label, account_id: accountId, updated_at: new Date().toISOString() },
      { onConflict: 'key,account_id' }
    )
    if (error) throw error
    s.value  = String(editValue.value)
    editing.value = null
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }
.empty { color: #888; padding: 40px; text-align: center; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.label-cell { font-weight: 600; color: #333; }
.actions { display: flex; gap: 8px; }
.input-inline { background: #f5f5f5; border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px; font-size: 14px; width: 120px; }
.btn-edit   { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-save   { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
.btn-cancel { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.error { color: #E53935; font-size: 13px; margin-top: 12px; }
</style>
