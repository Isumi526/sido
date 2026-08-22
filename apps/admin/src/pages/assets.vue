<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">物品マスタ（ETCカード）</h1>
      </div>
      <button class="btn-add" data-testid="asset-generate-open" @click="openGenerate">＋ 枚数を指定して追加</button>
    </div>
    <p class="page-note">
      ETCカードなどの物品を管理します。枚数を指定すると「丸一1」「丸一2」…と連番でデフォルト名が付きます。名前は後から自由に変更できます。
      日報の高速代でここに登録したカードが選べるようになります（未登録の間は従来の「カード①〜⑦」が出ます）。
    </p>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:56px">順序</th>
            <th>名前</th>
            <th style="width:90px">状態</th>
            <th style="width:170px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(a, i) in assets" :key="a.id" :class="{ inactive: !a.active }" :data-testid="`asset-row-${a.id}`">
            <td class="order-cell">
              <div class="order-btns">
                <button class="btn-order" :disabled="i === 0 || busy" @click="move(i, -1)">▲</button>
                <button class="btn-order" :disabled="i === assets.length - 1 || busy" @click="move(i, 1)">▼</button>
              </div>
            </td>
            <td class="name">{{ a.name }}</td>
            <td><span class="status" :class="a.active ? 'active' : 'off'">{{ a.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" :disabled="busy" @click="openEdit(a)">編集</button>
              <button class="btn-del" :disabled="busy" @click="remove(a)">削除</button>
            </td>
          </tr>
          <tr v-if="assets.length === 0"><td colspan="4" class="empty">物品がありません。「枚数を指定して追加」から登録してください。</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 枚数指定で一括生成 -->
    <div v-if="genModal" class="modal-overlay" @click.self="genModal = false">
      <div class="modal">
        <h2>枚数を指定して追加</h2>
        <div class="field">
          <label>枚数</label>
          <input v-model.number="genCount" type="number" min="1" max="100" class="input" data-testid="asset-gen-count" />
          <p class="hint">「丸一1」から連番でデフォルト名を付けて{{ genCount || 0 }}枚作成します（既にある番号の続きから採番）。名前は後で変更できます。</p>
        </div>
        <p v-if="genError" class="error">{{ genError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="generating" data-testid="asset-gen-save" @click="generate">{{ generating ? '作成中...' : '作成' }}</button>
          <button class="btn-cancel" @click="genModal = false">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 名前・状態の編集 -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>物品を編集</h2>
        <div class="field">
          <label>名前</label>
          <input v-model="modal.name" class="input" data-testid="asset-name" placeholder="例：丸一1" />
        </div>
        <div class="field">
          <label>状態</label>
          <div class="toggle">
            <button :class="{ active: modal.active !== false }" @click="modal.active = true">有効</button>
            <button :class="{ active: modal.active === false }" @click="modal.active = false">無効</button>
          </div>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" data-testid="asset-save" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 物品マスタ（会社ごと）。第一弾は固定カテゴリ ETCカード（category='etc_card'）。
 *
 * ★書き込みは EF(master-data) 経由。assets は RLS 有効で authenticated の
 *  INSERT/UPDATE/DELETE を剥がしてあるため、テーブル直叩きは通らない。
 *  権限確認・他テナント拒否はすべて EF 側で行う（work-categories.vue と同型）。
 */
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const CATEGORY = 'etc_card'

interface Asset {
  id: string
  category: string
  name: string
  sort_order: number
  active: boolean
}

const assets    = ref<Asset[]>([])
const loading   = ref(true)
const busy      = ref(false)
const modal     = ref<Partial<Asset> | null>(null)
const saving    = ref(false)
const saveError = ref('')
const genModal  = ref(false)
const genCount  = ref<number>(1)
const generating = ref(false)
const genError  = ref('')

/** EF を呼ぶ。失敗はエラーコードで返す（画面側で日本語にする） */
async function callEf(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  const { data, error } = await supabase.functions.invoke('master-data', { body: payload })
  if (error) return { ok: false, error: 'network' }
  return data?.ok ? { ok: true, data } : { ok: false, error: data?.error ?? 'failed', data }
}

async function load() {
  loading.value = true
  const r = await callEf({ action: 'assets', category: CATEGORY })
  assets.value = (r.data?.assets ?? []) as Asset[]
  loading.value = false
}

const SAVE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: '同じ名前の物品が既にあります。',
  ASSET_FORBIDDEN: '物品を変更する権限がありません。',
  not_found: '対象の物品が見つかりません（削除された可能性があります）。',
  name_required: '名前を入力してください。',
  count_required: '枚数を入力してください。',
}

function openGenerate() { genError.value = ''; genCount.value = 1; genModal.value = true }

async function generate() {
  const n = Math.floor(Number(genCount.value) || 0)
  if (n < 1) { genError.value = '枚数を1以上で入力してください。'; return }
  generating.value = true; genError.value = ''
  const r = await callEf({ action: 'asset-generate', category: CATEGORY, count: n })
  generating.value = false
  if (!r.ok) { genError.value = SAVE_ERRORS[r.error ?? ''] ?? `作成に失敗しました（${r.error}）`; return }
  genModal.value = false
  await load()
}

function openEdit(a: Asset) { saveError.value = ''; modal.value = { ...a } }

async function save() {
  if (!modal.value) return
  const name = (modal.value.name ?? '').trim()
  if (!name) { saveError.value = '名前を入力してください。'; return }
  saving.value = true; saveError.value = ''
  const r = await callEf({
    action: 'asset-save',
    category: CATEGORY,
    ...(modal.value.id ? { id: modal.value.id } : {}),
    name, active: modal.value.active !== false,
  })
  saving.value = false
  if (!r.ok) { saveError.value = SAVE_ERRORS[r.error ?? ''] ?? `保存に失敗しました（${r.error}）`; return }
  modal.value = null
  await load()
}

async function remove(a: Asset) {
  if (!confirm(`「${a.name}」を削除しますか？\n（過去の日報に記録された名前はそのまま残ります）`)) return
  busy.value = true
  const r = await callEf({ action: 'asset-delete', id: a.id })
  busy.value = false
  if (!r.ok) { alert(SAVE_ERRORS[r.error ?? ''] ?? `削除に失敗しました（${r.error}）`); return }
  await load()
}

/** 並び替え。EF 側で2件の sort_order を入れ替える */
async function move(index: number, dir: -1 | 1) {
  const a = assets.value[index]
  const b = assets.value[index + dir]
  if (!a || !b) return
  busy.value = true
  const r = await callEf({ action: 'asset-move', id: a.id, otherId: b.id })
  busy.value = false
  if (!r.ok) { alert(`並び替えに失敗しました（${r.error}）`); return }
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.page-note { color: #64748b; font-size: 13px; margin: 0 0 20px; line-height: 1.7; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.table tr.inactive td { opacity: .45; }
.order-cell { text-align: center; }
.order-btns { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.btn-order { background: #f5f5f5; border: none; border-radius: 4px; width: 28px; height: 22px; font-size: 11px; cursor: pointer; color: #555; }
.btn-order:disabled { opacity: .3; cursor: default; }
.name { font-weight: 600; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.empty { color: #aaa; text-align: center; padding: 32px; }
.actions { text-align: right; white-space: nowrap; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-del { background: #fff1f0; color: #c0392b; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-left: 8px; }
.btn-edit:disabled, .btn-del:disabled { opacity: .4; cursor: default; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 400px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.hint { font-size: 12px; color: #94a3b8; margin: 2px 0 0; line-height: 1.6; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
