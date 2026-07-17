<template>
  <div class="site-detail">
    <!-- ヘッダー -->
    <div class="detail-head">
      <button class="btn-back" @click="router.push('/sites')">← 現場マスタ</button>
      <div class="head-main">
        <div class="head-title">
          <span v-if="site" class="status" :class="site.active ? 'active' : 'off'">{{ site.active ? '進行中（有効）' : '無効' }}</span>
          <h1 class="page-title">{{ site?.name || '現場' }}</h1>
          <span v-if="site?.name_kana" class="kana">{{ site.name_kana }}</span>
        </div>
        <div class="head-actions" v-if="site">
          <button class="btn-ghost" @click="router.push(`/chats/${site.id}`)">チャットを開く</button>
          <button class="btn-ghost" @click="toggleActive">{{ site.active ? '無効化' : '有効化' }}</button>
          <button class="btn-ghost" @click="router.push(`/site-rules?site_id=${site.id}`)">ルール・QR設定</button>
        </div>
      </div>
      <!-- タブ -->
      <nav v-if="site" class="tabs">
        <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">
          {{ t.label }}<span v-if="t.count != null" class="tab-count">{{ t.count }}</span>
        </button>
      </nav>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!site" class="empty">現場が見つかりません</div>
    <template v-else>
      <!-- ───────── 概要 ───────── -->
      <template v-if="tab === 'overview'">
        <div class="summary-cards">
          <div class="sum-card"><div class="sum-label">日報（90日）</div><div class="sum-val">{{ stats.count }}</div></div>
          <div class="sum-card"><div class="sum-label">直近日報</div><div class="sum-val sm">{{ stats.lastDate || '—' }}</div></div>
          <div class="sum-card"><div class="sum-label">紐づく下請け</div><div class="sum-val">{{ linkedSubs.length }}</div></div>
          <div class="sum-card"><div class="sum-label">見積/注文書</div><div class="sum-val sm">{{ estimates.length }} / {{ orders.length }}</div></div>
        </div>

        <section class="card">
          <div class="card-head">
            <h2 class="card-title">基本情報</h2>
            <button v-if="!editing" class="btn-ghost sm" @click="startEdit">編集する</button>
            <div v-else class="edit-actions">
              <button class="btn-ghost sm" @click="cancelEdit">キャンセル</button>
              <button class="btn-primary sm" :disabled="saving" @click="saveBasic">{{ saving ? '保存中…' : '保存' }}</button>
            </div>
          </div>
          <!-- 閲覧 -->
          <dl v-if="!editing" class="kv">
            <div class="kv-row"><dt>現場名</dt><dd>{{ site.name }}</dd></div>
            <div class="kv-row"><dt>読み仮名</dt><dd>{{ site.name_kana || '—' }}</dd></div>
            <div class="kv-row"><dt>元請け</dt><dd>{{ contractorName || '—' }}</dd></div>
            <div class="kv-row"><dt>住所</dt><dd>
              <template v-if="site.location">{{ site.location }} <a :href="mapUrl" target="_blank" rel="noopener" class="map-link"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">map</span> 地図で開く</a></template>
              <template v-else>—</template>
            </dd></div>
            <div class="kv-row"><dt>工種</dt><dd>{{ site.construction_type || '—' }}</dd></div>
            <div class="kv-row"><dt>工事内容</dt><dd class="pre">{{ site.construction_details || '—' }}</dd></div>
            <div class="kv-row"><dt>メモ</dt><dd class="pre">{{ site.memo || '—' }}</dd></div>
          </dl>
          <!-- 編集 -->
          <div v-else class="edit-form">
            <label class="fld"><span>現場名</span><input v-model="form.name" class="input" /></label>
            <label class="fld"><span>読み仮名</span><input v-model="form.name_kana" class="input" /></label>
            <label class="fld"><span>住所</span><input v-model="form.location" class="input" placeholder="例：名古屋市〇〇区…" /></label>
            <label class="fld"><span>元請け</span>
              <select v-model="form.contractor_id" class="input">
                <option :value="null">（未設定）</option>
                <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label class="fld"><span>工種</span><input v-model="form.construction_type" class="input" placeholder="例：内装・改修" /></label>
            <label class="fld"><span>工事内容</span><textarea v-model="form.construction_details" class="input" rows="2" /></label>
            <div class="fld"><span>固定勤務時刻</span>
              <div style="display:flex;align-items:center;gap:8px">
                <input v-model="form.default_start_time" type="time" class="input" style="width:auto" @focus="form.default_start_time || (form.default_start_time = '08:30')" />
                <span>〜</span>
                <input v-model="form.default_end_time" type="time" class="input" style="width:auto" @focus="form.default_end_time || (form.default_end_time = '17:30')" />
              </div>
            </div>
            <p class="hint" style="font-size:12px;color:#94a3b8;margin:-4px 0 0">日報入力時の作業時刻の既定。終了時刻はこの値を超えて入力できません（残業申請が無い限り）。未設定なら従来どおり。</p>
            <label class="fld"><span>メモ</span><textarea v-model="form.memo" class="input" rows="2" /></label>
            <div class="fld"><span>紐づく協力業者</span>
              <div class="sub-pick">
                <label v-for="s in allSubs" :key="s.id" class="sub-chip" :class="{ on: form.linkedSubs.includes(s.id) }">
                  <input type="checkbox" :value="s.id" v-model="form.linkedSubs" />{{ s.name }}
                </label>
              </div>
            </div>
            <p v-if="saveError" class="err">{{ saveError }}</p>
          </div>
        </section>

        <section v-if="!editing" class="card">
          <h2 class="card-title">紐づく協力業者（{{ linkedSubs.length }}）</h2>
          <div v-if="linkedSubs.length" class="chips">
            <span v-for="s in linkedSubs" :key="s.id" class="chip">{{ s.name }}<span v-if="s.category" class="chip-cat">{{ s.category }}</span></span>
          </div>
          <p v-else class="muted">紐づく協力業者はありません（編集から追加）</p>
        </section>
      </template>

      <!-- ───────── 日報 ───────── -->
      <section v-else-if="tab === 'reports'" class="card">
        <div class="card-head"><h2 class="card-title">関連日報（直近{{ reports.length }}件）</h2>
          <button class="btn-ghost sm" @click="router.push('/reports')">日報一覧へ</button></div>
        <table v-if="reports.length" class="mini-table">
          <thead><tr><th>日付</th><th>作業員</th></tr></thead>
          <tbody><tr v-for="(r, i) in reports" :key="i"><td>{{ r.date }}</td><td>{{ r.workers || '—' }}</td></tr></tbody>
        </table>
        <p v-else class="muted">関連する日報はありません（直近180日）</p>
      </section>

      <!-- ───────── 見積・注文 ───────── -->
      <template v-else-if="tab === 'docs'">
        <section class="card">
          <div class="card-head"><h2 class="card-title">見積書（{{ estimates.length }}）</h2>
            <button class="btn-ghost sm" @click="router.push('/estimates')">見積管理へ</button></div>
          <table v-if="estimates.length" class="mini-table">
            <thead><tr><th>見積番号</th><th>日付</th><th class="num">金額</th><th>PDF</th></tr></thead>
            <tbody><tr v-for="e in estimates" :key="e.id">
              <td>{{ e.estimate_number || '—' }}</td><td>{{ e.estimate_date || '—' }}</td>
              <td class="num">{{ e.total_amount != null ? `¥${e.total_amount.toLocaleString()}` : '—' }}</td>
              <td><a v-if="e.pdf_path" :href="estPdfUrl(e.pdf_path)" target="_blank" rel="noopener" class="pdf-link"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span></a><span v-else class="muted">—</span></td>
            </tr></tbody>
          </table>
          <p v-else class="muted">見積書はありません</p>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="card-title">注文書（{{ orders.length }}）</h2>
            <button class="btn-ghost sm" @click="router.push('/purchase-orders')">注文書へ</button></div>
          <table v-if="orders.length" class="mini-table">
            <thead><tr><th>注文書番号</th><th>受注者</th><th class="num">金額</th><th>状態</th></tr></thead>
            <tbody><tr v-for="o in orders" :key="o.id">
              <td>{{ o.order_number }}</td><td>{{ o.vendor_name || '—' }}</td>
              <td class="num">{{ o.total_amount != null ? `¥${o.total_amount.toLocaleString()}` : '—' }}</td>
              <td><span class="status sm" :class="o.status === 'accepted' ? 'active' : 'off'">{{ o.status === 'accepted' ? '承諾済' : '未承諾' }}</span></td>
            </tr></tbody>
          </table>
          <p v-else class="muted">注文書はありません</p>
        </section>
      </template>

      <!-- ───────── 写真・資料 ───────── -->
      <section v-else-if="tab === 'files'" class="card">
        <div class="card-head"><h2 class="card-title">写真・資料（{{ attachments.length }}）</h2>
          <div class="upload-actions att-dropzone" :class="{ dragover: attDragOver, busy: uploading }"
               @drop.prevent="onDropAtt" @dragover.prevent="attDragOver = true" @dragleave.prevent="attDragOver = false">
            <label class="btn-ghost sm"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">photo_camera</span> 写真追加<input type="file" accept="image/*" multiple hidden @change="(e) => onAttach(e, 'photo')" /></label>
            <label class="btn-ghost sm"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> 書類追加<input type="file" accept="image/*,.pdf" multiple hidden @change="(e) => onAttach(e, 'document')" /></label>
            <span class="att-drop-hint">{{ attDragOver ? 'ここにドロップ' : 'ドラッグ&ドロップも可' }}</span>
          </div>
        </div>
        <p v-if="uploading" class="muted">アップロード中…</p>
        <div v-if="attachments.length" class="att-grid">
          <div v-for="a in attachments" :key="a.id" class="att-item">
            <a :href="a.url || '#'" target="_blank" rel="noopener" class="att-thumb">
              <img v-if="a.kind === 'photo' && a.url" :src="a.url" :alt="a.name || ''" />
              <span v-else class="att-ico"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span></span>
            </a>
            <div class="att-name">{{ a.name || a.kind }}</div>
            <button class="att-del" @click="removeAttachment(a)">削除</button>
          </div>
        </div>
        <p v-else class="muted">写真・資料はありません（上のボタンから追加）</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { normalizeSiteName } from '../lib/siteSimilarity'
import { siteStoredName } from '../lib/siteKey'

const route = useRoute()
const router = useRouter()
const siteId = String(route.params.id ?? '')

type Site = { id: string; name: string; name_kana: string | null; active: boolean; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null; contractor_id: string | null; default_start_time: string | null; default_end_time: string | null }
type Att = { id: string; kind: string; path: string; name: string | null; require_consent?: boolean; url?: string | null }

const BUCKET = 'site-attachments'
const ESTIMATE_BUCKET = 'expense-receipts'

const site = ref<Site | null>(null)
const contractorName = ref('')
const contractors = ref<{ id: string; name: string }[]>([])
const allSubs = ref<{ id: string; name: string }[]>([])
const linkedSubs = ref<{ id: string; name: string; category: string | null }[]>([])
const estimates = ref<any[]>([])
const orders = ref<any[]>([])
const reports = ref<{ date: string; workers: string }[]>([])
const attachments = ref<Att[]>([])
const stats = ref<{ count: number; lastDate: string }>({ count: 0, lastDate: '' })
const loading = ref(true)
const uploading = ref(false)

const tab = ref<'overview' | 'reports' | 'docs' | 'files'>('overview')
const TABS = computed(() => [
  { key: 'overview', label: '概要', count: null as number | null },
  { key: 'reports',  label: '日報', count: stats.value.count },
  { key: 'docs',     label: '見積・注文', count: estimates.value.length + orders.value.length },
  { key: 'files',    label: '写真・資料', count: attachments.value.length },
])

// 編集（基本情報 inline）
const editing = ref(false)
const saving = ref(false)
const saveError = ref('')
const form = ref<{ name: string; name_kana: string; contractor_id: string | null; location: string; construction_type: string; construction_details: string; memo: string; default_start_time: string; default_end_time: string; linkedSubs: string[] }>(
  { name: '', name_kana: '', contractor_id: null, location: '', construction_type: '', construction_details: '', memo: '', default_start_time: '', default_end_time: '', linkedSubs: [] })

function estPdfUrl(path: string) { return supabase.storage.from(ESTIMATE_BUCKET).getPublicUrl(path).data.publicUrl }
const mapUrl = computed(() => site.value?.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.value.location)}` : '#')

async function signedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('site-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) return null
    return data.url as string
  } catch { return null }
}

function startEdit() {
  if (!site.value) return
  form.value = {
    name: site.value.name, name_kana: site.value.name_kana ?? '', contractor_id: site.value.contractor_id,
    location: site.value.location ?? '', construction_type: site.value.construction_type ?? '',
    construction_details: site.value.construction_details ?? '', memo: site.value.memo ?? '',
    default_start_time: (site.value.default_start_time ?? '').slice(0, 5), default_end_time: (site.value.default_end_time ?? '').slice(0, 5),
    linkedSubs: linkedSubs.value.map(s => s.id),
  }
  saveError.value = ''; editing.value = true
}
function cancelEdit() { editing.value = false; saveError.value = '' }

async function saveBasic() {
  if (!site.value) return
  if (!form.value.name.trim()) { saveError.value = '現場名を入力してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    await supabase.from('sites').update({
      name: form.value.name.trim(), name_kana: form.value.name_kana.trim() || null,
      contractor_id: form.value.contractor_id || null, location: form.value.location.trim() || null,
      construction_type: form.value.construction_type.trim() || null,
      construction_details: form.value.construction_details.trim() || null, memo: form.value.memo.trim() || null,
      default_start_time: form.value.default_start_time || null, default_end_time: form.value.default_end_time || null,
    }).eq('id', site.value.id)
    // 紐づく協力業者の差分同期
    const { data: cur } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', site.value.id)
    const have = ((cur ?? []) as any[]).map(l => l.subcontractor_id)
    const want = form.value.linkedSubs
    const toAdd = want.filter(id => !have.includes(id))
    const toDel = have.filter(id => !want.includes(id))
    if (toAdd.length) await supabase.from('site_subcontractors').insert(toAdd.map(id => ({ site_id: site.value!.id, subcontractor_id: id, account_id: accountId })))
    if (toDel.length) await supabase.from('site_subcontractors').delete().eq('site_id', site.value.id).in('subcontractor_id', toDel)
    editing.value = false
    await load()
  } catch (e: any) { saveError.value = e.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}

async function toggleActive() {
  if (!site.value) return
  await supabase.from('sites').update({ active: !site.value.active }).eq('id', site.value.id)
  await load()
}

async function processAttach(file: File | undefined | null, kind: 'photo' | 'document') {
  if (!file || !site.value) return
  uploading.value = true
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${accountId}/${site.value.id}/${kind}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    await supabase.from('site_attachments').insert({ account_id: accountId, site_id: site.value.id, kind, path, name: file.name })
    await loadAttachments()
  } catch (e: any) { alert(e.message ?? 'アップロードに失敗しました') }
  finally { uploading.value = false }
}
async function onAttach(ev: Event, kind: 'photo' | 'document') {
  const input = ev.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) await processAttach(f, kind)
  input.value = ''
}
// D&D: 画像→写真、PDF→書類として振り分けて受け取る
const attDragOver = ref(false)
async function onDropAtt(ev: DragEvent) {
  attDragOver.value = false
  for (const f of Array.from(ev.dataTransfer?.files ?? [])) {
    await processAttach(f, f.type === 'application/pdf' ? 'document' : 'photo')
  }
}
async function removeAttachment(a: Att) {
  if (!confirm(`「${a.name || a.kind}」を削除しますか？`)) return
  await supabase.storage.from(BUCKET).remove([a.path]).then(() => {}, () => {})
  await supabase.from('site_attachments').delete().eq('id', a.id)
  await loadAttachments()
}
async function loadAttachments() {
  const { data } = await supabase.from('site_attachments').select('id, kind, path, name, require_consent').eq('site_id', siteId).order('created_at')
  const atts = (data ?? []) as Att[]
  await Promise.all(atts.map(async (a) => { a.url = await signedUrl(a.id) }))
  attachments.value = atts
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data: s } = await supabase.from('sites')
    .select('id, name, name_kana, active, location, construction_type, construction_details, memo, contractor_id, default_start_time, default_end_time')
    .eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (s as Site) ?? null
  if (!site.value) { loading.value = false; return }

  const { data: cons } = await supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  contractors.value = (cons ?? []) as any[]
  contractorName.value = contractors.value.find(c => c.id === site.value!.contractor_id)?.name ?? ''
  const { data: subsAll } = await supabase.from('subcontractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  allSubs.value = (subsAll ?? []) as any[]

  const { data: links } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', siteId)
  const subIds = ((links ?? []) as any[]).map(l => l.subcontractor_id)
  linkedSubs.value = subIds.length ? (allSubs.value.filter(s => subIds.includes(s.id)).map(s => ({ ...s, category: null }))) : []
  if (subIds.length) {
    const { data: subs } = await supabase.from('subcontractors').select('id, name, category').in('id', subIds)
    linkedSubs.value = (subs ?? []) as any[]
  }

  const [{ data: est }, { data: po }] = await Promise.all([
    supabase.from('estimates').select('id, estimate_number, estimate_date, total_amount, pdf_path').eq('site_id', siteId).eq('is_deleted', false).order('estimate_date', { ascending: false, nullsFirst: false }),
    supabase.from('purchase_orders').select('id, order_number, vendor_name, total_amount, status').eq('site_id', siteId).eq('is_deleted', false).order('order_number', { ascending: false }),
  ])
  estimates.value = (est ?? []) as any[]
  orders.value = (po ?? []) as any[]
  await loadAttachments()

  const since = new Date(); since.setDate(since.getDate() - 180)
  const { data: reps } = await supabase.from('daily_reports')
    .select('date, sites').eq('account_id', accountId).gte('date', since.toISOString().split('T')[0]).order('date', { ascending: false })
    .limit(30000) // 180日×全作業員で上限(既定1000)超による現場別件数/直近日報日の集計漏れ防止（reports.vue等の1ヶ月5000の6倍相当）
  const rows: { date: string; workers: string }[] = []
  let count = 0, lastDate = ''
  for (const r of (reps ?? []) as any[]) {
    for (const st of (r.sites ?? [])) {
      // site_id があればそれで厳密一致（マージ後もこの現場に正しく残る）。
      // 無い旧データは正規化名一致で拾う（全角スペース等の表記ゆれでも当現場の履歴を漏らさない）。
      const belongs = st?.site_id
        ? st.site_id === siteId
        : normalizeSiteName(siteStoredName(st)) === normalizeSiteName(site.value.name)
      if (!belongs) continue
      count++
      if (r.date > lastDate) lastDate = r.date
      const ws = (st.workers ?? []).map((w: any) => w.workerName).filter(Boolean)
      if (rows.length < 30) rows.push({ date: r.date, workers: [...new Set(ws)].join('・') })
    }
  }
  reports.value = rows
  stats.value = { count, lastDate }
  loading.value = false
}
onMounted(load)
</script>

<style scoped>
.detail-head { margin-bottom: 16px; }
.btn-back { background: none; border: none; color: #06A050; font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 8px; }
.head-main { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.head-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.page-title { font-size: 22px; font-weight: 700; }
.head-title .kana { color: #aaa; font-size: 13px; }
.head-actions { display: flex; gap: 8px; }
.btn-ghost { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #333; display: inline-flex; align-items: center; gap: 4px; }
.btn-ghost.sm { padding: 5px 10px; font-size: 12px; }
.btn-primary { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-primary.sm { padding: 5px 12px; font-size: 12px; }
.btn-primary:disabled { opacity: .5; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.sm { font-size: 10px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.empty { color: #888; padding: 40px; text-align: center; }

/* タブ */
.tabs { display: flex; gap: 4px; border-bottom: 2px solid #eceff1; margin-top: 16px; overflow-x: auto; }
.tab { background: none; border: none; padding: 10px 16px; font-size: 14px; font-weight: 700; color: #888; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; white-space: nowrap; }
.tab.active { color: #06A050; border-bottom-color: #06A050; }
.tab-count { display: inline-block; margin-left: 6px; background: #eef2f4; color: #777; border-radius: 10px; padding: 0 7px; font-size: 11px; }
.tab.active .tab-count { background: #e8fff0; color: #0a8a3a; }

.summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
.sum-card { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.sum-label { font-size: 11px; color: #888; }
.sum-val { font-size: 22px; font-weight: 800; color: #222; }
.sum-val.sm { font-size: 14px; }

.card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
.card-title { font-size: 14px; font-weight: 800; color: #333; margin: 0; }
.edit-actions, .upload-actions { display: flex; gap: 8px; }
.att-dropzone { align-items: center; flex-wrap: wrap; border: 2px dashed transparent; border-radius: 10px; padding: 6px 10px; transition: border-color .15s, background .15s; }
.att-dropzone.dragover { border-color: #2563eb; background: #eff6ff; }
.att-dropzone.busy { opacity: .7; }
.att-drop-hint { font-size: 11px; color: #9ca3af; }
.kv { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.kv-row { display: flex; gap: 12px; font-size: 14px; }
.kv-row dt { color: #888; flex: 0 0 90px; }
.kv-row dd { margin: 0; color: #222; flex: 1; }
.kv-row dd.pre { white-space: pre-wrap; }
.map-link { margin-left: 10px; font-size: 12px; color: #1a56c4; text-decoration: none; }
.muted { color: #aaa; font-size: 13px; }
.err { color: #E53935; font-size: 13px; margin: 8px 0 0; }

.edit-form { display: flex; flex-direction: column; gap: 12px; }
.fld { display: flex; flex-direction: column; gap: 4px; }
.fld > span { font-size: 12px; font-weight: 700; color: #888; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 14px; width: 100%; box-sizing: border-box; font-family: inherit; }
.sub-pick { display: flex; flex-wrap: wrap; gap: 6px; }
.sub-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #e0e0e0; border-radius: 16px; padding: 4px 12px; font-size: 13px; cursor: pointer; }
.sub-chip.on { background: #e8fff0; border-color: #9adcb6; color: #0a8a3a; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: #eef2ff; color: #3a52a8; border-radius: 6px; padding: 4px 10px; font-size: 13px; }
.chip-cat { color: #888; font-size: 11px; margin-left: 6px; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini-table th { text-align: left; color: #888; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #eee; }
.mini-table td { padding: 6px 8px; border-bottom: 1px solid #f3f3f3; }
.mini-table .num { text-align: right; }
.pdf-link { text-decoration: none; }

.att-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.att-item { border: 1px solid #eceff1; border-radius: 8px; padding: 8px; text-align: center; }
.att-thumb { display: block; height: 90px; border-radius: 6px; overflow: hidden; background: #f5f7fa; display: flex; align-items: center; justify-content: center; }
.att-thumb img { width: 100%; height: 100%; object-fit: cover; }
.att-ico { font-size: 32px; }
.att-name { font-size: 11px; color: #555; margin: 6px 0 4px; word-break: break-all; }
.att-del { background: none; border: none; color: #E53935; font-size: 11px; cursor: pointer; }
@media (max-width: 640px) { .summary-cards { grid-template-columns: repeat(2, 1fr); } }
</style>
