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
            <td><span class="emp-badge" :class="w.employment_type ?? 'fulltime'">{{ (w.employment_type ?? 'fulltime') === 'fulltime' ? '正社員' : `パート(週${w.weekly_scheduled_days ?? '?'}日)` }}</span></td>
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
        <div class="field">
          <label>雇用形態</label>
          <div class="toggle">
            <button :class="{ active: (modal.employment_type ?? 'fulltime') === 'fulltime' }" @click="modal.employment_type = 'fulltime'">正社員</button>
            <button :class="{ active: modal.employment_type === 'parttime' }" @click="modal.employment_type = 'parttime'">パート・アルバイト</button>
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
  employment_type: 'fulltime' | 'parttime' | null
  weekly_scheduled_days: number | null
}

const workers         = ref<Worker[]>([])
const linkedWorkerIds = ref<Set<string>>(new Set())
// worker_id → 代理人の worker_id 配列
const proxyMap        = ref<Map<string, string[]>>(new Map())
const modal           = ref<Partial<Worker> | null>(null)
// モーダルで選択中の代理人 ID リスト
const modalProxyIds   = ref<string[]>([])
const saving          = ref(false)
const saveError       = ref('')

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
    supabase.from('workers').select('id, name, role, unit_price, active, hire_date, birth_date, address, emergency_contact, employment_type, weekly_scheduled_days').eq('account_id', accountId).order('name'),
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
  modal.value = { name: '', role: 'site', unit_price: 20000, hire_date: null, birth_date: null, address: null, emergency_contact: null, employment_type: 'fulltime', weekly_scheduled_days: null }
  modalProxyIds.value = []
  saveError.value = ''
}

function openEdit(w: Worker) {
  modal.value = { ...w }
  modalProxyIds.value = [...(proxyMap.value.get(w.id) ?? [])]
  saveError.value = ''
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
    }

    if (workerId) {
      await supabase.from('workers').update(workerPayload).eq('id', workerId)
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
.hire-date { font-size: 12px; color: #666; font-variant-numeric: tabular-nums; }
</style>
