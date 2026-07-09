<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">ユーザー管理</h1>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>所属</th>
            <th class="center">リマインド受信</th>
            <th class="center">未送信チェック除外</th>
            <th>登録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="name">{{ u.real_name }}</td>
            <td><span class="badge" :class="u.worker_role">{{ u.worker_role === 'factory' ? '工場/事務所' : '現場' }}</span></td>
            <td class="center">
              <button class="toggle" :class="{ on: u.is_reminder_recipient }" :disabled="processing === u.id"
                @click="setFlag(u, 'is_reminder_recipient', !u.is_reminder_recipient)">
                <span class="toggle-knob" /><span class="toggle-text">{{ u.is_reminder_recipient ? 'ON' : 'OFF' }}</span>
              </button>
              <div v-if="u.is_reminder_recipient && !u.line_user_id" class="warn">LINE未連携で受信不可</div>
            </td>
            <td class="center">
              <button class="toggle" :class="{ on: u.reminder_exempt }" :disabled="processing === u.id"
                @click="setFlag(u, 'reminder_exempt', !u.reminder_exempt)">
                <span class="toggle-knob" /><span class="toggle-text">{{ u.reminder_exempt ? 'ON' : 'OFF' }}</span>
              </button>
            </td>
            <td class="date">{{ fmtDate(u.created_at) }}</td>
            <td class="actions">
              <button class="btn-reject" :disabled="processing === u.id" @click="remove(u.id)">削除</button>
            </td>
          </tr>
          <tr v-if="users.length === 0">
            <td colspan="6" class="empty-row">登録済みユーザーはいません</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">
      「リマインド受信」ONのユーザーには、未送信日報リマインドが個人LINEに届きます（本人がグループへ転送）。<br>
      「未送信チェック除外」ONのユーザーは、日報を出さない人として未送信者リストに表示されません。
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type AppUser = {
  id: string
  real_name: string
  worker_role: 'factory' | 'site'
  created_at: string
  line_user_id: string | null
  is_reminder_recipient: boolean
  reminder_exempt: boolean
}

const users      = ref<AppUser[]>([])
const processing = ref<string | null>(null)

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('users')
    .select('id, real_name, worker_role, created_at, line_user_id, is_reminder_recipient, reminder_exempt')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  users.value = (data ?? []) as AppUser[]
}

async function setFlag(u: AppUser, key: 'is_reminder_recipient' | 'reminder_exempt', value: boolean) {
  processing.value = u.id
  const prev = u[key]
  u[key] = value  // 楽観的更新
  const { error } = await supabase.from('users').update({ [key]: value }).eq('id', u.id)
  if (error) { u[key] = prev }  // 失敗時は戻す
  processing.value = null
}

async function remove(id: string) {
  if (!confirm('このユーザーを削除しますか？')) return
  processing.value = id
  await supabase.from('users').delete().eq('id', id)
  await load()
  processing.value = null
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title  { font-size: 22px; font-weight: 700; }
.table-wrap  { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table       { width: 100%; border-collapse: collapse; }
.table th    { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; border-bottom: 1px solid #f0f0f0; font-weight: 600; position: sticky; top: 0; z-index: 2;}
.table th.center, .table td.center { text-align: center; }
.table td    { padding: 14px 16px; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
.table tr:last-child td { border-bottom: none; }
.name        { font-weight: 600; }
.date        { color: #888; font-size: 13px; }
.actions     { display: flex; gap: 8px; justify-content: flex-end; }
.badge       { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.badge.site    { background: #e8f9ef; color: #06C755; }
.badge.factory { background: #e8f0ff; color: #3b82f6; }
.btn-reject  { background: #fff; color: #ef4444; border: 1px solid #ef4444; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-reject:disabled  { opacity: .5; cursor: not-allowed; }
.empty-row   { text-align: center; color: #bbb; font-size: 13px; padding: 20px; }
.toggle { display: inline-flex; align-items: center; gap: 6px; border: none; background: #e6e6e6; border-radius: 999px; padding: 3px 10px 3px 4px; cursor: pointer; }
.toggle.on { background: #06C755; }
.toggle:disabled { opacity: .5; cursor: default; }
.toggle-knob { width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.toggle.on .toggle-knob { transform: translateX(2px); }
.toggle-text { font-size: 11px; font-weight: 700; color: #fff; }
.toggle:not(.on) .toggle-text { color: #999; }
.warn { font-size: 11px; color: #e0902a; margin-top: 4px; }
.hint { color: #888; font-size: 12px; margin-top: 14px; line-height: 1.7; }
</style>
