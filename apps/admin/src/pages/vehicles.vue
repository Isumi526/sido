<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">車両マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>車両名</th>
            <th>ナンバー</th>
            <th>車検</th>
            <th>スタッドレス</th>
            <th>保険</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vehicles" :key="v.id" :class="{ inactive: !v.active }">
            <td class="name">{{ v.name }}</td>
            <td class="plate">{{ v.plate_number || '—' }}</td>
            <td class="shaken">
              <template v-if="v.inspection_date">
                <span class="shaken-date">{{ v.inspection_date }}</span>
                <span class="shaken-badge" :class="shakenClass(v.inspection_date)">{{ shakenLabel(v.inspection_date) }}</span>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td><span class="status" :class="v.has_studless ? 'active' : 'off'">{{ v.has_studless ? '有' : '無' }}</span></td>
            <td>
              <span class="status" :class="v.has_insurance ? 'active' : 'off'">{{ v.has_insurance ? '加入' : '未加入' }}</span>
              <span v-if="v.has_insurance && v.insurance_note" class="ins-note">{{ v.insurance_note }}</span>
            </td>
            <td><span class="status" :class="v.active ? 'active' : 'off'">{{ v.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(v)">編集</button>
              <button class="btn-toggle" @click="toggleActive(v)">{{ v.active ? '無効化' : '有効化' }}</button>
            </td>
          </tr>
          <tr v-if="vehicles.length === 0">
            <td colspan="7" class="empty">車両がまだ登録されていません</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '車両を編集' : '車両を追加' }}</h2>
        <div class="field">
          <label>車両名</label>
          <input v-model="modal.name" class="input" placeholder="例：ハイエース1号車" data-testid="vehicle-name" />
        </div>
        <div class="field">
          <label>ナンバー</label>
          <input v-model="modal.plate_number" class="input" placeholder="例：品川 500 あ 12-34" />
        </div>
        <div class="field">
          <label>車検年月日</label>
          <input v-model="modal.inspection_date" type="date" class="input" data-testid="vehicle-inspection-date" />
        </div>
        <div class="field">
          <label>スタッドレスタイヤ</label>
          <div class="toggle">
            <button :class="{ active: modal.has_studless === true }" @click="modal.has_studless = true">有</button>
            <button :class="{ active: !modal.has_studless }" @click="modal.has_studless = false">無</button>
          </div>
        </div>
        <div class="field">
          <label>任意保険</label>
          <div class="toggle">
            <button :class="{ active: modal.has_insurance === true }" @click="modal.has_insurance = true">加入</button>
            <button :class="{ active: !modal.has_insurance }" @click="modal.has_insurance = false">未加入</button>
          </div>
        </div>
        <div v-if="modal.has_insurance" class="field">
          <label>保険の内容（軽く）</label>
          <input v-model="modal.insurance_note" class="input" placeholder="例：◯◯損保 対人対物無制限・車両あり" />
        </div>

        <!-- 写真＋名称（編集時のみ。新規は保存後に編集で追加） -->
        <div v-if="modal.id" class="field photo-field">
          <label>写真（複数可・各写真に名称）</label>
          <div v-if="photos.length" class="photo-list">
            <div v-for="p in photos" :key="p.id" class="photo-item">
              <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="photo-thumb-link">
                <img :src="p.url" class="photo-thumb" :alt="p.name || '写真'" />
              </a>
              <span v-else class="photo-thumb photo-thumb-empty">📷</span>
              <input v-model="p.name" class="input photo-name" placeholder="名称（例：運転席側）" @change="renamePhoto(p)" />
              <button class="photo-del" title="削除" @click="deletePhoto(p)">×</button>
            </div>
          </div>
          <span v-else class="muted">まだ写真がありません</span>
          <div class="photo-add">
            <input v-model="newPhotoName" class="input photo-name" placeholder="名称（任意）" />
            <label class="btn-photo-add">＋ 写真を追加<input type="file" accept="image/*" hidden :disabled="photoUploading" @change="onUploadPhoto" /></label>
            <span v-if="photoUploading" class="muted">アップロード中…</span>
          </div>
        </div>

        <!-- 修理ログ（編集時のみ。新規は保存後に編集で追加） -->
        <div v-if="modal.id" class="field repair-field">
          <label>修理ログ</label>
          <div class="repair-list">
            <div v-for="r in repairLogs" :key="r.id" class="repair-item">
              <span class="repair-date">{{ r.repair_date }}</span>
              <span class="repair-desc">{{ r.description }}</span>
              <span v-if="r.cost != null" class="repair-cost">¥{{ r.cost.toLocaleString() }}</span>
              <button class="repair-del" title="削除" @click="deleteRepair(r)">×</button>
            </div>
            <span v-if="repairLogs.length === 0" class="muted">まだありません</span>
          </div>
          <div class="repair-add">
            <input v-model="newRepair.repair_date" type="date" class="input repair-in" />
            <input v-model="newRepair.description" class="input repair-in" placeholder="内容（例：オイル交換）" />
            <input v-model.number="newRepair.cost" type="number" class="input repair-in repair-cost-in" placeholder="費用" />
            <button class="btn-repair-add" :disabled="repairSaving" @click="addRepair">追加</button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" data-testid="vehicle-save" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
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

type Vehicle = {
  id: string
  name: string
  plate_number: string | null
  inspection_date: string | null
  has_studless: boolean
  has_insurance: boolean
  insurance_note: string | null
  active: boolean
}

type RepairLog = {
  id: string
  vehicle_id: string
  repair_date: string
  description: string
  cost: number | null
}

const vehicles    = ref<Vehicle[]>([])
const modal       = ref<Partial<Vehicle> | null>(null)
const saving      = ref(false)
const saveError   = ref('')
const repairLogs  = ref<RepairLog[]>([])
const newRepair   = ref<{ repair_date: string | null; description: string; cost: number | null }>({ repair_date: null, description: '', cost: null })
const repairSaving = ref(false)

// 車両写真＋名称（#8・非公開バケット vehicle-attachments・署名URLで表示）
type VehiclePhoto = { id: string; vehicle_id: string; name: string | null; path: string; url?: string | null }
const PHOTO_BUCKET   = 'vehicle-attachments'
const photos         = ref<VehiclePhoto[]>([])
const newPhotoName   = ref('')
const photoUploading = ref(false)
async function photoSignedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('vehicle-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) return null
    return data.url as string
  } catch { return null }
}
async function loadPhotos(vehicleId: string) {
  const { data } = await supabase.from('vehicle_attachments')
    .select('id, vehicle_id, name, path').eq('vehicle_id', vehicleId).order('created_at')
  const list = (data ?? []) as VehiclePhoto[]
  await Promise.all(list.map(async (p) => { p.url = await photoSignedUrl(p.id) }))
  photos.value = list
}
async function onUploadPhoto(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || !modal.value?.id) return
  photoUploading.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    // path 先頭フォルダ = account_id（storage RLS の account スコープに使用）
    const path = `${accountId}/${modal.value.id}/photo-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    await supabase.from('vehicle_attachments').insert({ account_id: accountId, vehicle_id: modal.value.id, kind: 'photo', name: newPhotoName.value.trim() || null, path })
    newPhotoName.value = ''
    await loadPhotos(modal.value.id)
  } catch (e: any) { saveError.value = e.message ?? '写真のアップロードに失敗しました' }
  finally { photoUploading.value = false; (ev.target as HTMLInputElement).value = '' }
}
async function renamePhoto(p: VehiclePhoto) {
  await supabase.from('vehicle_attachments').update({ name: (p.name ?? '').trim() || null }).eq('id', p.id)
}
async function deletePhoto(p: VehiclePhoto) {
  if (!confirm('この写真を削除しますか？')) return
  await supabase.storage.from(PHOTO_BUCKET).remove([p.path])
  await supabase.from('vehicle_attachments').delete().eq('id', p.id)
  if (modal.value?.id) await loadPhotos(modal.value.id)
}

// 車検期日までの残日数（JST基準）。null は車検日未設定
function daysUntil(dateStr: string): number {
  const today = new Date()
  const t = new Date(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00+09:00`)
  const d = new Date(`${dateStr}T00:00:00+09:00`)
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}
function shakenClass(dateStr: string): string {
  const n = daysUntil(dateStr)
  if (n < 0) return 'over'
  if (n <= 45) return 'soon'
  return 'ok'
}
function shakenLabel(dateStr: string): string {
  const n = daysUntil(dateStr)
  if (n < 0) return `期限切れ ${-n}日`
  if (n === 0) return '本日'
  if (n <= 45) return `あと${n}日`
  return 'OK'
}

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('vehicles')
    .select('id, name, plate_number, inspection_date, has_studless, has_insurance, insurance_note, active')
    .eq('account_id', accountId)
    .order('sort_order')
    .order('name')
  vehicles.value = (data ?? []) as Vehicle[]
}

onMounted(load)

function openAdd() {
  modal.value = { name: '', plate_number: null, inspection_date: null, has_studless: false, has_insurance: false, insurance_note: null }
  repairLogs.value = []
  newRepair.value = { repair_date: null, description: '', cost: null }
  photos.value = []
  newPhotoName.value = ''
  saveError.value = ''
}

async function openEdit(v: Vehicle) {
  modal.value = { ...v }
  saveError.value = ''
  newRepair.value = { repair_date: null, description: '', cost: null }
  newPhotoName.value = ''
  photos.value = []
  await Promise.all([loadRepairs(v.id), loadPhotos(v.id)])
}

async function loadRepairs(vehicleId: string) {
  const { data } = await supabase
    .from('vehicle_repair_logs')
    .select('id, vehicle_id, repair_date, description, cost')
    .eq('vehicle_id', vehicleId)
    .order('repair_date', { ascending: false })
  repairLogs.value = (data ?? []) as RepairLog[]
}

async function addRepair() {
  if (!modal.value?.id) return
  if (!newRepair.value.repair_date || !newRepair.value.description.trim()) {
    saveError.value = '修理ログは日付と内容が必要です'
    return
  }
  repairSaving.value = true
  saveError.value = ''
  try {
    const accountId = await getAccountId()
    await supabase.from('vehicle_repair_logs').insert({
      vehicle_id:  modal.value.id,
      account_id:  accountId,
      repair_date: newRepair.value.repair_date,
      description: newRepair.value.description.trim(),
      cost:        newRepair.value.cost ?? null,
    })
    newRepair.value = { repair_date: null, description: '', cost: null }
    await loadRepairs(modal.value.id)
  } catch (e: any) {
    saveError.value = e.message ?? '修理ログの追加に失敗しました'
  } finally {
    repairSaving.value = false
  }
}

async function deleteRepair(r: RepairLog) {
  await supabase.from('vehicle_repair_logs').delete().eq('id', r.id)
  if (modal.value?.id) await loadRepairs(modal.value.id)
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '車両名を入力してください'; return }
  saving.value = true
  saveError.value = ''
  try {
    const accountId = await getAccountId()
    const payload = {
      name:            modal.value.name!.trim(),
      plate_number:    modal.value.plate_number?.trim() || null,
      inspection_date: modal.value.inspection_date || null,
      has_studless:    modal.value.has_studless ?? false,
      has_insurance:   modal.value.has_insurance ?? false,
      insurance_note:  modal.value.has_insurance ? (modal.value.insurance_note?.trim() || null) : null,
    }
    if (modal.value.id) {
      await supabase.from('vehicles').update(payload).eq('id', modal.value.id)
    } else {
      await supabase.from('vehicles').insert({ ...payload, account_id: accountId })
    }
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function toggleActive(v: Vehicle) {
  await supabase.from('vehicles').update({ active: !v.active }).eq('id', v.id)
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
.plate { font-variant-numeric: tabular-nums; color: #555; }
.shaken-date { font-size: 12px; color: #666; font-variant-numeric: tabular-nums; margin-right: 8px; }
.shaken-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.shaken-badge.ok { background: #e8fff0; color: #0a8a3a; }
.shaken-badge.soon { background: #fff7ed; color: #c2710c; }
.shaken-badge.over { background: #fee2e2; color: #dc2626; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.ins-note { font-size: 11px; color: #888; margin-left: 6px; }
.muted, .empty { color: #ccc; font-size: 13px; }
.empty { text-align: center; padding: 32px; }
.actions { display: flex; gap: 8px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 440px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.photo-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.photo-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.photo-item { display: flex; align-items: center; gap: 10px; }
.photo-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e0e0e0; display: block; }
.photo-thumb-empty { display: flex; align-items: center; justify-content: center; background: #f5f5f5; font-size: 20px; }
.photo-thumb-link { flex-shrink: 0; }
.photo-name { flex: 1; }
.photo-del { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 18px; line-height: 1; flex-shrink: 0; }
.photo-add { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.btn-photo-add { background: #e0f2fe; color: #0369a1; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.repair-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.repair-list { display: flex; flex-direction: column; gap: 6px; background: #f9f9f9; border-radius: 8px; padding: 10px; max-height: 160px; overflow-y: auto; }
.repair-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.repair-date { color: #666; font-variant-numeric: tabular-nums; }
.repair-desc { flex: 1; }
.repair-cost { color: #555; font-variant-numeric: tabular-nums; }
.repair-del { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 16px; line-height: 1; }
.repair-add { display: flex; gap: 6px; margin-top: 8px; }
.repair-in { flex: 1; }
.repair-cost-in { max-width: 90px; }
.btn-repair-add { background: #1a6fc4; color: #fff; border: none; border-radius: 8px; padding: 0 14px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-repair-add:disabled { opacity: .5; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
