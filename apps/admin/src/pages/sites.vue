<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場マスタ</h1>
      <div class="header-actions">
        <button v-if="!mergeMode" class="btn-ghost" @click="startMerge">現場をマージ</button>
        <template v-else>
          <button class="btn-ghost" :disabled="mergePick.length !== 2" @click="openMerge">マージ実行（{{ mergePick.length }}/2）</button>
          <button class="btn-ghost" @click="cancelMerge">キャンセル</button>
        </template>
        <button class="btn-add" @click="openAdd">＋ 追加</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th v-if="mergeMode"></th><th>現場名</th><th>読み仮名</th><th>状態</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in sites" :key="s.id" :class="{ inactive: !s.active }">
            <td v-if="mergeMode"><input type="checkbox" :value="s.id" v-model="mergePick" :disabled="!s.active" /></td>
            <td class="name">{{ s.name }}</td>
            <td class="kana">{{ s.name_kana || '—' }}</td>
            <td><span class="status" :class="s.active ? 'active' : 'off'">{{ s.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(s)">編集</button>
              <button class="btn-toggle" @click="toggleActive(s)">{{ s.active ? '無効化' : '有効化' }}</button>
              <button class="btn-rules" @click="router.push(`/site-rules?site_id=${s.id}`)">ルール・QR設定</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '現場を編集' : '現場を追加' }}</h2>
        <div class="field">
          <label>現場名</label>
          <input v-model="modal.name" class="input" placeholder="例：BLH名古屋" />
          <div v-if="similarSites.length" class="dup-warn">
            ⚠️ 似た現場が既にあります（重複登録に注意）：<strong>{{ similarSites.join('、') }}</strong>
          </div>
        </div>
        <div class="field">
          <label>読み仮名（50音順の並びに使用）</label>
          <input v-model="modal.name_kana" class="input" placeholder="例：びーえるえいちなごや" />
        </div>
        <div class="field">
          <label>元請け（日報の現場絞り込みに使用・任意）</label>
          <select v-model="modal.contractor_id" class="input">
            <option :value="null">未紐付け</option>
            <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>この現場に紐づく下請け業者（日報の業者プルダウンを絞り込み）</label>
          <div class="sub-link-list" data-testid="site-sub-links">
            <label v-for="s in subcontractors" :key="s.id" class="sub-link-item">
              <input type="checkbox" :value="s.id" v-model="modal.linkedSubs" />{{ s.name }}
            </label>
            <span v-if="!subcontractors.length" class="hint">下請け業者マスタが空です</span>
          </div>
          <p class="hint">未選択なら日報では全業者が出ます（紐付けすると、その現場では選択した業者のみに絞り込み）。</p>
        </div>
        <div class="field">
          <label>場所 / 住所</label>
          <input v-model="modal.location" class="input" placeholder="例：名古屋市〇〇区…" />
        </div>
        <div class="field">
          <label>工事種類</label>
          <input v-model="modal.construction_type" class="input" placeholder="例：内装・改修" />
        </div>
        <div class="field">
          <label>工事内容</label>
          <textarea v-model="modal.construction_details" class="input" rows="2" placeholder="例：1F内装ボード・クロス工事 一式"></textarea>
        </div>
        <div class="field">
          <label>メモ</label>
          <textarea v-model="modal.memo" class="input" rows="2" placeholder="任意"></textarea>
        </div>

        <!-- 写真・書類（既存現場のみ） -->
        <div v-if="modal.id" class="field">
          <label>写真・書類（複数可）</label>
          <div v-if="attachments.length" class="att-list">
            <div v-for="a in attachments" :key="a.id" class="att-item">
              <span class="att-kind">{{ a.kind === 'photo' ? '📷' : '📄' }}</span>
              <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="att-link">{{ a.name || a.path.split('/').pop() }}</a>
              <span v-else class="att-link att-disabled">{{ a.name || a.path.split('/').pop() }}</span>
              <label v-if="a.kind === 'document'" class="att-consent" :class="{ on: a.require_consent }" :title="'出退勤（チェックイン）時に作業員へ提示し同意を取る'">
                <input type="checkbox" :checked="a.require_consent" @change="toggleConsent(a)" />出退勤同意
              </label>
              <button class="att-del" @click="removeAttachment(a)">×</button>
            </div>
          </div>
          <div class="att-add">
            <label class="att-btn">＋ 写真<input type="file" accept="image/*" hidden :disabled="uploading" @change="onAttach($event, 'photo')" /></label>
            <label class="att-btn">＋ 書類<input type="file" accept="application/pdf,image/*" hidden :disabled="uploading" @change="onAttach($event, 'document')" /></label>
            <span v-if="uploading" class="att-up">アップロード中…</span>
          </div>
        </div>
        <p v-else class="hint">写真・書類は保存後（現場作成後）に添付できます。</p>

        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>

    <!-- マージモーダル -->
    <div v-if="mergeModal" class="modal-overlay" @click.self="mergeModal = null">
      <div class="modal">
        <h2>現場をマージ</h2>
        <p class="hint">どちらに統合しますか？（残す方を選択。もう一方は無効化され、日報・予定などの参照は残す側に統合されます）</p>
        <label class="merge-opt" v-for="s in mergeModal.sites" :key="s.id">
          <input type="radio" :value="s.id" v-model="mergeTarget" /> <strong>{{ s.name }}</strong> を残す
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
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { findSimilarSiteNames } from '../lib/siteSimilarity'

const router = useRouter()

type Site = {
  id: string; name: string; name_kana: string | null; active: boolean
  location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null
  contractor_id: string | null   // 紐づく元請け（任意）
}
type Att = { id: string; site_id: string; kind: string; path: string; name: string | null; require_consent?: boolean; url?: string | null }

const BUCKET = 'site-attachments'
const sites     = ref<Site[]>([])
const contractors = ref<{ id: string; name: string }[]>([])   // 元請けマスタ（紐付け用）
const subcontractors = ref<{ id: string; name: string }[]>([]) // 下請け業者マスタ（現場紐付け用）
const modal     = ref<Partial<Site> & { linkedSubs?: string[] } | null>(null)
const saving    = ref(false)
const saveError = ref('')
// 編集中の現場の添付（写真・書類）
const attachments = ref<Att[]>([])
const uploading   = ref(false)
// 非公開バケット → edge(site-attachment-url)で短TTL署名URLを取得（getPublicUrl廃止）
async function signedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('site-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) return null
    return data.url as string
  } catch { return null }
}

// ── マージ（重複現場の統合）──
const mergeMode   = ref(false)
const mergePick   = ref<string[]>([])
const mergeModal  = ref<{ sites: Site[] } | null>(null)
const mergeTarget = ref<string>('')
// site_id(FK) を持つ参照テーブル（merge時に統合先へ付け替え）
const SITE_FK_TABLES = ['attendance_logs', 'estimates', 'purchase_orders', 'schedules', 'site_rules', 'subcontractor_invoice_items']

// 入力中の現場名に「似た」既存現場（自分自身=編集中のidは除外）。重複登録の気づき用。
const similarSites = computed(() =>
  modal.value
    ? findSimilarSiteNames(modal.value.name ?? '', sites.value.filter((s) => s.id !== modal.value!.id).map((s) => s.name))
    : [],
)

async function load() {
  const accountId = await getAccountId()
  const [{ data }, { data: cons }] = await Promise.all([
    supabase.from('sites')
      .select('id, name, name_kana, active, location, construction_type, construction_details, memo, contractor_id')
      .eq('account_id', accountId)
      .order('name_kana', { nullsFirst: false })
      .order('name'),
    supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('sort_order').order('name'),
  ])
  sites.value = (data ?? []) as Site[]
  contractors.value = (cons ?? []) as { id: string; name: string }[]
  const { data: subs } = await supabase.from('subcontractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  subcontractors.value = (subs ?? []) as { id: string; name: string }[]
}
onMounted(load)

const contractorName = (id: string | null | undefined) => contractors.value.find((c) => c.id === id)?.name ?? '—'

function openAdd()        { modal.value = { name: '', name_kana: '', location: '', construction_type: '', construction_details: '', memo: '', contractor_id: null, linkedSubs: [] }; attachments.value = []; saveError.value = '' }
async function openEdit(s: Site) {
  modal.value = { ...s, linkedSubs: [] }; saveError.value = ''
  const { data: links } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', s.id)
  if (modal.value) modal.value.linkedSubs = ((links ?? []) as any[]).map(l => l.subcontractor_id)
  await loadAttachments(s.id)
}

// 現場↔下請け業者の紐付けを同期（チェックされたものだけ残す）
async function syncSiteSubcontractors(siteId: string, accountId: string, want: string[]) {
  const { data } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', siteId)
  const have = ((data ?? []) as any[]).map(l => l.subcontractor_id as string)
  const toAdd = want.filter(id => !have.includes(id))
  const toDel = have.filter(id => !want.includes(id))
  if (toAdd.length) await supabase.from('site_subcontractors').insert(toAdd.map(subId => ({ site_id: siteId, subcontractor_id: subId, account_id: accountId })))
  if (toDel.length) await supabase.from('site_subcontractors').delete().eq('site_id', siteId).in('subcontractor_id', toDel)
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '現場名を入力してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const m = modal.value
    const payload = {
      name: m.name!.trim(), name_kana: m.name_kana?.trim() || null,
      location: m.location?.trim() || null, construction_type: m.construction_type?.trim() || null,
      construction_details: m.construction_details?.trim() || null, memo: m.memo?.trim() || null,
      contractor_id: m.contractor_id || null,
    }
    const accountId = await getAccountId()
    let siteId = m.id
    if (siteId) {
      await supabase.from('sites').update(payload).eq('id', siteId)
    } else {
      const { data } = await supabase.from('sites').insert({ ...payload, account_id: accountId }).select('id').single()
      siteId = (data as any)?.id
    }
    if (siteId) await syncSiteSubcontractors(siteId, accountId, m.linkedSubs ?? [])
    modal.value = null; await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally { saving.value = false }
}

// ── 添付（写真・書類）──
async function loadAttachments(siteId: string) {
  const { data } = await supabase.from('site_attachments').select('id, site_id, kind, path, name, require_consent').eq('site_id', siteId).order('created_at')
  const atts = (data ?? []) as Att[]
  // 表示用の署名URLを並列取得（非公開バケット）
  await Promise.all(atts.map(async (a) => { a.url = await signedUrl(a.id) }))
  attachments.value = atts
}
async function onAttach(ev: Event, kind: 'photo' | 'document') {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || !modal.value?.id) return
  uploading.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    // path 先頭フォルダ = account_id（storage RLS の account スコープに使用）
    const path = `${accountId}/${modal.value.id}/${kind}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    await supabase.from('site_attachments').insert({ account_id: accountId, site_id: modal.value.id, kind, path, name: file.name })
    await loadAttachments(modal.value.id)
  } catch (e: any) { saveError.value = e.message ?? 'アップロードに失敗しました' }
  finally { uploading.value = false; (ev.target as HTMLInputElement).value = '' }
}
// 書類を「出退勤時に同意必須」に切替（送り出し資料）。チェックイン時に作業員へ提示・同意を取る。
async function toggleConsent(a: Att) {
  const next = !a.require_consent
  await supabase.from('site_attachments').update({ require_consent: next }).eq('id', a.id)
  a.require_consent = next
}
async function removeAttachment(a: Att) {
  if (!confirm(`「${a.name || a.kind}」を削除しますか？`)) return
  await supabase.storage.from(BUCKET).remove([a.path]).then(() => {}, () => {})
  await supabase.from('site_attachments').delete().eq('id', a.id)
  if (modal.value?.id) await loadAttachments(modal.value.id)
}

async function toggleActive(s: Site) {
  await supabase.from('sites').update({ active: !s.active }).eq('id', s.id)
  await load()
}

function startMerge()  { mergeMode.value = true; mergePick.value = [] }
function cancelMerge() { mergeMode.value = false; mergePick.value = [] }
function openMerge() {
  const picked = sites.value.filter((s) => mergePick.value.includes(s.id))
  if (picked.length !== 2) return
  mergeModal.value = { sites: picked }; mergeTarget.value = picked[0].id; saveError.value = ''
}

async function doMerge() {
  const target = mergeModal.value!.sites.find((s) => s.id === mergeTarget.value)!
  const source = mergeModal.value!.sites.find((s) => s.id !== mergeTarget.value)!
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    // 1) site_id(FK) を持つ参照を統合先へ付け替え
    for (const tbl of SITE_FK_TABLES) {
      await supabase.from(tbl).update({ site_id: target.id }).eq('site_id', source.id).then(() => {}, () => {})
    }
    // 2) daily_reports.sites[].siteName（文字列参照）を source.name → target.name に書き換え
    const { data: reps } = await supabase.from('daily_reports').select('id, sites').eq('account_id', accountId).limit(10000)
    for (const r of (reps ?? []) as any[]) {
      const arr = Array.isArray(r.sites) ? r.sites : []
      let changed = false
      const next = arr.map((s: any) => (s?.siteName === source.name ? (changed = true, { ...s, siteName: target.name }) : s))
      if (changed) await supabase.from('daily_reports').update({ sites: next }).eq('id', r.id)
    }
    // 3) source を無効化（統合元）
    await supabase.from('sites').update({ active: false }).eq('id', source.id)
    mergeModal.value = null; cancelMerge(); await load()
  } catch (e: any) {
    saveError.value = e.message ?? 'マージに失敗しました'
  } finally { saving.value = false }
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
.kana { color: #888; font-size: 13px; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn-rules { background: #e0f2fe; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #0369a1; font-weight: 600; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 360px; display: flex; flex-direction: column; gap: 20px; max-height: 90vh; overflow-y: auto; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.sub-link-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; padding: 8px 10px; background: #fafafa; }
.sub-link-item { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 400; color: #333; cursor: pointer; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.dup-warn { margin-top: 6px; font-size: 12px; color: #B45309; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 6px; padding: 8px 10px; line-height: 1.5; }
.dup-warn strong { color: #92400E; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 10px 16px; font-size: 13px; cursor: pointer; color: #555; }
.btn-ghost:disabled { opacity: .5; cursor: not-allowed; }
.merge-opt { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 14px; cursor: pointer; }
.att-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.att-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.att-link { color: #1a56c4; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-del { background: none; border: none; color: #c0392b; cursor: pointer; font-size: 16px; }
.att-consent { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #888; white-space: nowrap; cursor: pointer; }
.att-consent.on { color: #0a8a3a; font-weight: 700; }
.att-consent input { cursor: pointer; }
.att-add { display: flex; gap: 8px; align-items: center; }
.att-btn { background: #f0f0f0; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.att-up { font-size: 12px; color: #888; }
textarea.input { resize: vertical; font-family: inherit; }
</style>
