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

  <!-- 日報通知 ON/OFF -->
  <div class="reminder-box">
    <div class="reminder-title">日報通知（LINE）</div>
    <div class="reminder-config">
      <div class="config-row">
        <span class="config-label">送信・編集の通知</span>
        <button
          class="toggle"
          :class="{ on: reportNotifyEnabled }"
          :disabled="reportNotifySaving"
          @click="setReportNotifyEnabled(!reportNotifyEnabled)"
        >
          <span class="toggle-knob" />
          <span class="toggle-text">{{ reportNotifyEnabled ? 'ON' : 'OFF' }}</span>
        </button>
      </div>
      <div class="reminder-desc">
        ONの時、日報の新規送信・編集をLINEグループに通知します。OFFにすると通知しません（日報の保存・集計には影響しません）。
      </div>
    </div>
  </div>

  <!-- 未送信リマインド -->
  <div class="reminder-box">
    <div class="reminder-title">未送信日報リマインド</div>

    <!-- 自動実行設定 -->
    <div class="reminder-config">
      <div class="config-row">
        <span class="config-label">自動実行</span>
        <button
          class="toggle"
          :class="{ on: reminderEnabled }"
          :disabled="reminderConfigSaving"
          @click="setReminderEnabled(!reminderEnabled)"
        >
          <span class="toggle-knob" />
          <span class="toggle-text">{{ reminderEnabled ? 'ON' : 'OFF' }}</span>
        </button>
      </div>
      <div class="config-row">
        <span class="config-label">実行時間（JST）</span>
        <select
          v-model="reminderTime"
          class="select-time"
          :disabled="reminderConfigSaving || !reminderEnabled"
          @change="setReminderTime(reminderTime)"
        >
          <option v-for="h in 24" :key="h - 1" :value="`${String(h - 1).padStart(2, '0')}:00`">
            {{ String(h - 1).padStart(2, '0') }}:00
          </option>
        </select>
      </div>
    </div>

    <!-- 手動実行 -->
    <div class="reminder-header">
      <div class="reminder-desc">サービス開始日〜昨日の未送信者にLINE通知（手動実行）</div>
      <div class="reminder-btns">
        <button class="btn-dry" :disabled="!!reminding" @click="runReminder(true)">
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

// ── 日報通知（送信・編集）ON/OFF ──────────────────────────
const reportNotifyEnabled = ref(true)
const reportNotifySaving  = ref(false)

function setReportNotifyEnabled(val: boolean) {
  reportNotifyEnabled.value = val
  reportNotifySaving.value = true
  upsertSetting('notify_report_enabled', String(val), '日報通知（送信・編集）')
    .finally(() => { reportNotifySaving.value = false })
}

// ── リマインダー設定 ──────────────────────────────────────
const reminderEnabled     = ref(true)
const reminderTime        = ref('08:00')
const reminderConfigSaving = ref(false)

async function loadReminderConfig() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('settings').select('key, value')
    .eq('account_id', accountId)
    .in('key', ['reminder_enabled', 'reminder_time', 'notify_report_enabled'])
  const m = Object.fromEntries((data ?? []).map(s => [s.key, s.value]))
  reminderEnabled.value     = (m['reminder_enabled'] ?? 'true') === 'true'
  reminderTime.value        = m['reminder_time'] ?? '08:00'
  reportNotifyEnabled.value = (m['notify_report_enabled'] ?? 'true') === 'true'
}

async function upsertSetting(key: string, value: string, label: string) {
  reminderConfigSaving.value = true
  const accountId = await getAccountId()
  await supabase.from('settings').upsert(
    { key, value, label, account_id: accountId, updated_at: new Date().toISOString() },
    { onConflict: 'key,account_id' }
  )
  reminderConfigSaving.value = false
}

function setReminderEnabled(val: boolean) {
  reminderEnabled.value = val
  upsertSetting('reminder_enabled', String(val), 'リマインド自動実行')
}

function setReminderTime(val: string) {
  upsertSetting('reminder_time', val, 'リマインド実行時間')
}

// ── 手動実行 ──────────────────────────────────────────────
const reminding      = ref<false | 'dry' | 'send'>(false)
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
    const body: any = { dry_run: dryRun, account_slug: ACCOUNT_SLUG, manual: true }
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

    const results: { slug: string; result: string; unsubmitted: { name: string; dates: string[] }[] }[] = data.results ?? []
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
          lines.push(`⚠️ ${u.name}`)
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

// ── 汎用設定テーブル ──────────────────────────────────────
type Setting = { key: string; value: string; label: string; inputType?: string }

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
  const { data } = await supabase.from('settings').select('key, value, label')
    .eq('account_id', accountId)
    .not('key', 'in', '(reminder_enabled,reminder_time,notify_report_enabled)')
    .order('key')
  const fromDb = (data ?? []) as Setting[]

  const dbKeys = new Set(fromDb.map(s => s.key))
  const merged = [
    ...fromDb.map(s => ({ ...s, inputType: DEFAULTS.find(d => d.key === s.key)?.inputType })),
    ...DEFAULTS.filter(d => !dbKeys.has(d.key)),
  ]
  settings.value = merged
  loading.value = false
}

onMounted(() => {
  load()
  loadReminderConfig()
})

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
.reminder-title { font-size: 15px; font-weight: 700; margin-bottom: 16px; }

/* 自動実行設定 */
.reminder-config { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #f9f9f9; border-radius: 8px; margin-bottom: 20px; }
.config-row { display: flex; align-items: center; gap: 12px; }
.config-label { font-size: 13px; color: #555; width: 120px; flex-shrink: 0; }

.toggle { display: flex; align-items: center; gap: 8px; background: #ddd; border: none; border-radius: 20px; padding: 4px 12px 4px 4px; cursor: pointer; transition: background .2s; width: 80px; }
.toggle.on { background: #06C755; }
.toggle:disabled { opacity: .5; cursor: not-allowed; }
.toggle-knob { width: 22px; height: 22px; background: #fff; border-radius: 50%; flex-shrink: 0; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.toggle.on .toggle-knob { transform: translateX(2px); }
.toggle-text { font-size: 12px; font-weight: 700; color: #fff; }
.toggle:not(.on) .toggle-text { color: #888; }

.select-time { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 14px; cursor: pointer; }
.select-time:disabled { opacity: .5; cursor: not-allowed; }

/* 手動実行 */
.reminder-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
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
