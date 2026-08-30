<template>
  <div class="inv-page">
    <div class="page-header">
      <h1>在庫管理</h1>
      <span class="muted">品目を登録し、入出庫で数量を増減します（会社単位・最小構成）。</span>
    </div>

    <p v-if="err" class="err" data-testid="inv-err">{{ err }}</p>

    <!-- 品目の追加 -->
    <div class="add-row">
      <input v-model="form.name" class="input" placeholder="品目名（例: 石膏ボード 12.5mm）" data-testid="inv-name" />
      <input v-model="form.unit" class="input sm" placeholder="単位（枚/本/箱…）" data-testid="inv-unit" />
      <input v-model="form.code" class="input sm" placeholder="品番（任意）" data-testid="inv-code" />
      <input v-model.number="form.qty" type="number" step="any" class="input sm num" placeholder="初期在庫" data-testid="inv-init-qty" />
      <button class="btn-primary" :disabled="!form.name.trim() || busy" data-testid="inv-add" @click="addItem">追加</button>
    </div>

    <table class="table" data-testid="inv-table">
      <thead>
        <tr><th>品目</th><th>品番</th><th>単位</th><th class="num">現在庫</th><th>入出庫</th></tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" :data-testid="`inv-row-${it.id}`">
          <td>{{ it.name }}</td>
          <td class="code">{{ it.code || '—' }}</td>
          <td>{{ it.unit || '—' }}</td>
          <td class="num qty" :data-testid="`inv-qty-${it.id}`">{{ fmt(it.current_qty) }}</td>
          <td class="move-cell">
            <input v-model.number="moveQty[it.id]" type="number" step="any" min="0" class="input xs num" placeholder="数量" :data-testid="`inv-move-qty-${it.id}`" />
            <input v-model="moveNote[it.id]" class="input xs" placeholder="メモ(任意)" :data-testid="`inv-move-note-${it.id}`" />
            <button class="btn-in" :disabled="busy || !(Number(moveQty[it.id]) > 0)" :data-testid="`inv-in-${it.id}`" @click="move(it, 1)">
              <span class="material-symbols-rounded">add</span>入庫
            </button>
            <button class="btn-out" :disabled="busy || !(Number(moveQty[it.id]) > 0)" :data-testid="`inv-out-${it.id}`" @click="move(it, -1)">
              <span class="material-symbols-rounded">remove</span>出庫
            </button>
          </td>
        </tr>
        <tr v-if="!items.length"><td colspan="5" class="muted">品目がまだありません。上の欄から追加してください。</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Item = { id: string; name: string; unit: string | null; code: string | null; current_qty: number }

const accountId = ref('')
const items     = ref<Item[]>([])
const form      = reactive<{ name: string; unit: string; code: string; qty: number | null }>({ name: '', unit: '', code: '', qty: null })
const moveQty   = reactive<Record<string, number | null>>({})
const moveNote  = reactive<Record<string, string>>({})
const busy      = ref(false)
const err       = ref('')

const fmt = (n: number) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 3 })

async function load() {
  accountId.value = await getAccountId()
  const { data, error } = await supabase.from('inventory_items')
    .select('id, name, unit, code, current_qty').eq('account_id', accountId.value).eq('active', true).order('name')
  if (error) { err.value = error.message; return }
  items.value = (data ?? []).map((x: any) => ({ ...x, current_qty: Number(x.current_qty) }))
}

async function addItem() {
  const name = form.name.trim()
  if (!name) return
  busy.value = true; err.value = ''
  const { error } = await supabase.from('inventory_items').insert({
    account_id: accountId.value, name, unit: form.unit.trim() || null, code: form.code.trim() || null,
    current_qty: Number(form.qty) || 0,
  })
  busy.value = false
  if (error) { err.value = /duplicate|unique/i.test(error.message) ? `品目「${name}」は既に登録済みです` : error.message; return }
  form.name = ''; form.unit = ''; form.code = ''; form.qty = null
  await load()
}

// 入出庫: sign=+1(入庫)/-1(出庫)。
// ★2026-08-30: 「画面が持っている値＋差分」で上書きするのをやめ、DB側で加減する
//  関数(inventory_move)に一本化した。以前は複数人・複数タブで同じ品目をほぼ同時に
//  触ると後から押した方が相手の分を消していた（履歴の合計と現在庫が合わなくなる）。
//  履歴の追加と現在庫の加減も、この関数の中で1トランザクションにまとまっている。
async function move(it: Item, sign: 1 | -1) {
  const q = Number(moveQty[it.id])
  if (!(q > 0)) return
  busy.value = true; err.value = ''
  const { error } = await supabase.rpc('inventory_move', {
    p_item_id: it.id,
    p_delta: sign * q,
    p_note: (moveNote[it.id] ?? '').trim() || null,
  })
  busy.value = false
  if (error) { err.value = error.message; await load(); return }
  moveQty[it.id] = null; moveNote[it.id] = ''
  await load()
}

onMounted(load)
</script>

<style scoped>
.inv-page { padding: 16px; max-width: 960px; }
.page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.page-header h1 { font-size: 20px; margin: 0; }
.muted { color: #888; font-size: 12px; }
.err { color: #dc2626; font-size: 13px; margin: 6px 0; }
.add-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.input { padding: 6px 10px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 13px; }
.input.sm { max-width: 140px; } .input.xs { max-width: 90px; padding: 4px 8px; } .input.num { text-align: right; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { border-bottom: 1px solid #eef1f3; padding: 8px 10px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.qty { font-weight: 700; }
.code { color: #666; font-family: ui-monospace, monospace; }
.move-cell { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.btn-primary { background: #06843c; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-weight: 700; cursor: pointer; }
.btn-primary:disabled { opacity: .5; cursor: default; }
.btn-in, .btn-out { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; background: #fff; }
.btn-in { color: #06843c; border-color: #9fd8b6; } .btn-in:hover { background: #eafbf1; }
.btn-out { color: #b45309; border-color: #fcd9a8; } .btn-out:hover { background: #fff7ed; }
.btn-in:disabled, .btn-out:disabled { opacity: .5; cursor: default; }
.btn-in .material-symbols-rounded, .btn-out .material-symbols-rounded { font-size: 16px; }
</style>
