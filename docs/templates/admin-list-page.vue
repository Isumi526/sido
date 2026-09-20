<!--
  管理画面の一覧ページの雛形（2026-09-20・「新規画面が共通の作りに乗る」）
  新しいページはこれを apps/admin/src/pages/<name>.vue にコピーして始める。
  ★守ること（node scripts/check-admin-pages.mjs が機械で検査する）:
   1. 見出し横に <HelpButton>（使い方ナビ）を置く。新機能ほど説明が要る
   2. 使うクラスは src/style.css の共通キット（page-header / page-title / hint / empty / filters /
      filter-input / result-count / input / select / table-wrap / table / num / btn-primary / btn-ghost）か、
      このページの <style scoped> に定義する。定義の無いクラスを書かない（余白・行間が効かず「詰まって見える」）
   3. 絵文字は使わずアイコン（material-symbols-rounded）。node scripts/check-no-emoji.mjs
   4. 画面を足したら router / screenNames / App.vue のメニューを足し、node scripts/build-screen-catalog.mjs を再生成
   5. 操作の主要導線には data-testid を付ける（E2E 用）
-->
<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">画面名</h1>
      <HelpButton title="画面名" :items="[
        'この画面で何ができるか（1行）。',
        '主な操作の手順（1〜3行）。',
        '注意点（承認が要る・元に戻せない・誰に見えるか 等）。',
      ]" />
    </div>
    <p class="hint">この画面の目的と、見方の要点を1〜2文で。<strong>強調したい所は strong。</strong></p>

    <div class="filters">
      <input v-model="q" class="input filter-input" placeholder="検索" data-testid="xx-search" />
      <select v-model="status" class="select" data-testid="xx-status">
        <option value="">すべて</option>
        <option value="active">有効</option>
      </select>
      <span class="result-count">{{ filtered.length }} 件</span>
      <button class="btn-primary" data-testid="xx-add" @click="openNew">＋ 追加</button>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!filtered.length" class="empty" data-testid="xx-empty">まだ登録がありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="xx-table">
        <thead>
          <tr><th>名前</th><th class="num">数量</th><th>状態</th><th class="actions-col">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" :data-testid="`xx-row-${r.id}`">
            <td class="name">{{ r.name }}</td>
            <td class="num">{{ r.qty }}</td>
            <td><span class="status" :class="r.active ? 'ok' : 'ng'">{{ r.active ? '有効' : '無効' }}</span></td>
            <td class="actions-col"><button class="btn-ghost" @click="edit(r)">編集</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'

type Row = { id: string; name: string; qty: number; active: boolean }

const loading = ref(true)
const rows = ref<Row[]>([])
const q = ref('')
const status = ref('')

const filtered = computed(() => rows.value.filter(r =>
  (!q.value || r.name.includes(q.value)) && (!status.value || (status.value === 'active') === r.active)))

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const { data } = await supabase.from('xx_table').select('id, name, qty, active').eq('account_id', accountId).order('name')
  rows.value = (data ?? []) as Row[]
  loading.value = false
}
function openNew() { /* モーダルを開く */ }
function edit(_r: Row) { /* モーダルを開く */ }
onMounted(load)
</script>

<style scoped>
/* 共通キットに無い、このページ固有のクラスだけをここに定義する */
.name { font-weight: 600; white-space: nowrap; }
.actions-col { white-space: nowrap; }
.status { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.status.ok { color: #15803d; background: #dcfce7; }
.status.ng { color: #b91c1c; background: #fee2e2; }
</style>
