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
            <th>登録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="name">{{ u.real_name }}</td>
            <td><span class="badge" :class="u.worker_role">{{ u.worker_role === 'factory' ? '工場/事務所' : '現場' }}</span></td>
            <td class="date">{{ fmtDate(u.created_at) }}</td>
            <td class="actions">
              <button class="btn-reject" :disabled="processing === u.id" @click="remove(u.id)">削除</button>
            </td>
          </tr>
          <tr v-if="users.length === 0">
            <td colspan="4" class="empty-row">登録済みユーザーはいません</td>
          </tr>
        </tbody>
      </table>
    </div>
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
}

const users      = ref<AppUser[]>([])
const processing = ref<string | null>(null)

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('users')
    .select('id, real_name, worker_role, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  users.value = (data ?? []) as AppUser[]
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
.table-wrap  { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table       { width: 100%; border-collapse: collapse; }
.table th    { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; border-bottom: 1px solid #f0f0f0; font-weight: 600; }
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
</style>
