<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">元請け業者マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>元請け業者名</th><th>担当者</th><th>状態</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in contractors" :key="c.id" :class="{ inactive: !c.active }">
            <td class="name">{{ c.name }}</td>
            <td>
              <span v-if="c.contacts.length" class="muted">{{ c.contacts.map(x => x.name).join('、') }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td><span class="status" :class="c.active ? 'active' : 'off'">{{ c.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(c)">編集</button>
              <button class="btn-toggle" @click="toggleActive(c)">{{ c.active ? '無効化' : '有効化' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '元請け業者を編集' : '元請け業者を追加' }}</h2>
        <div class="field">
          <label>元請け業者名 *</label>
          <input v-model="modal.name" class="input" placeholder="例：〇〇建設" data-testid="contractor-name" />
        </div>
        <div class="grid2">
          <div class="field"><label>代表者名</label><input v-model="modal.representative_name" class="input" /></div>
          <div class="field"><label>登録番号（インボイス）</label><input v-model="modal.registration_number" class="input" placeholder="例：T1234567890123" /></div>
          <div class="field"><label>携帯電話</label><input v-model="modal.mobile_phone" class="input" /></div>
          <div class="field"><label>会社電話</label><input v-model="modal.office_phone" class="input" /></div>
          <div class="field"><label>メール</label><input v-model="modal.email" class="input" /></div>
          <div class="field"><label>住所</label><input v-model="modal.address" class="input" /></div>
        </div>
        <div class="field"><label>備考</label><textarea v-model="modal.note" class="input" rows="2" placeholder="この元請けに関するメモ"></textarea></div>
        <details class="bank">
          <summary>振込口座（任意）</summary>
          <div class="grid2">
            <div class="field"><label>銀行名</label><input v-model="modal.bank_name" class="input" /></div>
            <div class="field"><label>支店</label><input v-model="modal.bank_branch" class="input" /></div>
            <div class="field"><label>種別</label>
              <select v-model="modal.bank_account_type" class="input">
                <option :value="null">—</option><option value="普通">普通</option><option value="当座">当座</option>
              </select>
            </div>
            <div class="field"><label>口座番号</label><input v-model="modal.bank_account_number" class="input" /></div>
            <div class="field"><label>口座名義</label><input v-model="modal.bank_account_holder" class="input" /></div>
          </div>
        </details>
        <div class="field">
          <label>担当者（複数登録可・見積書の送信先に使用）</label>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Contact = { id?: string; name: string; email: string | null; phone: string | null }
type Contractor = {
  id: string; name: string; active: boolean
  representative_name: string | null; mobile_phone: string | null; office_phone: string | null
  email: string | null; address: string | null; registration_number: string | null; note: string | null
  bank_name: string | null; bank_branch: string | null; bank_account_type: string | null
  bank_account_number: string | null; bank_account_holder: string | null
  contacts: Contact[]
}
type ModalState = Partial<Contractor> & { contacts: Contact[] }

const CON_COLS = 'id, name, active, representative_name, mobile_phone, office_phone, email, address, registration_number, note, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder'

const contractors = ref<Contractor[]>([])
const modal       = ref<ModalState | null>(null)
const saving      = ref(false)
const saveError   = ref('')

async function load() {
  const accountId = await getAccountId()
  const [{ data: rows }, { data: contactRows }] = await Promise.all([
    supabase.from('contractors').select(CON_COLS).eq('account_id', accountId).order('name'),
    supabase.from('contractor_contacts').select('id, contractor_id, name, email, phone, sort_order')
      .eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  const cmap = new Map<string, Contact[]>()
  for (const r of (contactRows ?? []) as any[]) {
    const arr = cmap.get(r.contractor_id) ?? []
    arr.push({ id: r.id, name: r.name, email: r.email, phone: r.phone }); cmap.set(r.contractor_id, arr)
  }
  contractors.value = ((rows ?? []) as any[]).map((c) => ({ ...c, contacts: cmap.get(c.id) ?? [] }))
}
onMounted(load)

function openAdd()               { modal.value = { name: '', contacts: [] }; saveError.value = '' }
function openEdit(c: Contractor) { modal.value = { ...c, contacts: c.contacts.map((x) => ({ ...x })) }; saveError.value = '' }
function addContact()            { modal.value!.contacts.push({ name: '', email: null, phone: null }) }
function removeContact(i: number){ modal.value!.contacts.splice(i, 1) }

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '元請け業者名を入力してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    let id = modal.value.id
    const m = modal.value
    const fields = {
      name: m.name!.trim(),
      representative_name: m.representative_name?.trim() || null,
      mobile_phone: m.mobile_phone?.trim() || null,
      office_phone: m.office_phone?.trim() || null,
      email: m.email?.trim() || null,
      address: m.address?.trim() || null,
      registration_number: m.registration_number?.trim() || null,
      note: m.note?.trim() || null,
      bank_name: m.bank_name?.trim() || null,
      bank_branch: m.bank_branch?.trim() || null,
      bank_account_type: m.bank_account_type?.trim() || null,
      bank_account_number: m.bank_account_number?.trim() || null,
      bank_account_holder: m.bank_account_holder?.trim() || null,
    }
    if (id) {
      await supabase.from('contractors').update(fields).eq('id', id)
    } else {
      const { data } = await supabase.from('contractors').insert({ ...fields, account_id: accountId }).select('id').single()
      id = (data as any)?.id
    }
    if (id) await syncContacts(id, accountId, modal.value.contacts)
    modal.value = null; await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally { saving.value = false }
}

// 担当者の同期：名前ありの行のみ。既存idは更新、新規は挿入、外れた既存は削除（subcontractorsと同型）
async function syncContacts(contractorId: string, accountId: string, want: Contact[]) {
  const valid = want.filter((c) => c.name?.trim())
  const { data } = await supabase.from('contractor_contacts').select('id').eq('contractor_id', contractorId).eq('is_deleted', false)
  const haveIds = ((data ?? []) as { id: string }[]).map((h) => h.id)
  const keepIds = valid.map((c) => c.id).filter(Boolean) as string[]
  const toDel = haveIds.filter((id) => !keepIds.includes(id))
  for (const [i, c] of valid.entries()) {
    const row = { contractor_id: contractorId, account_id: accountId, name: c.name.trim(), email: c.email?.trim() || null, phone: c.phone?.trim() || null, sort_order: i, updated_at: new Date().toISOString() }
    if (c.id) await supabase.from('contractor_contacts').update(row).eq('id', c.id)
    else      await supabase.from('contractor_contacts').insert(row)
  }
  if (toDel.length) await supabase.from('contractor_contacts').delete().in('id', toDel)
}

async function toggleActive(c: Contractor) {
  await supabase.from('contractors').update({ active: !c.active }).eq('id', c.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table tr.inactive td { opacity: .4; }
.name { font-weight: 600; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: min(560px, 94vw); display: flex; flex-direction: column; gap: 16px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.bank { border: 1px solid #eee; border-radius: 8px; padding: 8px 12px; }
.bank summary { font-size: 13px; font-weight: 700; color: #666; cursor: pointer; }
.bank .grid2 { margin-top: 12px; }
textarea.input { resize: vertical; font-family: inherit; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.muted { color: #aaa; font-size: 13px; }
.contact-row { display: grid; grid-template-columns: 1.2fr 1.5fr 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.contact-row .input { padding: 8px 10px; font-size: 13px; }
.contact-del { background: none; border: 1px solid #f0caca; color: #c0392b; border-radius: 6px; width: 30px; height: 32px; cursor: pointer; font-size: 14px; }
.btn-add-contact { background: #f0f0f0; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #555; align-self: flex-start; }
.modal { max-height: 88vh; overflow-y: auto; }
</style>
