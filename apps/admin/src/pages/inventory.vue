<template>
  <div class="inv-page">
    <div class="page-header">
      <h1>在庫管理</h1>
      <span class="muted">品目を登録し、入出庫で数量を増減します。作業員アプリの「在庫」（入荷・持出）と日報の引き上げ登録もここに積まれます。</span>
    </div>
    <!-- ★会計在庫ではない（残数把握用）。載せる範囲は運用に委ねる（2026-09-12 決定・閾値は作らない） -->
    <p class="notice" data-testid="inv-notice">会計在庫ではありません（残数把握用）。「何がどれくらい残っているか」を見るための記録です。</p>

    <p v-if="err" class="err" data-testid="inv-err">{{ err }}</p>

    <!-- 品目の追加 -->
    <div class="add-row">
      <input v-model="form.name" class="input" placeholder="品目名（例: 石膏ボード 12.5mm）" data-testid="inv-name" />
      <input v-model="form.category" class="input sm" placeholder="区分（例: ボード）" list="inv-categories" data-testid="inv-category" />
      <datalist id="inv-categories"><option v-for="c in categoryOptions" :key="c" :value="c" /></datalist>
      <input v-model="form.unit" class="input sm" placeholder="単位（枚/本/箱…）" data-testid="inv-unit" />
      <input v-model="form.code" class="input sm" placeholder="品番（任意）" data-testid="inv-code" />
      <input v-model.number="form.qty" type="number" step="any" class="input sm num" placeholder="初期在庫" data-testid="inv-init-qty" />
      <button class="btn-primary" :disabled="!form.name.trim() || busy" data-testid="inv-add" @click="addItem">追加</button>
    </div>

    <table class="table" data-testid="inv-table">
      <thead>
        <tr><th>区分</th><th>品目</th><th>品番</th><th>単位</th><th class="num">現在庫</th><th>入出庫</th></tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" :data-testid="`inv-row-${it.id}`">
          <td class="code" :data-testid="`inv-cat-${it.id}`">{{ it.category || '—' }}</td>
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
        <tr v-if="!items.length"><td colspan="6" class="muted">品目がまだありません。上の欄から追加してください。</td></tr>
      </tbody>
    </table>

    <!-- 移動履歴（在庫①）: 種別・現場・写真・登録者。作業員が現場で撮った写真をここで見る -->
    <h2 class="sec-title">移動履歴</h2>
    <table class="table" data-testid="inv-history">
      <thead>
        <tr><th>日時</th><th>種別</th><th>品目</th><th class="num">増減</th><th>現場</th><th>写真</th><th>登録者</th><th>メモ</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in movements" :key="m.id" :data-testid="`inv-mv-${m.id}`">
          <td class="nowrap">{{ fmtDateTime(m.created_at) }}</td>
          <td><span class="kind" :class="m.kind" :data-testid="`inv-mv-kind-${m.id}`">{{ kindLabel(m.kind) }}</span></td>
          <td>{{ m.inventory_items?.name ?? '—' }}</td>
          <td class="num" :class="m.delta < 0 ? 'neg' : 'pos'">{{ m.delta > 0 ? '+' : '' }}{{ fmt(m.delta) }}{{ m.inventory_items?.unit ?? '' }}</td>
          <td>{{ m.sites?.name ?? '—' }}</td>
          <td>
            <a v-for="(u, i) in (m.photo_urls ?? [])" :key="i" :href="u" target="_blank" rel="noopener" class="photo" :data-testid="`inv-mv-photo-${m.id}`">
              <img :src="u" alt="" loading="lazy" />
            </a>
            <span v-if="!(m.photo_urls ?? []).length" class="muted">—</span>
          </td>
          <td>{{ m.created_by_name ?? '—' }}</td>
          <td class="muted">{{ m.note ?? '' }}{{ m.report_date ? `（日報 ${m.report_date}）` : '' }}</td>
        </tr>
        <tr v-if="!movements.length"><td colspan="8" class="muted">まだ移動の記録はありません。</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Item = { id: string; name: string; unit: string | null; code: string | null; current_qty: number; category: string | null }
type Movement = {
  id: string; delta: number; kind: string; note: string | null; created_by_name: string | null; created_at: string
  photo_urls: string[] | null; report_date: string | null
  inventory_items: { name: string; unit: string | null } | null
  sites: { name: string } | null
}
const movements = ref<Movement[]>([])
const kindLabel = (k: string) => k === 'in' ? '入荷' : k === 'out' ? '持出' : k === 'return' ? '引上げ' : '調整'
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

const accountId = ref('')
const items     = ref<Item[]>([])
// 在庫②: 区分の候補（自社で使っている区分＋既定セット。EF inventory の DEFAULT_CATEGORIES と同じ値）
const DEFAULT_CATEGORIES = ['ボード', '下地材', '床材', '天井材', '接着剤・副資材', 'ビス・金物', '塗料・シーリング', '養生・消耗品', 'その他']
const categoryOptions = computed(() => { const used = [...new Set(items.value.map(i => i.category).filter(Boolean) as string[])]; return [...used, ...DEFAULT_CATEGORIES.filter(c => !used.includes(c))] })
const form      = reactive<{ name: string; unit: string; code: string; qty: number | null; category: string }>({ name: '', unit: '', code: '', qty: null, category: '' })
const moveQty   = reactive<Record<string, number | null>>({})
const moveNote  = reactive<Record<string, string>>({})
const busy      = ref(false)
const err       = ref('')

const fmt = (n: number) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 3 })

async function load() {
  accountId.value = await getAccountId()
  const { data, error } = await supabase.from('inventory_items')
    .select('id, name, unit, code, current_qty, category').eq('account_id', accountId.value).eq('active', true).order('category').order('name')
  if (error) { err.value = error.message; return }
  items.value = (data ?? []).map((x: any) => ({ ...x, current_qty: Number(x.current_qty) }))
  const { data: mv } = await supabase.from('inventory_movements')
    .select('id, delta, kind, note, created_by_name, created_at, photo_urls, report_date, inventory_items(name, unit), sites(name)')
    .eq('account_id', accountId.value).order('created_at', { ascending: false }).limit(100)
  movements.value = ((mv ?? []) as any[]).map((m) => ({ ...m, delta: Number(m.delta) }))
}

async function addItem() {
  const name = form.name.trim()
  if (!name) return
  busy.value = true; err.value = ''
  const { error } = await supabase.from('inventory_items').insert({
    account_id: accountId.value, name, unit: form.unit.trim() || null, code: form.code.trim() || null,
    category: form.category.trim() || null,   // 在庫②: 区分→詳細の第1段（LIFF の予測検索で絞る）
    current_qty: Number(form.qty) || 0,
  })
  busy.value = false
  if (error) { err.value = /duplicate|unique/i.test(error.message) ? `品目「${name}」は既に登録済みです` : error.message; return }
  form.name = ''; form.unit = ''; form.code = ''; form.qty = null; form.category = ''
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
  // ★種別つきの版を呼ぶ（在庫①）。管理画面の入庫＝入荷 / 出庫＝持出（現場なし）。写真・登録者は無し
  const { error } = await supabase.rpc('inventory_move', {
    p_item_id: it.id,
    p_delta: sign * q,
    p_note: (moveNote[it.id] ?? '').trim() || null,
    p_kind: sign > 0 ? 'in' : 'out',
    p_site_id: null,
    p_photo_urls: [],
    p_created_by_worker_id: null,
    p_created_by_name: null,
    p_report_date: null,
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
.notice { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 10px; margin: 0 0 12px; }
.sec-title { font-size: 15px; margin: 22px 0 8px; }
.nowrap { white-space: nowrap; }
.kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.kind.in { background: #ecfdf5; color: #047857; } .kind.out { background: #fff7ed; color: #c2410c; } .kind.return { background: #eff6ff; color: #1d4ed8; }
.pos { color: #047857; } .neg { color: #c2410c; }
.photo img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; margin-right: 4px; border: 1px solid #e2e8f0; }
</style>
