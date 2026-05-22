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

  <!-- 未送信リマインド手動実行 -->
  <div class="reminder-box">
    <div class="reminder-header">
      <div>
        <div class="reminder-title">未送信日報リマインド</div>
        <div class="reminder-desc">サービス開始日〜昨日の未送信者にLINE通知を送ります（毎朝8時自動実行）</div>
      </div>
      <div class="reminder-btns">
        <button class="btn-dry" :disabled="reminding" @click="runReminder(true)">
          {{ reminding === 'dry' ? '確認中...' : 'ドライラン（確認のみ）' }}
        </button>
        <button class="btn-remind" :disabled="!!reminding" @click="runReminder(false)">
          {{ reminding === 'send' ? '送信中...' : 'LINE通知を送る' }}
        </button>
      </div>
    </div>
    <div v-if="reminderResult" class="reminder-result" :class="reminderResult.type">
      <pre>{{ reminderResult.message }}</pre>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId, ACCOUNT_SLUG } from '../lib/account'

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const IS_DEV   = import.meta.env.DEV

const reminding     = ref<false | 'dry' | 'send'>(false)
const reminderResult = ref<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)

function fmtDate(d: string): string {
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
  const dt = new Date(d + 'T12:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}

async function runReminder(dryRun: boolean) {
  if (!EDGE_URL) { alert('VITE_SUPABASE_EDGE_URL が未設定です'); return }
  reminding.value = dryRun ? 'dry' : 'send'
  reminderResult.value = null
  try {
    const fnName = IS_DEV ? 'test-daily-reminder' : 'daily-reminder'
    // ローカルは自アカウント(ACCOUNT_SLUG)のみ対象
    const body: any = { dry_run: dryRun, account_slug: ACCOUNT_SLUG }
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_URL}/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? res.statusText)

    // results配列からメッセージを構築（LINEと同じフォーマット）
    const results: { slug: string; result: string; unsubmitted: { name: string; dates: string[]; mentionTarget?: string }[] }[] = data.results ?? []
    const allUnsubmitted = results.flatMap(r => r.unsubmitted)
    const yesterday: string = data.yesterday ?? ''

    if (allUnsubmitted.length === 0) {
      reminderResult.value = { type: 'info', message: '✅ 全員送信済みです' }
    } else {
      const lines: string[] = [
        '📋 日報未送信リマインド（敬称略）',
        `📅 ${yesterday ? fmtDate(yesterday) : ''} 時点`,
        '──────────',
      ]
      for (const r of results) {
        if (!r.unsubmitted.length) continue
        for (const u of r.unsubmitted) {
          const displayName = u.mentionTarget
            ? u.name.replace(u.mentionTarget, `@${u.mentionTarget}`)
            : u.name
          lines.push(`⚠️ ${displayName}`)
          const MAX = 5
          u.dates.slice(0, MAX).forEach(d => lines.push(`  ${fmtDate(d)}`))
          if (u.dates.length > MAX) lines.push(`  他${u.dates.length - MAX}日`)
        }
      }
      reminderResult.value = {
        type: dryRun ? 'info' : 'success',
        message: (dryRun ? '【プレビュー】\n' : '✅ 送信完了\n') + lines.join('\n'),
      }
    }
  } catch (e: any) {
    reminderResult.value = { type: 'error', message: `❌ エラー: ${e.message}` }
  } finally {
    reminding.value = false
  }
}

type Setting = { key: string; value: string; label: string; inputType?: string }

// inputType を持たないものは 'number' 扱い（既存の燃料単価など）
const DEFAULTS: Setting[] = [
  { key: 'service_start_date', label: 'サービス開始日',    value: '', inputType: 'date' },
  { key: 'notify_group_id',    label: 'LINE通知グループID', value: '', inputType: 'text' },
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

.reminder-box { margin-top: 32px; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.reminder-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.reminder-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.reminder-desc { font-size: 12px; color: #888; }
.reminder-btns { display: flex; gap: 10px; flex-shrink: 0; }
.btn-dry    { background: #f5f5f5; color: #555; border: 1px solid #ddd; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.btn-dry:hover:not(:disabled) { background: #e8e8e8; }
.btn-remind { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-remind:hover:not(:disabled) { opacity: .85; }
.btn-dry:disabled, .btn-remind:disabled { opacity: .5; cursor: not-allowed; }
.reminder-result { margin-top: 16px; border-radius: 8px; padding: 14px 16px; }
.reminder-result pre { font-size: 13px; white-space: pre-wrap; word-break: break-all; margin: 0; font-family: inherit; }
.reminder-result.success { background: #e8f9ef; color: #1a5c30; }
.reminder-result.info    { background: #f0f4ff; color: #1e3a8a; }
.reminder-result.error   { background: #fff0f0; color: #c0392b; }
</style>
