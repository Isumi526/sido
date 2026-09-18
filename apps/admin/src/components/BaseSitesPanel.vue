<template>
  <div class="card" data-testid="base-sites-panel">
    <div class="head">
      <h2>拠点（オフィス・工場）</h2>
      <button class="btn-ghost" data-testid="base-site-add" @click="editing = null; open = true">＋ 拠点を追加</button>
    </div>
    <p class="hint">
      現場に紐づかない経費の紐付け先・作業員の所属拠点・道具の保管場所の拠点になります。現場別集計にはオフィスの行として並びます。
    </p>
    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="!sites.length" class="empty" data-testid="base-sites-empty">拠点がまだありません。「＋ 拠点を追加」から登録してください（例：事務所（名古屋）・工場）。</div>
    <table v-else class="table">
      <thead><tr><th>名前</th><th style="width:100px">区分</th><th>住所</th><th style="width:70px">状態</th><th style="width:80px"></th></tr></thead>
      <tbody>
        <tr v-for="s in sites" :key="s.id" :class="{ inactive: !s.active }" :data-testid="`base-site-row-${s.id}`">
          <td class="name">{{ s.name }}</td>
          <td><span class="kind" :class="s.kind">{{ s.kind === 'office' ? 'オフィス' : '工場' }}</span></td>
          <td class="sub">{{ s.location || '—' }}</td>
          <td class="sub">{{ s.active ? '有効' : '無効' }}</td>
          <td class="actions"><button class="btn-edit" @click="editing = s; open = true">編集</button></td>
        </tr>
      </tbody>
    </table>
    <BaseSiteModal v-if="open" :site="editing" @close="open = false" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
/** 自社情報 › 拠点。保存先は sites.kind=office/factory（BaseSiteModal 参照） */
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import BaseSiteModal, { type BaseSite } from './BaseSiteModal.vue'

type Row = BaseSite & { id: string; active: boolean }
const sites = ref<Row[]>([])
const loading = ref(true)
const open = ref(false)
const editing = ref<Row | null>(null)
const emit = defineEmits<{ (e: 'changed'): void }>()

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data } = await supabase.from('sites').select('id, name, kind, location, active')
    .eq('account_id', accountId).in('kind', ['office', 'factory']).order('sort_order').order('name')
  sites.value = (data ?? []) as Row[]
  loading.value = false
}
async function onSaved() { open.value = false; await load(); emit('changed') }
onMounted(load)
</script>

<style scoped>
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
.card h2 { font-size: 15px; margin: 0; }
.hint { color: #777; font-size: 12px; margin: 0 0 12px; line-height: 1.6; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.empty { color: #aaa; font-size: 13px; padding: 8px 0; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 8px 12px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 8px 12px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.table tr.inactive td { opacity: .45; }
.name { font-weight: 600; }
.sub { color: #64748b; font-size: 13px; }
.kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; }
.kind.factory { background: #fef3c7; color: #92400e; }
.actions { text-align: right; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
</style>
