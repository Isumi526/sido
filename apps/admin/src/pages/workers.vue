<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">作業員マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>所属</th>
            <th>日当単価</th>
            <th>雇用形態</th>
            <th>入社日</th>
            <th>状態</th>
            <th>ユーザー</th>
            <th>代理人</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in workers" :key="w.id" :class="{ inactive: !w.active }">
            <td class="name">{{ w.name }}</td>
            <td><span class="badge" :class="w.role">{{ w.role === 'factory' ? '工場/事務所' : '現場' }}</span></td>
            <td class="price">¥{{ w.unit_price.toLocaleString() }}</td>
            <td><span class="emp-badge" :class="w.employment_type ?? 'fulltime'">{{ w.employment_type === 'contractor' ? '業務委託' : (w.employment_type ?? 'fulltime') === 'fulltime' ? '正社員' : `パート(週${w.weekly_scheduled_days ?? '?'}日)` }}</span></td>
            <td class="hire-date">{{ w.hire_date ?? '—' }}</td>
            <td><span class="status" :class="w.active ? 'active' : 'off'">{{ w.active ? '有効' : '無効' }}</span></td>
            <td><span class="user-link" :class="linkedWorkerIds.has(w.id) ? 'linked' : 'unlinked'">{{ linkedWorkerIds.has(w.id) ? '紐付け済み' : '未紐付け' }}</span></td>
            <td>
              <template v-if="proxyMap.get(w.id)?.length">
                <span v-for="pid in proxyMap.get(w.id)" :key="pid" class="proxy-badge">
                  {{ workerName(pid) }}
                </span>
              </template>
              <span v-else class="proxy-none">—</span>
            </td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(w)">編集</button>
              <button class="btn-toggle" @click="toggleActive(w)">{{ w.active ? '無効化' : '有効化' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '作業員を編集' : '作業員を追加' }}</h2>
        <div class="field">
          <label>名前</label>
          <input v-model="modal.name" class="input" placeholder="例：山田 太郎" />
        </div>
        <div class="field">
          <label>所属</label>
          <div class="toggle">
            <button :class="{ active: modal.role === 'factory' }" @click="modal.role = 'factory'">工場/事務所</button>
            <button :class="{ active: modal.role === 'site' }" @click="modal.role = 'site'">現場</button>
          </div>
        </div>
        <div class="field">
          <label>日当単価（円）</label>
          <input v-model.number="modal.unit_price" type="number" class="input" placeholder="20000" />
        </div>
        <div v-if="modal.id" class="field">
          <label>昇給年月日（発効日・単価を変えた時に記録）</label>
          <input v-model="wageEffectiveDate" type="date" class="input" data-testid="wage-effective-date" />
          <p class="hint-sm">この日以降の稼働が新単価で人件費計算されます（編集した日と違ってもOK）。</p>
        </div>
        <div v-if="modal.id" class="field">
          <label>単価変更の理由（任意）</label>
          <input v-model="wageReason" class="input" placeholder="例：定期昇給 / 資格取得" data-testid="wage-reason" />
        </div>
        <div v-if="modal.id && wageHistory.length" class="field">
          <label>昇給履歴（発効日）</label>
          <ul class="wage-hist" data-testid="wage-history">
            <li v-for="h in wageHistory" :key="h.id">
              {{ (h.effective_date || (h.changed_at || '').slice(0, 10)) }}：{{ h.old_unit_price != null ? `¥${h.old_unit_price.toLocaleString()}` : '—' }} → ¥{{ (h.new_unit_price ?? 0).toLocaleString() }}<span v-if="h.reason" class="wage-reason"> （{{ h.reason }}）</span>
            </li>
          </ul>
        </div>
        <div class="field">
          <label>雇用形態</label>
          <div class="toggle">
            <button :class="{ active: (modal.employment_type ?? 'fulltime') === 'fulltime' }" @click="modal.employment_type = 'fulltime'">正社員</button>
            <button :class="{ active: modal.employment_type === 'parttime' }" @click="modal.employment_type = 'parttime'">パート・アルバイト</button>
            <button :class="{ active: modal.employment_type === 'contractor' }" @click="modal.employment_type = 'contractor'">業務委託</button>
          </div>
        </div>
        <div v-if="modal.employment_type === 'parttime'" class="field">
          <label>週所定労働日数</label>
          <select v-model.number="modal.weekly_scheduled_days" class="input">
            <option :value="null">選択してください</option>
            <option :value="4">週4日</option>
            <option :value="3">週3日</option>
            <option :value="2">週2日</option>
            <option :value="1">週1日</option>
          </select>
        </div>
        <div class="field">
          <label>入社日</label>
          <input v-model="modal.hire_date" type="date" class="input" />
        </div>
        <div class="field">
          <label>生年月日</label>
          <input v-model="modal.birth_date" type="date" class="input" />
        </div>
        <div class="field">
          <label>住所</label>
          <input v-model="modal.address" class="input" placeholder="例：東京都新宿区..." />
        </div>
        <div class="field">
          <label>緊急連絡先</label>
          <input v-model="modal.emergency_contact" class="input" placeholder="例：090-1234-5678（配偶者）" />
        </div>
        <div class="field">
          <label>家族構成（氏名・続柄・生年月日）</label>
          <div v-for="(fm, i) in familyMembers" :key="i" class="family-row" data-testid="family-row">
            <input v-model="fm.name" class="input" placeholder="氏名 *" />
            <input v-model="fm.relationship" class="input" placeholder="続柄（例：配偶者）" />
            <input v-model="fm.birth_date" type="date" class="input" />
            <button type="button" class="family-del" @click="removeFamily(i)">×</button>
          </div>
          <button type="button" class="btn-add-family" data-testid="add-family" @click="addFamily">＋ 家族を追加</button>
        </div>
        <div class="field">
          <label>会社情報</label>
          <input v-model="modal.company_info" class="input" placeholder="例：株式会社○○／所在地・代表者など" data-testid="company-info" />
        </div>
        <div class="field">
          <label>インボイス登録番号</label>
          <input v-model="modal.invoice_number" class="input" placeholder="例：T1234567890123" data-testid="invoice-number" />
        </div>
        <div class="field">
          <label>会社の保険</label>
          <input v-model="modal.insurance_info" class="input" placeholder="例：労働保険／賠償責任保険 など" data-testid="insurance-info" />
        </div>
        <div v-if="modal.employment_type === 'contractor'" class="field">
          <label>労災保険番号（業務委託）</label>
          <input v-model="modal.labor_insurance_number" class="input" placeholder="例：12-3-45-678901-0" data-testid="labor-insurance-number" />
        </div>
        <div class="field">
          <label>車検履歴（車両・車検日・満了日）</label>
          <div v-for="(vi, i) in vehicleInspections" :key="i" class="family-row" data-testid="inspection-row">
            <input v-model="vi.vehicle_name" class="input" placeholder="車両名" />
            <input v-model="vi.inspection_date" type="date" class="input" />
            <input v-model="vi.expiry_date" type="date" class="input" />
            <button type="button" class="family-del" @click="removeInspection(i)">×</button>
          </div>
          <button type="button" class="btn-add-family" data-testid="add-inspection" @click="addInspection">＋ 車検を追加</button>
        </div>
        <div class="field">
          <label>健康診断履歴（受診日・結果）</label>
          <div v-for="(hc, i) in healthCheckups" :key="i" class="checkup-row" data-testid="checkup-row">
            <input v-model="hc.checkup_date" type="date" class="input" />
            <input v-model="hc.result" class="input" placeholder="結果（例：異常なし）" />
            <button type="button" class="family-del" @click="removeCheckup(i)">×</button>
          </div>
          <button type="button" class="btn-add-family" data-testid="add-checkup" @click="addCheckup">＋ 健診を追加</button>
        </div>
        <div class="field">
          <label>代理人（LINEを持たない場合、代わりに入力する作業員）</label>
          <div class="proxy-check-list">
            <label
              v-for="w in workers.filter(w => w.id !== modal?.id)"
              :key="w.id"
              class="proxy-check-item"
            >
              <input
                type="checkbox"
                :value="w.id"
                :checked="modalProxyIds.includes(w.id)"
                @change="toggleProxyId(w.id)"
              />
              {{ w.name }}
            </label>
            <span v-if="workers.filter(w => w.id !== modal?.id).length === 0" class="proxy-none">他に作業員がいません</span>
          </div>
        </div>
        <div v-if="modal.id" class="field auth-field">
          <label>
            ログイン認証（email / password）
            <span v-if="modal.auth_user_id" class="auth-status set" data-testid="auth-status-set">認証設定済み</span>
            <span v-else class="auth-status unset">未設定</span>
          </label>
          <input v-model="authEmail" class="input" type="email" placeholder="email（ログインID）" data-testid="auth-email" />
          <input v-model="authPassword" class="input" type="password" placeholder="パスワード（8文字以上）" data-testid="auth-password" />
          <button class="btn-auth" :disabled="authSaving" data-testid="auth-setup-btn" @click="setupAuth">{{ authSaving ? '処理中...' : (modal.auth_user_id ? '認証を更新' : '認証を作成') }}</button>
          <p v-if="authMsg" :class="authOk ? 'auth-ok' : 'error'" data-testid="auth-msg">{{ authMsg }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
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

type Worker = {
  id: string
  name: string
  role: 'factory' | 'site'
  unit_price: number
  active: boolean
  hire_date: string | null
  birth_date: string | null
  address: string | null
  emergency_contact: string | null
  employment_type: 'fulltime' | 'parttime' | 'contractor' | null
  weekly_scheduled_days: number | null
  company_info: string | null
  invoice_number: string | null
  insurance_info: string | null
  labor_insurance_number: string | null
  auth_user_id: string | null
}

const workers         = ref<Worker[]>([])
const linkedWorkerIds = ref<Set<string>>(new Set())
// worker_id → 代理人の worker_id 配列
const proxyMap        = ref<Map<string, string[]>>(new Map())
const modal           = ref<Partial<Worker> | null>(null)
// モーダルで選択中の代理人 ID リスト
const modalProxyIds   = ref<string[]>([])
const saving          = ref(false)
// 昇給履歴（単価変更ログ）
type WageHist = { id: string; old_unit_price: number | null; new_unit_price: number; reason: string | null; changed_at: string; effective_date: string | null }
const wageHistory      = ref<WageHist[]>([])
const wageReason       = ref('')
const wageEffectiveDate = ref('')   // 昇給年月日（発効日）。この日以降の稼働は新単価で人件費計算される。
const origUnitPrice    = ref<number | null>(null)
const todayStr = () => new Date().toISOString().slice(0, 10)
// 家族構成
type FamilyMember = { id?: string; name: string; relationship: string | null; birth_date: string | null }
const familyMembers = ref<FamilyMember[]>([])
function addFamily()           { familyMembers.value.push({ name: '', relationship: null, birth_date: null }) }
function removeFamily(i: number){ familyMembers.value.splice(i, 1) }
async function loadFamily(workerId: string) {
  const { data } = await supabase.from('worker_family_members')
    .select('id, name, relationship, birth_date').eq('worker_id', workerId).order('sort_order')
  familyMembers.value = ((data ?? []) as any[]).map(f => ({ id: f.id, name: f.name, relationship: f.relationship, birth_date: f.birth_date }))
}
// 家族の同期（名前ありの行のみ。既存idは更新・新規は挿入・外れた既存は削除）
async function syncFamily(workerId: string, accountId: string, want: FamilyMember[]) {
  const valid = want.filter(f => f.name?.trim())
  const { data } = await supabase.from('worker_family_members').select('id').eq('worker_id', workerId)
  const haveIds = ((data ?? []) as { id: string }[]).map(h => h.id)
  const keepIds = valid.map(f => f.id).filter(Boolean) as string[]
  const toDel = haveIds.filter(id => !keepIds.includes(id))
  for (const [i, f] of valid.entries()) {
    const row = { worker_id: workerId, account_id: accountId, name: f.name.trim(), relationship: f.relationship?.trim() || null, birth_date: f.birth_date || null, sort_order: i, updated_at: new Date().toISOString() }
    if (f.id) await supabase.from('worker_family_members').update(row).eq('id', f.id)
    else      await supabase.from('worker_family_members').insert(row)
  }
  if (toDel.length) await supabase.from('worker_family_members').delete().in('id', toDel)
}
// 車検履歴（1作業員に複数）
type VehicleInspection = { id?: string; vehicle_name: string | null; inspection_date: string | null; expiry_date: string | null }
const vehicleInspections = ref<VehicleInspection[]>([])
function addInspection()            { vehicleInspections.value.push({ vehicle_name: null, inspection_date: null, expiry_date: null }) }
function removeInspection(i: number){ vehicleInspections.value.splice(i, 1) }
async function loadInspections(workerId: string) {
  const { data } = await supabase.from('worker_vehicle_inspections')
    .select('id, vehicle_name, inspection_date, expiry_date').eq('worker_id', workerId).order('sort_order')
  vehicleInspections.value = ((data ?? []) as any[]).map(r => ({ id: r.id, vehicle_name: r.vehicle_name, inspection_date: r.inspection_date, expiry_date: r.expiry_date }))
}
async function syncInspections(workerId: string, accountId: string, want: VehicleInspection[]) {
  const valid = want.filter(r => r.vehicle_name?.trim() || r.inspection_date || r.expiry_date)
  const { data } = await supabase.from('worker_vehicle_inspections').select('id').eq('worker_id', workerId)
  const haveIds = ((data ?? []) as { id: string }[]).map(h => h.id)
  const keepIds = valid.map(r => r.id).filter(Boolean) as string[]
  const toDel = haveIds.filter(id => !keepIds.includes(id))
  for (const [i, r] of valid.entries()) {
    const row = { worker_id: workerId, account_id: accountId, vehicle_name: r.vehicle_name?.trim() || null, inspection_date: r.inspection_date || null, expiry_date: r.expiry_date || null, sort_order: i, updated_at: new Date().toISOString() }
    if (r.id) await supabase.from('worker_vehicle_inspections').update(row).eq('id', r.id)
    else      await supabase.from('worker_vehicle_inspections').insert(row)
  }
  if (toDel.length) await supabase.from('worker_vehicle_inspections').delete().in('id', toDel)
}
// 健康診断履歴（1作業員に複数）
type HealthCheckup = { id?: string; checkup_date: string | null; result: string | null }
const healthCheckups = ref<HealthCheckup[]>([])
function addCheckup()            { healthCheckups.value.push({ checkup_date: null, result: null }) }
function removeCheckup(i: number){ healthCheckups.value.splice(i, 1) }
async function loadCheckups(workerId: string) {
  const { data } = await supabase.from('worker_health_checkups')
    .select('id, checkup_date, result').eq('worker_id', workerId).order('sort_order')
  healthCheckups.value = ((data ?? []) as any[]).map(r => ({ id: r.id, checkup_date: r.checkup_date, result: r.result }))
}
async function syncCheckups(workerId: string, accountId: string, want: HealthCheckup[]) {
  const valid = want.filter(r => r.checkup_date || r.result?.trim())
  const { data } = await supabase.from('worker_health_checkups').select('id').eq('worker_id', workerId)
  const haveIds = ((data ?? []) as { id: string }[]).map(h => h.id)
  const keepIds = valid.map(r => r.id).filter(Boolean) as string[]
  const toDel = haveIds.filter(id => !keepIds.includes(id))
  for (const [i, r] of valid.entries()) {
    const row = { worker_id: workerId, account_id: accountId, checkup_date: r.checkup_date || null, result: r.result?.trim() || null, sort_order: i, updated_at: new Date().toISOString() }
    if (r.id) await supabase.from('worker_health_checkups').update(row).eq('id', r.id)
    else      await supabase.from('worker_health_checkups').insert(row)
  }
  if (toDel.length) await supabase.from('worker_health_checkups').delete().in('id', toDel)
}
const saveError       = ref('')
// email/password 認証（Phase 2a）
const authEmail       = ref('')
const authPassword    = ref('')
const authSaving      = ref(false)
const authMsg         = ref('')
const authOk          = ref(false)

function workerName(id: string | null) {
  if (!id) return ''
  return workers.value.find(w => w.id === id)?.name ?? '不明'
}

function toggleProxyId(id: string) {
  const idx = modalProxyIds.value.indexOf(id)
  if (idx >= 0) modalProxyIds.value.splice(idx, 1)
  else modalProxyIds.value.push(id)
}

async function load() {
  const accountId = await getAccountId()
  const [{ data: workersData }, { data: usersData }, { data: proxyData }] = await Promise.all([
    supabase.from('workers').select('id, name, role, unit_price, active, hire_date, birth_date, address, emergency_contact, employment_type, weekly_scheduled_days, company_info, invoice_number, insurance_info, labor_insurance_number, auth_user_id').eq('account_id', accountId).order('name'),
    supabase.from('users').select('worker_id').eq('account_id', accountId).not('worker_id', 'is', null),
    supabase.from('worker_proxies').select('worker_id, proxy_operator_id').eq('account_id', accountId),
  ])
  workers.value = (workersData ?? []) as Worker[]
  linkedWorkerIds.value = new Set((usersData ?? []).map((u: any) => u.worker_id as string))

  const map = new Map<string, string[]>()
  for (const row of (proxyData ?? []) as any[]) {
    const arr = map.get(row.worker_id) ?? []
    arr.push(row.proxy_operator_id)
    map.set(row.worker_id, arr)
  }
  proxyMap.value = map
}

onMounted(load)

function openAdd() {
  modal.value = { name: '', role: 'site', unit_price: 20000, hire_date: null, birth_date: null, address: null, emergency_contact: null, employment_type: 'fulltime', weekly_scheduled_days: null, company_info: null, invoice_number: null, insurance_info: null, labor_insurance_number: null }
  modalProxyIds.value = []
  familyMembers.value = []
  vehicleInspections.value = []
  healthCheckups.value = []
  saveError.value = ''
}

function openEdit(w: Worker) {
  modal.value = { ...w }
  modalProxyIds.value = [...(proxyMap.value.get(w.id) ?? [])]
  saveError.value = ''
  authEmail.value = ''
  authPassword.value = ''
  authMsg.value = ''
  authOk.value = false
  // 昇給履歴：変更前単価を控え、履歴を読み込む
  origUnitPrice.value = w.unit_price ?? null
  wageReason.value = ''
  wageEffectiveDate.value = todayStr()
  wageHistory.value = []
  loadWageHistory(w.id)
  familyMembers.value = []
  loadFamily(w.id)
  vehicleInspections.value = []
  loadInspections(w.id)
  healthCheckups.value = []
  loadCheckups(w.id)
}

async function loadWageHistory(workerId: string) {
  const { data } = await supabase.from('worker_wage_history')
    .select('id, old_unit_price, new_unit_price, reason, changed_at, effective_date')
    .eq('worker_id', workerId).order('effective_date', { ascending: false, nullsFirst: false }).order('changed_at', { ascending: false })
  wageHistory.value = (data ?? []) as WageHist[]
}

// 作業員の email/password 認証を作成/更新（edge: worker-auth-setup・service_role）
async function setupAuth() {
  if (!modal.value?.id) return
  if (!authEmail.value.trim() || authPassword.value.length < 8) {
    authOk.value = false
    authMsg.value = 'email と 8文字以上のパスワードを入力してください'
    return
  }
  authSaving.value = true
  authMsg.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('worker-auth-setup', {
      body: { worker_id: modal.value.id, email: authEmail.value.trim(), password: authPassword.value },
    })
    if (error) throw error
    if (!data?.ok) throw new Error(data?.error ?? '認証設定に失敗しました')
    authOk.value = true
    authMsg.value = '認証を設定しました'
    authPassword.value = ''
    if (modal.value) modal.value.auth_user_id = data.auth_user_id
    await load()
  } catch (e: any) {
    authOk.value = false
    authMsg.value = e?.message ?? '認証設定に失敗しました'
  } finally {
    authSaving.value = false
  }
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '名前を入力してください'; return }
  saving.value = true
  saveError.value = ''
  try {
    const accountId = await getAccountId()
    let workerId = modal.value.id

    const workerPayload = {
      name:                  modal.value.name!.trim(),
      role:                  modal.value.role ?? 'site',
      unit_price:            modal.value.unit_price ?? 0,
      hire_date:             modal.value.hire_date || null,
      birth_date:            modal.value.birth_date || null,
      address:               modal.value.address?.trim() || null,
      emergency_contact:     modal.value.emergency_contact?.trim() || null,
      employment_type:       modal.value.employment_type ?? 'fulltime',
      weekly_scheduled_days: modal.value.employment_type === 'parttime' ? (modal.value.weekly_scheduled_days ?? null) : null,
      company_info:           modal.value.company_info?.trim() || null,
      invoice_number:         modal.value.invoice_number?.trim() || null,
      insurance_info:         modal.value.insurance_info?.trim() || null,
      // 労災保険番号は区分=業務委託のときのみ保持（他区分では常にnull）
      labor_insurance_number: modal.value.employment_type === 'contractor' ? (modal.value.labor_insurance_number?.trim() || null) : null,
    }

    if (workerId) {
      await supabase.from('workers').update(workerPayload).eq('id', workerId)
      // 単価(日当)が変わったら昇給履歴を1行記録（集計は最新単価のまま・履歴は記録のみ）
      const newPrice = modal.value.unit_price ?? 0
      if (origUnitPrice.value != null && newPrice !== origUnitPrice.value) {
        await supabase.from('worker_wage_history').insert({
          worker_id: workerId, account_id: accountId,
          old_unit_price: origUnitPrice.value, new_unit_price: newPrice,
          reason: wageReason.value.trim() || null,
          effective_date: wageEffectiveDate.value || todayStr(),
        })
      }
    } else {
      const { data } = await supabase.from('workers').insert({ ...workerPayload, account_id: accountId }).select('id').single()
      workerId = data!.id
    }

    // 代理人関係を全削除して再挿入
    await supabase.from('worker_proxies').delete().eq('worker_id', workerId).eq('account_id', accountId)
    if (modalProxyIds.value.length > 0) {
      await supabase.from('worker_proxies').insert(
        modalProxyIds.value.map(pid => ({
          worker_id:         workerId,
          proxy_operator_id: pid,
          account_id:        accountId,
        }))
      )
    }

    // 家族構成・車検履歴・健診履歴の同期
    await syncFamily(workerId!, accountId, familyMembers.value)
    await syncInspections(workerId!, accountId, vehicleInspections.value)
    await syncCheckups(workerId!, accountId, healthCheckups.value)

    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function toggleActive(w: Worker) {
  await supabase.from('workers').update({ active: !w.active }).eq('id', w.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table tr.inactive td { opacity: .4; }
.name { font-weight: 600; }
.price { font-variant-numeric: tabular-nums; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.factory { background: #e8f4ff; color: #1a6fc4; }
.badge.site { background: #e8fff0; color: #0a8a3a; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 8px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.proxy-badge { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #fee2e2; color: #dc2626; font-weight: 700; margin-right: 4px; }
.proxy-none { font-size: 12px; color: #ccc; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 400px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.proxy-check-list { display: flex; flex-direction: column; gap: 8px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; max-height: 160px; overflow-y: auto; }
.proxy-check-item { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.proxy-check-item input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.user-link { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.user-link.linked { background: #e8f4ff; color: #1a6fc4; }
.user-link.unlinked { background: #f5f5f5; color: #bbb; }
.emp-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.emp-badge.fulltime { background: #f0f4ff; color: #4f46e5; }
.emp-badge.parttime { background: #fff7ed; color: #c2710c; }
.emp-badge.contractor { background: #ecfdf5; color: #047857; }
.wage-hist { list-style: none; margin: 0; padding: 8px 12px; background: #f9fafb; border: 1px solid #eee; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; }
.wage-hist .wage-reason { color: #888; }
.hint-sm { font-size: 11px; color: #999; margin: 2px 0 0; }
.family-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.checkup-row { display: grid; grid-template-columns: 1fr 1.6fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.checkup-row .input { padding: 8px 10px; font-size: 13px; }
.family-row .input { padding: 8px 10px; font-size: 13px; }
.family-del { background: none; border: 1px solid #f0caca; color: #c0392b; border-radius: 6px; width: 30px; height: 32px; cursor: pointer; font-size: 14px; }
.btn-add-family { background: #f0f0f0; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #555; align-self: flex-start; }
.hire-date { font-size: 12px; color: #666; font-variant-numeric: tabular-nums; }
.auth-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.auth-status { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700; margin-left: 8px; }
.auth-status.set { background: #e8f4ff; color: #1a6fc4; }
.auth-status.unset { background: #f5f5f5; color: #bbb; }
.btn-auth { background: #1a6fc4; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-auth:disabled { opacity: .5; }
.auth-ok { color: #0a8a3a; font-size: 13px; }
</style>
