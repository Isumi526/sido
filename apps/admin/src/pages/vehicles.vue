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

        <!-- ▼ アップロード→自動入力（新規でも可・保存時に添付確定）: 写真＋車検証を上部に配置 -->
        <div class="field photo-field">
          <label>写真（複数可・各写真に名称）</label>
          <div v-if="photos.length || pendingPhotos.length" class="photo-list">
            <div v-for="p in photos" :key="p.id" class="photo-item">
              <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="photo-thumb-link">
                <img :src="p.url" class="photo-thumb" :alt="p.name || '写真'" />
              </a>
              <span v-else class="photo-thumb photo-thumb-empty">📷</span>
              <input v-model="p.name" class="input photo-name" placeholder="名称（例：運転席側）" @change="renamePhoto(p)" />
              <button class="photo-del" title="削除" @click="deletePhoto(p)">×</button>
            </div>
            <div v-for="(p, i) in pendingPhotos" :key="'pend' + i" class="photo-item pending">
              <img :src="p.preview" class="photo-thumb" :alt="p.name || '写真'" />
              <input v-model="p.name" class="input photo-name" placeholder="名称（任意・後で付けられます）" />
              <button class="photo-del" title="取り消し" @click="removePendingPhoto(i)">×</button>
            </div>
          </div>
          <span v-else class="muted">まだ写真がありません</span>
          <div class="photo-add photo-dropzone" :class="{ dragover: photoDragOver, busy: photoUploading }"
               @drop.prevent="onDropPhoto" @dragover.prevent="photoDragOver = true" @dragleave.prevent="photoDragOver = false">
            <label class="btn-photo-add">＋ 写真を追加（複数可）<input type="file" accept="image/*" multiple hidden :disabled="photoUploading" @change="onUploadPhoto" /></label>
            <span class="photo-drop-hint">{{ photoDragOver ? 'ここにドロップ' : 'またはここに画像を複数まとめてドラッグ&ドロップ（名称は後で）' }}</span>
            <span v-if="photoUploading" class="muted">アップロード中…</span>
          </div>
        </div>

        <div class="field shaken-field">
          <label>車検証（画像/PDFをアップロード→PDF保存・満了日を自動読取）</label>
          <div v-if="shakenDocs.length || pendingShaken.length" class="shaken-list">
            <div v-for="d in shakenDocs" :key="d.id" class="shaken-item">
              <span class="shaken-icon">📄</span>
              <a v-if="d.url" :href="d.url" target="_blank" rel="noopener" class="shaken-link">{{ d.name || '車検証' }}</a>
              <span v-else class="shaken-link muted">{{ d.name || '車検証' }}</span>
              <button class="shaken-del" title="削除" @click="deleteShaken(d)">×</button>
            </div>
            <div v-for="(f, i) in pendingShaken" :key="'ps' + i" class="shaken-item pending">
              <span class="shaken-icon">📄</span>
              <span class="shaken-link muted">{{ f.name }}（保存時にアップロード）</span>
              <button class="shaken-del" title="取り消し" @click="removePendingShaken(i)">×</button>
            </div>
          </div>
          <span v-else class="muted">まだ車検証がありません</span>
          <div class="shaken-add shaken-dropzone" :class="{ dragover: shakenDragOver, busy: shakenUploading }"
               @drop.prevent="onDropShaken" @dragover.prevent="shakenDragOver = true" @dragleave.prevent="shakenDragOver = false">
            <label class="btn-shaken-add" :class="{ busy: shakenUploading }">
              {{ shakenUploading ? '処理中…' : '＋ 車検証をアップロード' }}
              <input type="file" accept="image/*,application/pdf" hidden :disabled="shakenUploading" @change="onUploadShaken" />
            </label>
            <span class="shaken-drop-hint">{{ shakenDragOver ? 'ここにドロップ' : 'またはここに画像/PDFをドラッグ&ドロップ' }}</span>
          </div>
          <p v-if="shakenMsg" class="shaken-msg" :class="{ err: shakenErr }">{{ shakenMsg }}</p>
        </div>

        <div class="field">
          <label>ナンバー</label>
          <input v-model="modal.plate_number" class="input" placeholder="例：品川 500 あ 12-34" />
          <div class="plate-ai">
            <button type="button" class="btn-plate-ai" :class="{ busy: plateOcrBusy }"
                    :disabled="plateOcrBusy || (!pendingPhotos.length && !photos.length)"
                    @click="readPlateFromPhotos">
              {{ plateOcrBusy ? 'AI解析中…' : '🤖 アップロードした写真からナンバー読取' }}
            </button>
            <span class="plate-ai-hint">上でアップロードした車両写真からナンバーを探して自動入力（読取後に手動修正できます）</span>
          </div>
          <p v-if="plateOcrMsg" class="plate-ai-msg" :class="{ err: plateOcrErr }">{{ plateOcrMsg }}</p>
        </div>
        <div class="field">
          <label>車検年月日（満了日）</label>
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
import { getAccountId, getAccountSlug } from '../lib/account'

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

// 車両添付（#8 写真＋名称 / #10 車検証PDF）・非公開バケット vehicle-attachments・署名URLで表示
type VehiclePhoto = { id: string; vehicle_id: string; kind: string; name: string | null; path: string; url?: string | null }
const PHOTO_BUCKET   = 'vehicle-attachments'
const photos         = ref<VehiclePhoto[]>([])   // kind='photo'
const shakenDocs     = ref<VehiclePhoto[]>([])   // kind='shaken'（車検証PDF）
const newPhotoName   = ref('')
const photoUploading = ref(false)
const shakenUploading = ref(false)
const shakenMsg       = ref('')
const shakenErr       = ref(false)
// 新規登録時（vehicle_id 未確定）はファイルを保留し、保存時にまとめて添付アップロードする。
// アップロード時に OCR で満了日/ナンバーを即 prefill する＝「アップロード→自動入力」を新規でも成立させる。
const pendingPhotos  = ref<{ file: File; name: string; preview: string }[]>([])
const pendingShaken  = ref<File[]>([])
// 署名URLのホストを公開オリジン(VITE_SUPABASE_URL)に正規化する。
// ローカルの storage は内部ホスト(kong:8000)を埋めて返すためブラウザから開けない。
// 署名はパス+tokenに対して有効なのでホスト差し替えは安全。本番は同一ホスト＝no-op。
function normalizeStorageUrl(url: string): string {
  try {
    const base = new URL(import.meta.env.VITE_SUPABASE_URL as string)
    const u = new URL(url)
    if (u.host !== base.host) { u.protocol = base.protocol; u.host = base.host }
    return u.toString()
  } catch { return url }
}
async function photoSignedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('vehicle-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) return null
    return normalizeStorageUrl(data.url as string)
  } catch { return null }
}
async function loadPhotos(vehicleId: string) {
  const { data } = await supabase.from('vehicle_attachments')
    .select('id, vehicle_id, kind, name, path').eq('vehicle_id', vehicleId).order('created_at')
  const list = (data ?? []) as VehiclePhoto[]
  await Promise.all(list.map(async (p) => { p.url = await photoSignedUrl(p.id) }))
  photos.value     = list.filter(p => p.kind !== 'shaken')
  shakenDocs.value = list.filter(p => p.kind === 'shaken')
}
// 写真は複数同時アップロード可（選択・ドロップとも全ファイルを順に処理）
async function onUploadPhoto(ev: Event) {
  const input = ev.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) await processPhotoFile(f)
  input.value = ''
}
const photoDragOver = ref(false)
async function onDropPhoto(ev: DragEvent) {
  photoDragOver.value = false
  if (photoUploading.value) return
  for (const f of Array.from(ev.dataTransfer?.files ?? [])) await processPhotoFile(f)
}
async function processPhotoFile(file: File | undefined | null) {
  if (!file || !modal.value) return
  if (!file.type.startsWith('image/')) { saveError.value = '画像ファイルを選択してください'; return }
  // 新規登録: 保留リストへ（サムネ用にプレビューURL生成・名称は後付け・保存時にアップロード）
  if (!modal.value.id) {
    pendingPhotos.value.push({ file, name: '', preview: URL.createObjectURL(file) })
    return
  }
  photoUploading.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    // path 先頭フォルダ = account_id（storage RLS の account スコープに使用）。複数同時でも衝突しないよう乱数付与
    const path = `${accountId}/${modal.value.id}/photo-${Date.now()}-${Math.round(file.size % 100000)}.${ext}`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    // 名称は後付け（一覧の各写真で入力）＝ここでは null で保存
    await supabase.from('vehicle_attachments').insert({ account_id: accountId, vehicle_id: modal.value.id, kind: 'photo', name: null, path })
    await loadPhotos(modal.value.id)
  } catch (e: any) { saveError.value = e.message ?? '写真のアップロードに失敗しました' }
  finally { photoUploading.value = false }
}
function removePendingPhoto(i: number) {
  const p = pendingPhotos.value[i]
  if (p?.preview) URL.revokeObjectURL(p.preview)
  pendingPhotos.value.splice(i, 1)
}
function clearPendingPreviews() {
  for (const p of pendingPhotos.value) if (p.preview) URL.revokeObjectURL(p.preview)
}
// 保存直後(新規): 保留していた写真・車検証を、確定した vehicle_id で添付アップロード
async function uploadPendingAttachments(vehicleId: string, accountId: string) {
  for (const { file, name } of pendingPhotos.value) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${accountId}/${vehicleId}/photo-${Date.now()}-${Math.round(file.size % 100000)}.${ext}`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (!error) await supabase.from('vehicle_attachments').insert({ account_id: accountId, vehicle_id: vehicleId, kind: 'photo', name: name || null, path })
  }
  for (const file of pendingShaken.value) {
    const pdfBytes = await toShakenPdfBytes(file)
    const path = `${accountId}/${vehicleId}/shaken-${Date.now()}-${Math.round(file.size % 100000)}.pdf`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, new Blob([pdfBytes], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' })
    if (!error) await supabase.from('vehicle_attachments').insert({ account_id: accountId, vehicle_id: vehicleId, kind: 'shaken', name: '車検証', path })
  }
  clearPendingPreviews()
  pendingPhotos.value = []; pendingShaken.value = []
}
// ── ナンバーAI解析（#9・画像→Gemini vision→plate_number を prefill・手動修正可）──
const plateOcrBusy = ref(false)
const plateOcrMsg  = ref('')
const plateOcrErr  = ref(false)
function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file)
  })
}
// URL(署名URL含む)の画像を base64 に変換
async function urlToB64(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const b64 = await new Promise<string>((res, rej) => {
      const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob)
    })
    return { b64, mime: blob.type || 'image/jpeg' }
  } catch { return null }
}
// ナンバープレートOCRを1枚呼ぶ（読めたら plate_number 文字列・失敗は null）
async function callPlateOcr(b64: string, mime: string): Promise<string | null> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vehicle-plate-ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ account_slug: getAccountSlug(), image_base64: b64, mime }),
    })
    const j = await resp.json()
    return (resp.ok && j?.plate_number) ? (j.plate_number as string) : null
  } catch { return null }
}
// アップロード済み(保留＋保存済み)の車両写真からナンバーを探して自動入力（読めた最初の1枚を採用）
async function readPlateFromPhotos() {
  plateOcrBusy.value = true; plateOcrMsg.value = ''; plateOcrErr.value = false
  try {
    const getters: Array<() => Promise<{ b64: string; mime: string } | null>> = []
    for (const p of pendingPhotos.value) getters.push(async () => ({ b64: await fileToB64(p.file), mime: p.file.type || 'image/jpeg' }))
    for (const ph of photos.value) if (ph.url) getters.push(() => urlToB64(ph.url!))
    if (!getters.length) { plateOcrErr.value = true; plateOcrMsg.value = '先に車両写真をアップロードしてください（写真からナンバーを読み取ります）'; return }
    for (const get of getters) {
      const img = await get(); if (!img?.b64) continue
      const plate = await callPlateOcr(img.b64, img.mime)
      if (plate) { if (modal.value) modal.value.plate_number = plate; plateOcrMsg.value = `写真からナンバーを読み取りました：${plate}（確認・修正してください）`; return }
    }
    plateOcrErr.value = true; plateOcrMsg.value = 'アップロードした写真からナンバーを読み取れませんでした。別の写真を追加するか手動で入力してください。'
  } catch (e: any) {
    plateOcrErr.value = true; plateOcrMsg.value = e.message ?? 'AI解析に失敗しました'
  } finally {
    plateOcrBusy.value = false
  }
}

async function renamePhoto(p: VehiclePhoto) {
  await supabase.from('vehicle_attachments').update({ name: (p.name ?? '').trim() || null }).eq('id', p.id)
}

// ── 車検証（#10）: 画像→PDF化して保存＋満了日をAI読取→inspection_date へ prefill ──
// 画像1枚をPDF1ページに埋め込んでPDFバイト列を返す（PDFファイルはそのまま使う）
async function toShakenPdfBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return bytes
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
  const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const page = pdf.addPage([img.width, img.height])
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  return await pdf.save()
}
async function onUploadShaken(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  await processShakenFile(file)
  input.value = ''
}
// ドラッグ&ドロップ対応：1枚目のファイルを処理（画像/PDFのみ）
const shakenDragOver = ref(false)
async function onDropShaken(ev: DragEvent) {
  shakenDragOver.value = false
  if (shakenUploading.value) return
  const file = ev.dataTransfer?.files?.[0]
  await processShakenFile(file)
}
// 車検証画像から満了日を読取（画像時のみ・失敗は null）。edit/new 両方で共用。
async function ocrShakenDate(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const b64 = await fileToB64(file)
    const { data: sess } = await supabase.auth.getSession()
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vehicle-shaken-ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ account_slug: getAccountSlug(), image_base64: b64, mime: file.type || 'image/jpeg' }),
    })
    const j = await resp.json()
    return (resp.ok && j?.inspection_date) ? (j.inspection_date as string) : null
  } catch { return null }
}
async function processShakenFile(file: File | undefined | null) {
  if (!file || !modal.value) return
  if (!(file.type.startsWith('image/') || file.type === 'application/pdf' || /\.(pdf|png|jpe?g)$/i.test(file.name))) {
    shakenErr.value = true; shakenMsg.value = '画像またはPDFファイルを選択してください'; return
  }
  shakenUploading.value = true; shakenMsg.value = ''; shakenErr.value = false; saveError.value = ''
  try {
    // 新規登録（vehicle_id 未確定）: ファイルを保留し、満了日だけ先に読取って prefill。保存時に添付確定。
    if (!modal.value.id) {
      pendingShaken.value.push(file)
      const d = await ocrShakenDate(file)
      if (d) { modal.value.inspection_date = d; shakenMsg.value = `車検証を追加。満了日を読み取りました：${d}（保存時にアップロード）` }
      else shakenMsg.value = file.type.startsWith('image/') ? '車検証を追加（満了日は読取れず・手動入力／保存時にアップロード）' : '車検証(PDF)を追加（満了日は手動／保存時にアップロード）'
      return
    }
    // 編集: 即PDF化して保存
    const accountId = await getAccountId()
    const pdfBytes = await toShakenPdfBytes(file)
    const path = `${accountId}/${modal.value.id}/shaken-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, new Blob([pdfBytes], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' })
    if (upErr) throw upErr
    await supabase.from('vehicle_attachments').insert({ account_id: accountId, vehicle_id: modal.value.id, kind: 'shaken', name: '車検証', path })
    await loadPhotos(modal.value.id)
    shakenMsg.value = '車検証をPDFで保存しました。満了日をAI解析中…'
    const d = await ocrShakenDate(file)
    if (d) { if (modal.value) modal.value.inspection_date = d; shakenMsg.value = `車検証を保存し、車検満了日を読み取りました：${d}（確認・修正してください）` }
    else shakenMsg.value = file.type.startsWith('image/') ? '車検証を保存しました。満了日は読み取れなかったため手動で入力してください。' : '車検証(PDF)を保存しました。満了日は手動で入力してください。'
  } catch (e: any) {
    shakenErr.value = true; shakenMsg.value = e.message ?? '車検証の保存に失敗しました'
  } finally {
    shakenUploading.value = false   // input のクリアは呼び出し側(onUploadShaken)で実施
  }
}
function removePendingShaken(i: number) { pendingShaken.value.splice(i, 1) }
async function deleteShaken(p: VehiclePhoto) {
  if (!confirm('この車検証を削除しますか？')) return
  await supabase.storage.from(PHOTO_BUCKET).remove([p.path])
  await supabase.from('vehicle_attachments').delete().eq('id', p.id)
  if (modal.value?.id) await loadPhotos(modal.value.id)
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
  shakenDocs.value = []
  clearPendingPreviews()
  pendingPhotos.value = []
  pendingShaken.value = []
  newPhotoName.value = ''
  shakenMsg.value = ''; shakenErr.value = false
  saveError.value = ''
  plateOcrMsg.value = ''; plateOcrErr.value = false
  shakenMsg.value = ''; shakenErr.value = false
}

async function openEdit(v: Vehicle) {
  modal.value = { ...v }
  saveError.value = ''
  newRepair.value = { repair_date: null, description: '', cost: null }
  newPhotoName.value = ''
  photos.value = []
  shakenDocs.value = []
  clearPendingPreviews()
  pendingPhotos.value = []
  pendingShaken.value = []
  plateOcrMsg.value = ''; plateOcrErr.value = false
  shakenMsg.value = ''; shakenErr.value = false
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
      const { data: created, error: insErr } = await supabase.from('vehicles').insert({ ...payload, account_id: accountId }).select('id').single()
      if (insErr) throw insErr
      // 新規登録で保留していた写真・車検証を、確定した vehicle_id で添付アップロード
      if (created?.id && (pendingPhotos.value.length || pendingShaken.value.length)) {
        await uploadPendingAttachments(created.id as string, accountId)
      }
    }
    modal.value = null
    await load()
  } catch (e: any) {
    const msg = String(e?.message ?? '')
    // 車両名の一意制約違反はわかりやすく案内
    if (/duplicate key|vehicles_name_account_uidx|unique constraint/i.test(msg)) {
      saveError.value = `「${modal.value?.name?.trim()}」は既に登録されています。別の車両名にしてください。`
    } else {
      saveError.value = msg || '保存に失敗しました'
    }
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
.plate-ai { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
.btn-plate-ai { background: #eef2ff; color: #4338ca; border: none; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-plate-ai.busy { opacity: .6; cursor: default; }
.btn-plate-ai:disabled { opacity: .45; cursor: not-allowed; }
.plate-ai-hint { font-size: 11px; color: #94a3b8; }
.plate-ai-msg { font-size: 12px; color: #0a8a3a; margin-top: 4px; }
.plate-ai-msg.err { color: #dc2626; }
.shaken-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.shaken-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.shaken-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.shaken-icon { flex-shrink: 0; }
.shaken-link { flex: 1; color: #0369a1; text-decoration: none; }
.shaken-link:hover { text-decoration: underline; }
.shaken-del { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 18px; line-height: 1; flex-shrink: 0; }
.shaken-add { margin-top: 4px; }
.shaken-dropzone { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border: 2px dashed #e5d3a1; border-radius: 10px; padding: 12px 14px; background: #fffdf5; transition: border-color .15s, background .15s; }
.shaken-dropzone.dragover { border-color: #d97706; background: #fef3c7; }
.shaken-dropzone.busy { opacity: .7; }
.shaken-drop-hint { font-size: 12px; color: #a16207; pointer-events: none; }
.btn-shaken-add { background: #fef3c7; color: #92400e; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-shaken-add.busy { opacity: .6; cursor: default; }
.shaken-msg { font-size: 12px; color: #0a8a3a; margin-top: 6px; }
.shaken-msg.err { color: #dc2626; }
.photo-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.photo-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.photo-item { display: flex; align-items: center; gap: 10px; }
.photo-item.pending, .shaken-item.pending { opacity: .85; }
.pending-name { flex: 1; font-size: 13px; color: #92400e; }
.photo-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e0e0e0; display: block; }
.photo-thumb-empty { display: flex; align-items: center; justify-content: center; background: #f5f5f5; font-size: 20px; }
.photo-thumb-link { flex-shrink: 0; }
.photo-name { flex: 1; }
.photo-del { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 18px; line-height: 1; flex-shrink: 0; }
.photo-add { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.photo-dropzone { border: 2px dashed #bae6fd; border-radius: 10px; padding: 12px 14px; background: #f8fdff; transition: border-color .15s, background .15s; }
.photo-dropzone.dragover { border-color: #0284c7; background: #e0f2fe; }
.photo-dropzone.busy { opacity: .7; }
.photo-drop-hint { font-size: 12px; color: #0369a1; pointer-events: none; }
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
