<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">協力会社マスタ</h1>
      <div class="header-actions">
        <button v-if="!mergeMode" class="btn-ghost" @click="startMerge">業者をマージ</button>
        <template v-else>
          <button class="btn-ghost" :disabled="mergePick.length !== 2" @click="openMerge">マージ実行（{{ mergePick.length }}/2）</button>
          <button class="btn-ghost" @click="cancelMerge">キャンセル</button>
        </template>
        <button class="btn-add" @click="openAdd">＋ 追加</button>
      </div>
    </div>

    <!-- 検索・絞り込み -->
    <div class="filters">
      <input v-model="q" class="input filter-input" placeholder="業者名・代表者名で検索" />
      <select v-model="filterTrade" class="input filter-input">
        <option value="">工種（すべて）</option>
        <option v-for="t in tradeOptions" :key="t" :value="t">{{ t }}</option>
      </select>
      <input v-model="filterArea" class="input filter-input" placeholder="対応エリアで絞り込み" />
      <label class="toggle"><input type="checkbox" v-model="showDeleted" /> 削除済みを表示</label>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th v-if="mergeMode"></th>
          <th>業者名</th><th>区分</th><th>工種</th><th>対応エリア</th><th>状態</th><th></th>
        </tr></thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id" :class="{ inactive: !s.active || s.is_deleted }">
            <td v-if="mergeMode"><input type="checkbox" :value="s.id" v-model="mergePick" :disabled="s.is_deleted" /></td>
            <td class="name">{{ s.name }}<span v-if="s.is_deleted" class="del-badge">削除済み</span></td>
            <td><span v-if="s.category" class="cat-badge" :class="s.category === '商社' ? 'shosha' : 'gyosha'">{{ s.category }}</span><span v-else class="muted">—</span></td>
            <td><span v-for="t in s.trade_types" :key="t" class="chip sm">{{ t }}</span><span v-if="!s.trade_types.length" class="muted">—</span></td>
            <td><span v-for="a in s.service_areas" :key="a" class="chip sm area">{{ a }}</span><span v-if="!s.service_areas.length" class="muted">—</span></td>
            <td><span class="status" :class="s.active ? 'active' : 'off'">{{ s.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(s)">編集</button>
              <button class="btn-ghost-sm" @click="openHistory(s)">履歴</button>
              <button v-if="!s.is_deleted" class="btn-ghost-sm danger" @click="softDelete(s)">削除</button>
              <button v-else class="btn-ghost-sm" @click="restore(s)">復元</button>
            </td>
          </tr>
          <tr v-if="!filtered.length"><td :colspan="mergeMode ? 7 : 6" class="empty">該当する業者がありません</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal wide">
        <h2>{{ modal.id ? '業者を編集' : '業者を追加' }}</h2>
        <div class="grid2">
          <div class="field">
            <label>業者名 <span class="req">*</span></label>
            <input v-model="modal.name" class="input" placeholder="例：○○工務店" />
          </div>
          <div class="field">
            <label>区分 <span class="req">*</span></label>
            <select v-model="modal.category" class="input">
              <option value="" disabled>選択してください</option>
              <option value="商社">商社</option>
              <option value="業者">業者</option>
            </select>
          </div>
          <div class="field">
            <label>代表者名</label>
            <input v-model="modal.representative_name" class="input" placeholder="例：山田太郎" />
          </div>
          <div class="field">
            <label>代表者携帯</label>
            <input v-model="modal.mobile_phone" class="input" placeholder="090-..." />
          </div>
          <div class="field">
            <label>会社電話</label>
            <input v-model="modal.office_phone" class="input" placeholder="03-..." />
          </div>
          <div class="field">
            <label>メールアドレス</label>
            <input v-model="modal.email" class="input" placeholder="info@example.com" />
          </div>
        </div>

        <div class="field">
          <label>住所</label>
          <input v-model="modal.address" class="input" placeholder="例：東京都新宿区…" />
        </div>

        <div class="field">
          <label>振込口座</label>
          <div class="grid2">
            <input v-model="modal.bank_name" class="input" placeholder="銀行名（例：○○銀行）" />
            <input v-model="modal.bank_branch" class="input" placeholder="支店名（例：△△支店）" />
            <select v-model="modal.bank_account_type" class="input">
              <option value="">種別（任意）</option>
              <option value="普通">普通</option>
              <option value="当座">当座</option>
            </select>
            <input v-model="modal.bank_account_number" class="input" placeholder="口座番号" />
          </div>
          <input v-model="modal.bank_account_holder" class="input" placeholder="口座名義（例：カ）○○）" style="margin-top:8px" />
        </div>

        <div class="field">
          <label>対応エリア</label>
          <div class="chips-input">
            <span v-for="(a, i) in modal.service_areas" :key="a" class="chip area">{{ a }}<button class="chip-x" @click="modal.service_areas!.splice(i, 1)">×</button></span>
            <input v-model="areaDraft" class="chip-add" placeholder="エリアを入力しEnter" @keydown.enter.prevent="addArea" />
          </div>
          <span class="hint">都道府県・市区など自由に追加できます</span>
        </div>

        <div class="field">
          <label>工種</label>
          <div class="presets">
            <button v-for="p in presets" :key="p.id" type="button" class="preset-btn" :class="{ on: modal.trade_types!.includes(p.name) }" @click="toggleTrade(p.name)">{{ p.name }}</button>
          </div>
          <div class="chips-input">
            <span v-for="(t, i) in customTrades" :key="t" class="chip">{{ t }}<button class="chip-x" @click="removeTrade(t)">×</button></span>
            <input v-model="tradeDraft" class="chip-add" placeholder="工種を自由追加しEnter" @keydown.enter.prevent="addCustomTrade" />
          </div>
        </div>

        <div class="field">
          <label>担当者（複数登録可・注文書/請求の宛先に使用）</label>
          <div v-for="(c, i) in modal.contacts" :key="i" class="contact-row">
            <input v-model="c.name" class="input" placeholder="担当者名 *" />
            <input v-model="c.email" class="input" placeholder="メール" />
            <input v-model="c.phone" class="input" placeholder="電話" />
            <button type="button" class="contact-del" @click="removeContact(i)">×</button>
          </div>
          <button type="button" class="btn-add-contact" @click="addContact">＋ 担当者を追加</button>
        </div>

        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>

    <!-- 履歴モーダル -->
    <div v-if="historyModal" class="modal-overlay" @click.self="historyModal = null">
      <div class="modal">
        <h2>編集履歴 — {{ historyModal.name }}</h2>
        <div class="history-list">
          <div v-for="log in historyLogs" :key="log.id" class="history-row">
            <span class="action-badge" :class="log.action">{{ actionLabel(log.action) }}</span>
            <span class="history-date">{{ fmtDate(log.created_at) }}</span>
          </div>
          <p v-if="!historyLogs.length" class="muted">履歴はありません</p>
        </div>
        <div class="modal-actions"><button class="btn-cancel" @click="historyModal = null">閉じる</button></div>
      </div>
    </div>

    <!-- マージモーダル -->
    <div v-if="mergeModal" class="modal-overlay" @click.self="mergeModal = null">
      <div class="modal">
        <h2>業者をマージ</h2>
        <p class="hint">どちらに統合しますか？（残す方を選択。もう一方は削除されます）</p>
        <label class="merge-opt" v-for="s in mergeModal.subs" :key="s.id">
          <input type="radio" :value="s.id" v-model="mergeTarget" /> {{ s.name }} を残す
        </label>
        <div class="modal-actions">
          <button class="btn-save" :disabled="!mergeTarget || saving" @click="doMerge">{{ saving ? '統合中...' : 'マージ実行' }}</button>
          <button class="btn-cancel" @click="mergeModal = null">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Contact = { id?: string; name: string; email: string | null; phone: string | null }
type Sub = {
  id: string; name: string; active: boolean; category: string | null; unit_price: number | null
  representative_name: string | null; mobile_phone: string | null; office_phone: string | null
  email: string | null; service_areas: string[]; is_deleted: boolean
  trade_types: string[]
  address: string | null
  bank_name: string | null; bank_branch: string | null; bank_account_type: string | null
  bank_account_number: string | null; bank_account_holder: string | null
  contacts: Contact[]
}
type Preset = { id: string; name: string; category: string; sort_order: number }
type EditLog = { id: string; action: string; created_at: string }

const subs        = ref<Sub[]>([])
const presets     = ref<Preset[]>([])
const modal       = ref<(Partial<Sub> & { service_areas: string[]; trade_types: string[]; contacts: Contact[] }) | null>(null)
const saving      = ref(false)
const saveError   = ref('')

const q           = ref('')
const filterTrade = ref('')
const filterArea  = ref('')
const showDeleted = ref(false)

const areaDraft   = ref('')
const tradeDraft  = ref('')

const historyModal = ref<Sub | null>(null)
const historyLogs  = ref<EditLog[]>([])

const mergeMode   = ref(false)
const mergePick   = ref<string[]>([])
const mergeModal  = ref<{ subs: Sub[] } | null>(null)
const mergeTarget = ref('')

const SUB_COLS = 'id, name, active, category, unit_price, representative_name, mobile_phone, office_phone, email, service_areas, is_deleted, address, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder'

async function load() {
  const accountId = await getAccountId()
  const [{ data: subRows }, { data: presetRows }, { data: ttRows }, { data: contactRows }] = await Promise.all([
    supabase.from('subcontractors').select(SUB_COLS).eq('account_id', accountId).order('sort_order'),
    supabase.from('trade_type_presets').select('id, name, category, sort_order').eq('account_id', accountId).order('sort_order'),
    supabase.from('subcontractor_trade_types').select('subcontractor_id, trade_type').eq('account_id', accountId),
    supabase.from('subcontractor_contacts').select('id, subcontractor_id, name, email, phone, sort_order').eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  const ttMap = new Map<string, string[]>()
  for (const r of (ttRows ?? []) as any[]) {
    const arr = ttMap.get(r.subcontractor_id) ?? []
    arr.push(r.trade_type); ttMap.set(r.subcontractor_id, arr)
  }
  const contactMap = new Map<string, Contact[]>()
  for (const r of (contactRows ?? []) as any[]) {
    const arr = contactMap.get(r.subcontractor_id) ?? []
    arr.push({ id: r.id, name: r.name, email: r.email, phone: r.phone }); contactMap.set(r.subcontractor_id, arr)
  }
  subs.value = ((subRows ?? []) as any[]).map((s) => ({
    ...s,
    service_areas: s.service_areas ?? [],
    is_deleted: !!s.is_deleted,
    trade_types: ttMap.get(s.id) ?? [],
    contacts: contactMap.get(s.id) ?? [],
  }))
  presets.value = (presetRows ?? []) as Preset[]
}
onMounted(load)

// 工種フィルタの選択肢 = プリセット ∪ 既存の自由追加工種
const tradeOptions = computed(() => {
  const set = new Set<string>(presets.value.map((p) => p.name))
  for (const s of subs.value) for (const t of s.trade_types) set.add(t)
  return [...set]
})

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const area = filterArea.value.trim()
  return subs.value.filter((s) => {
    if (!showDeleted.value && s.is_deleted) return false
    if (kw && !`${s.name}${s.representative_name ?? ''}`.toLowerCase().includes(kw)) return false
    if (filterTrade.value && !s.trade_types.includes(filterTrade.value)) return false
    if (area && !s.service_areas.some((a) => a.includes(area))) return false
    return true
  // 五十音順（日本語ロケール照合）で表示。読み仮名カラムは持たないため name を ja で比較。
  }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ja'))
})

// 編集モーダルの工種を「プリセット選択分」と「自由追加分」に分けて扱う
const customTrades = computed(() => (modal.value?.trade_types ?? []).filter((t) => !presets.value.some((p) => p.name === t)))

function blankModal(): any {
  return { name: '', category: '', unit_price: null, representative_name: '', mobile_phone: '', office_phone: '', email: '', service_areas: [], trade_types: [],
    address: '', bank_name: '', bank_branch: '', bank_account_type: '', bank_account_number: '', bank_account_holder: '', contacts: [] }
}
function openAdd()        { modal.value = blankModal(); areaDraft.value = ''; tradeDraft.value = ''; saveError.value = '' }
function openEdit(s: Sub) { modal.value = { ...s, service_areas: [...s.service_areas], trade_types: [...s.trade_types], contacts: s.contacts.map((c) => ({ ...c })) }; areaDraft.value = ''; tradeDraft.value = ''; saveError.value = '' }

function addContact()        { modal.value!.contacts.push({ name: '', email: null, phone: null }) }
function removeContact(i: number) { modal.value!.contacts.splice(i, 1) }

function addArea() {
  const v = areaDraft.value.trim()
  if (v && !modal.value!.service_areas.includes(v)) modal.value!.service_areas.push(v)
  areaDraft.value = ''
}
function toggleTrade(name: string) {
  const arr = modal.value!.trade_types
  const i = arr.indexOf(name)
  if (i >= 0) arr.splice(i, 1); else arr.push(name)
}
function addCustomTrade() {
  const v = tradeDraft.value.trim()
  if (v && !modal.value!.trade_types.includes(v)) modal.value!.trade_types.push(v)
  tradeDraft.value = ''
}
function removeTrade(name: string) {
  const arr = modal.value!.trade_types
  const i = arr.indexOf(name); if (i >= 0) arr.splice(i, 1)
}

async function logEdit(subId: string, accountId: string, action: string, changes: unknown) {
  await supabase.from('subcontractor_edit_logs').insert({
    subcontractor_id: subId, account_id: accountId, edited_by: null, action, changes,
  }).then(() => {}, () => {}) // best-effort
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '業者名を入力してください'; return }
  if (!modal.value?.category) { saveError.value = '区分（商社/業者）を選択してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const payload = {
      name:                modal.value.name.trim(),
      category:            modal.value.category,
      unit_price:          modal.value.unit_price || null,
      representative_name: modal.value.representative_name?.trim() || null,
      mobile_phone:        modal.value.mobile_phone?.trim() || null,
      office_phone:        modal.value.office_phone?.trim() || null,
      email:               modal.value.email?.trim() || null,
      service_areas:       modal.value.service_areas,
      address:             modal.value.address?.trim() || null,
      bank_name:           modal.value.bank_name?.trim() || null,
      bank_branch:         modal.value.bank_branch?.trim() || null,
      bank_account_type:   modal.value.bank_account_type?.trim() || null,
      bank_account_number: modal.value.bank_account_number?.trim() || null,
      bank_account_holder: modal.value.bank_account_holder?.trim() || null,
    }
    let subId = modal.value.id
    if (subId) {
      await supabase.from('subcontractors').update(payload).eq('id', subId)
      await logEdit(subId, accountId, 'update', payload)
    } else {
      const { data } = await supabase.from('subcontractors').insert({ ...payload, account_id: accountId }).select('id').single()
      subId = data?.id
      if (subId) await logEdit(subId, accountId, 'create', payload)
    }
    if (subId) await syncTradeTypes(subId, accountId, modal.value.trade_types)
    if (subId) await syncContacts(subId, accountId, modal.value.contacts)
    modal.value = null; await load()
  } catch (e: any) { saveError.value = e.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}

// 工種の差分同期（join テーブル）
async function syncTradeTypes(subId: string, accountId: string, want: string[]) {
  const { data } = await supabase.from('subcontractor_trade_types').select('id, trade_type').eq('subcontractor_id', subId)
  const have = (data ?? []) as { id: string; trade_type: string }[]
  const toAdd = want.filter((w) => !have.some((h) => h.trade_type === w))
  const toDel = have.filter((h) => !want.includes(h.trade_type))
  if (toAdd.length) await supabase.from('subcontractor_trade_types').insert(toAdd.map((t) => ({ subcontractor_id: subId, account_id: accountId, trade_type: t })))
  if (toDel.length) await supabase.from('subcontractor_trade_types').delete().in('id', toDel.map((h) => h.id))
}

// 担当者の同期：名前ありの行のみ。既存idは更新、新規は挿入、外れた既存は削除
async function syncContacts(subId: string, accountId: string, want: Contact[]) {
  const valid = want.filter((c) => c.name?.trim())
  const { data } = await supabase.from('subcontractor_contacts').select('id').eq('subcontractor_id', subId).eq('is_deleted', false)
  const haveIds = ((data ?? []) as { id: string }[]).map((h) => h.id)
  const keepIds = valid.map((c) => c.id).filter(Boolean) as string[]
  const toDel = haveIds.filter((id) => !keepIds.includes(id))
  for (const [i, c] of valid.entries()) {
    const row = { subcontractor_id: subId, account_id: accountId, name: c.name.trim(), email: c.email?.trim() || null, phone: c.phone?.trim() || null, sort_order: i, updated_at: new Date().toISOString() }
    if (c.id) await supabase.from('subcontractor_contacts').update(row).eq('id', c.id)
    else      await supabase.from('subcontractor_contacts').insert(row)
  }
  if (toDel.length) await supabase.from('subcontractor_contacts').delete().in('id', toDel)
}

async function softDelete(s: Sub) {
  if (!confirm(`「${s.name}」を削除しますか？（復元できます）`)) return
  const accountId = await getAccountId()
  await supabase.from('subcontractors').update({ is_deleted: true, active: false, deleted_at: new Date().toISOString() }).eq('id', s.id)
  await logEdit(s.id, accountId, 'delete', { name: s.name })
  await load()
}
async function restore(s: Sub) {
  const accountId = await getAccountId()
  await supabase.from('subcontractors').update({ is_deleted: false, active: true, deleted_at: null }).eq('id', s.id)
  await logEdit(s.id, accountId, 'restore', { name: s.name })
  await load()
}

async function openHistory(s: Sub) {
  historyModal.value = s
  const { data } = await supabase.from('subcontractor_edit_logs').select('id, action, created_at').eq('subcontractor_id', s.id).order('created_at', { ascending: false })
  historyLogs.value = (data ?? []) as EditLog[]
}
const ACTION_LABELS: Record<string, string> = { create: '登録', update: '更新', delete: '削除', restore: '復元', merge: 'マージ' }
function actionLabel(a: string) { return ACTION_LABELS[a] ?? a }
function fmtDate(s: string) { return new Date(s).toLocaleString('ja-JP') }

// ── マージ ──
function startMerge() { mergeMode.value = true; mergePick.value = [] }
function cancelMerge() { mergeMode.value = false; mergePick.value = [] }
function openMerge() {
  const picked = subs.value.filter((s) => mergePick.value.includes(s.id))
  if (picked.length !== 2) return
  mergeModal.value = { subs: picked }; mergeTarget.value = picked[0].id; saveError.value = ''
}
async function doMerge() {
  const target = mergeModal.value!.subs.find((s) => s.id === mergeTarget.value)!
  const source = mergeModal.value!.subs.find((s) => s.id !== mergeTarget.value)!
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    // 詳細列: 統合先が空の項目のみ source で補完
    const fill: Record<string, any> = {}
    for (const k of ['representative_name', 'mobile_phone', 'office_phone', 'email'] as const) {
      if (!target[k] && (source as any)[k]) fill[k] = (source as any)[k]
    }
    const mergedAreas = [...new Set([...target.service_areas, ...source.service_areas])]
    if (mergedAreas.length !== target.service_areas.length) fill.service_areas = mergedAreas
    if (Object.keys(fill).length) await supabase.from('subcontractors').update(fill).eq('id', target.id)
    // 工種: 和集合
    await syncTradeTypes(target.id, accountId, [...new Set([...target.trade_types, ...source.trade_types])])
    // 関連付け替え（コメント・請求）
    await supabase.from('subcontractor_comments').update({ subcontractor_id: target.id }).eq('subcontractor_id', source.id).then(() => {}, () => {})
    await supabase.from('subcontractor_contacts').update({ subcontractor_id: target.id }).eq('subcontractor_id', source.id).then(() => {}, () => {})
    await supabase.from('subcontractor_invoices').update({ subcontractor_id: target.id }).eq('subcontractor_id', source.id).then(() => {}, () => {})
    // source を論理削除
    await supabase.from('subcontractors').update({ is_deleted: true, active: false, deleted_at: new Date().toISOString() }).eq('id', source.id)
    await logEdit(target.id, accountId, 'merge', { merged_from: source.name, merged_from_id: source.id })
    mergeModal.value = null; cancelMerge(); await load()
  } catch (e: any) { saveError.value = e.message ?? 'マージに失敗しました' }
  finally { saving.value = false }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; gap: 10px; align-items: center; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer; }
.btn-ghost:disabled { opacity: .4; cursor: not-allowed; }
.filters { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filter-input { width: auto; min-width: 200px; }
.toggle { font-size: 13px; color: #666; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table tr.inactive td { opacity: .5; }
.name { font-weight: 600; }
.del-badge { font-size: 10px; background: #ffeaea; color: #c0392b; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
.cat-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.cat-badge.shosha { background: #fff3e0; color: #e65100; }
.cat-badge.gyosha { background: #e8f4ff; color: #1a6fc4; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 6px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-ghost-sm { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; color: #888; }
.btn-ghost-sm.danger { color: #c0392b; border-color: #f0caca; }
.muted { color: #bbb; font-size: 12px; }
.empty { text-align: center; color: #aaa; padding: 32px; }
.chip { display: inline-flex; align-items: center; font-size: 12px; background: #eef3ff; color: #1a6fc4; padding: 3px 8px; border-radius: 12px; margin: 2px; }
.chip.area { background: #eafaf0; color: #0a8a3a; }
.chip.sm { font-size: 11px; padding: 2px 7px; }
.chip-x { background: none; border: none; color: inherit; cursor: pointer; margin-left: 4px; font-size: 13px; line-height: 1; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 360px; max-height: 88vh; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
.modal.wide { width: 560px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; }
.hint { font-size: 11px; color: #aaa; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.chips-input { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px; }
.chip-add { flex: 1; min-width: 140px; border: none; background: none; outline: none; font-size: 13px; padding: 4px; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.preset-btn { font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 14px; padding: 5px 12px; cursor: pointer; }
.preset-btn.on { background: #1a6fc4; color: #fff; border-color: #1a6fc4; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.history-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.history-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.action-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; background: #eef3ff; color: #1a6fc4; }
.action-badge.delete { background: #ffeaea; color: #c0392b; }
.action-badge.restore { background: #e8fff0; color: #0a8a3a; }
.action-badge.merge { background: #fff3e0; color: #e65100; }
.history-date { color: #888; }
.merge-opt { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 8px 0; cursor: pointer; }
.contact-row { display: grid; grid-template-columns: 1.2fr 1.5fr 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.contact-row .input { padding: 8px 10px; font-size: 13px; }
.contact-del { background: none; border: 1px solid #f0caca; color: #c0392b; border-radius: 6px; width: 30px; height: 32px; cursor: pointer; font-size: 14px; }
.btn-add-contact { background: #f0f0f0; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #555; align-self: flex-start; }
</style>
