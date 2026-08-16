<template>
  <div>
    <div class="page-header">
      <div>
        <RouterLink to="/sites" class="back-link">‹ 現場マスタへ戻る</RouterLink>
        <h1 class="page-title">作業区分の設定</h1>
      </div>
      <button class="btn-add" @click="openAdd">＋ 区分を追加</button>
    </div>
    <p class="page-note">
      1つの現場に対して「現場作業」「見積」「事務」など複数の作業があります。日報や予定でどの作業かを選べるようにし、区分ごとに定時を設定できます。
    </p>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:56px">順序</th>
            <th>区分名</th>
            <th style="width:150px">使える台帳</th>
            <th style="width:90px">状態</th>
            <th style="width:170px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in cats" :key="c.id" :class="{ inactive: !c.active }" :data-testid="`cat-row-${c.id}`">
            <td class="order-cell">
              <div class="order-btns">
                <button class="btn-order" :disabled="i === 0 || busy" @click="move(i, -1)">▲</button>
                <button class="btn-order" :disabled="i === cats.length - 1 || busy" @click="move(i, 1)">▼</button>
              </div>
            </td>
            <td class="name">
              {{ c.name }}
              <span v-if="c.is_default" class="tag-default">標準</span>
            </td>
            <td class="scope">{{ scopeLabel(c.scope) }}</td>
            <td><span class="status" :class="c.active ? 'active' : 'off'">{{ c.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" :disabled="busy" @click="openEdit(c)">編集</button>
              <button class="btn-del" :disabled="busy" @click="remove(c)">削除</button>
            </td>
          </tr>
          <tr v-if="cats.length === 0"><td colspan="5" class="empty">区分がありません</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '区分を編集' : '区分を追加' }}</h2>
        <div class="field">
          <label>区分名</label>
          <input v-model="modal.name" class="input" data-testid="cat-name" placeholder="例：夜間作業" />
        </div>
        <div class="field">
          <label>使える台帳</label>
          <select v-model="modal.scope" class="input" data-testid="cat-scope">
            <option :value="null">どこでも</option>
            <option value="site">現場のみ</option>
            <option value="office">事務所のみ</option>
            <option value="event">社内行事のみ</option>
          </select>
          <p class="hint">絞っておくと、関係ない台帳で選択肢に出てきません（例：慰安旅行を現場の選択肢に出さない）。</p>
        </div>
        <div v-if="modal.id" class="field">
          <label>状態</label>
          <div class="toggle">
            <button :class="{ active: modal.active !== false }" @click="modal.active = true">有効</button>
            <button :class="{ active: modal.active === false }" @click="modal.active = false">無効</button>
          </div>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" data-testid="cat-save" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 作業区分の設定（会社ごと）。
 *
 * ★書き込みは EF(master-data) 経由。work_categories は RLS 有効で
 *  authenticated の INSERT/UPDATE/DELETE を剥がしてあるため、テーブル直叩きは通らない。
 *  権限の確認・使用中チェック・他テナントの拒否はすべて EF 側で行う。
 */
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

interface WorkCategory {
  id: string
  name: string
  scope: string | null
  sort_order: number
  active: boolean
  is_default: boolean
}

const cats      = ref<WorkCategory[]>([])
const loading   = ref(true)
const busy      = ref(false)
const modal     = ref<Partial<WorkCategory> | null>(null)
const saving    = ref(false)
const saveError = ref('')

const SCOPE_LABELS: Record<string, string> = {
  site: '現場のみ', office: '事務所のみ', event: '社内行事のみ',
}
const scopeLabel = (s: string | null) => (s ? SCOPE_LABELS[s] ?? s : 'どこでも')

/** EF を呼ぶ。失敗はエラーコードで返す（画面側で日本語にする） */
async function callEf(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  const { data, error } = await supabase.functions.invoke('master-data', { body: payload })
  if (error) return { ok: false, error: 'network' }
  return data?.ok ? { ok: true, data } : { ok: false, error: data?.error ?? 'failed', data }
}

async function load() {
  loading.value = true
  const r = await callEf({ action: 'categories' })
  cats.value = (r.data?.categories ?? []) as WorkCategory[]
  loading.value = false
}

function openAdd() { saveError.value = ''; modal.value = { name: '', scope: 'site', active: true } }
function openEdit(c: WorkCategory) { saveError.value = ''; modal.value = { ...c } }

const SAVE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: '同じ名前の区分が既にあります。',
  CATEGORY_FORBIDDEN: '区分を変更する権限がありません。',
  not_found: '対象の区分が見つかりません（削除された可能性があります）。',
  name_required: '区分名を入力してください。',
}

async function save() {
  if (!modal.value) return
  const name = (modal.value.name ?? '').trim()
  if (!name) { saveError.value = '区分名を入力してください。'; return }
  saving.value = true; saveError.value = ''
  const r = await callEf({
    action: 'category-save',
    ...(modal.value.id ? { id: modal.value.id } : {}),
    name, scope: modal.value.scope ?? null, active: modal.value.active !== false,
  })
  saving.value = false
  if (!r.ok) { saveError.value = SAVE_ERRORS[r.error ?? ''] ?? `保存に失敗しました（${r.error}）`; return }
  modal.value = null
  await load()
}

async function remove(c: WorkCategory) {
  // ★使用中かは EF が判定する。ここで先に聞くのは「消す意思」だけ
  if (!confirm(`「${c.name}」を削除しますか？`)) return
  busy.value = true
  const r = await callEf({ action: 'category-delete', id: c.id })
  busy.value = false
  if (!r.ok) {
    if (r.error === 'IN_USE') {
      const n = (r.data?.schedules ?? 0) + (r.data?.hours ?? 0)
      alert(`「${c.name}」は${n}件で使われているため削除できません。\n使っている予定・定時設定を先に外してください。`)
    } else {
      alert(SAVE_ERRORS[r.error ?? ''] ?? `削除に失敗しました（${r.error}）`)
    }
    return
  }
  await load()
}

/** 並び替え。EF 側で2件の sort_order を入れ替える */
async function move(index: number, dir: -1 | 1) {
  const a = cats.value[index]
  const b = cats.value[index + dir]
  if (!a || !b) return
  busy.value = true
  const r = await callEf({ action: 'category-move', id: a.id, otherId: b.id })
  busy.value = false
  if (!r.ok) { alert(`並び替えに失敗しました（${r.error}）`); return }
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { display: inline-block; margin-bottom: 4px; font-size: 13px; color: #4338ca; text-decoration: none; font-weight: 600; }
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
.tag-default { font-size: 11px; color: #0a8a3a; background: #e8fff0; border-radius: 4px; padding: 2px 6px; margin-left: 8px; font-weight: 700; }
.scope { color: #64748b; font-size: 13px; }
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
