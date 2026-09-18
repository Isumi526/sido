<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">道具管理</h1>
      </div>
      <div class="header-btns">
        <button class="btn-ghost" data-testid="location-add-open" :disabled="!bases.length" @click="openLocation()">＋ 保管場所</button>
        <button class="btn-add" data-testid="tool-add-open" @click="openTool()">＋ 道具を登録</button>
      </div>
    </div>
    <p class="page-note">
      レーザー・脚立など共有する道具を登録すると、道具1個ごとにQRコードが発行されます。印刷して道具に貼ってください。
      保管場所（拠点＞倉庫）にもQRを発行し、返却時に場所QR→道具QRの順で読みます（持出・返却は作業員アプリ側で次の段階）。
      拠点（オフィス・工場）は<router-link to="/company-profile">自社情報</router-link>の「拠点」と同じものです（経費申請の紐付け先・作業員の所属拠点と共通）。
    </p>

    <!-- 保管場所（拠点ごとにまとめた表・2026-09-19 レビュー指摘でチップ並びから変更） -->
    <section class="block">
      <div class="block-head">
        <h2 class="block-title">保管場所（拠点＞場所）</h2>
        <div class="head-right">
          <button class="btn-ghost sm" data-testid="base-site-add" @click="openBase()">＋ 拠点を登録</button>
          <button class="btn-ghost sm" :disabled="!locations.length || generating" data-testid="location-qr-pdf" @click="downloadLocationQr">場所QRを印刷（PDF）</button>
        </div>
      </div>
      <div v-if="!bases.length" class="empty small" data-testid="tool-no-bases">
        拠点がまだありません。「＋ 拠点を登録」でオフィス・工場を登録してください（<router-link to="/company-profile">自社情報</router-link>の「拠点」と同じものです）。
      </div>
      <div v-else class="base-grid">
        <div v-for="g in locationGroups" :key="g.id" class="base-card" :data-testid="`base-card-${g.id}`">
          <div class="base-head">
            <span class="base-name"><span class="material-symbols-rounded base-icon">{{ g.kind === 'factory' ? 'factory' : 'apartment' }}</span>{{ g.name }}</span>
            <span class="base-kind">{{ g.kind === 'factory' ? '工場' : 'オフィス' }}</span>
            <button v-if="g.id !== OTHER" class="chip-btn add" :data-testid="`location-add-${g.id}`" @click="openLocation(undefined, g.id)">＋ 場所を追加</button>
          </div>
          <table class="loc-table">
            <tbody>
              <tr v-for="l in g.locations" :key="l.id" :class="{ inactive: !l.active }" :data-testid="`location-row-${l.id}`">
                <td class="loc-name">{{ l.name }}</td>
                <td class="sub">{{ toolCountByLocation[l.id] ? `道具 ${toolCountByLocation[l.id]}件` : '—' }}</td>
                <td class="sub">{{ l.active ? '' : '無効' }}</td>
                <td class="actions">
                  <button class="chip-btn" title="編集" @click="openLocation(l)">編集</button>
                  <button class="chip-btn del" title="削除" :data-testid="`location-del-${l.id}`" @click="removeLocation(l)">削除</button>
                </td>
              </tr>
              <tr v-if="!g.locations.length"><td colspan="4" class="loc-empty">場所がありません。「＋ 場所を追加」から登録してください（例：倉庫1・コンテナ）。</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 道具 -->
    <section class="block">
      <div class="block-head">
        <h2 class="block-title">道具 <span class="count">{{ tools.length }}件</span></h2>
        <div class="head-right">
          <label class="chk"><input v-model="showInactive" type="checkbox" @change="load" />無効も表示</label>
          <input v-model="filter" class="input filter" placeholder="名前・種別・番号で絞り込み" data-testid="tool-filter" />
          <button class="btn-ghost sm" :disabled="!selectedIds.length || generating" data-testid="tool-qr-pdf" @click="downloadToolQr()">
            {{ generating ? '作成中...' : `選択した道具のQRを印刷（${selectedIds.length}）` }}
          </button>
        </div>
      </div>
      <div v-if="loading" class="empty">読み込み中...</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" :checked="allSelected" data-testid="tool-select-all" @change="toggleAll" /></th>
              <th>道具名</th>
              <th style="width:120px">種別</th>
              <th style="width:110px">管理番号</th>
              <th style="width:170px">定位置</th>
              <th style="width:110px">状態</th>
              <th style="width:150px">所持者／持出先</th>
              <th style="width:180px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in filtered" :key="t.id" :class="{ inactive: !t.active }" :data-testid="`tool-row-${t.id}`">
              <td><input type="checkbox" :value="t.id" v-model="selectedIds" :data-testid="`tool-select-${t.id}`" /></td>
              <td class="name">{{ t.name }}</td>
              <td>{{ t.kind || '—' }}</td>
              <td>{{ t.code || '—' }}</td>
              <td>{{ t.tool_locations ? `${t.tool_locations.base}＞${t.tool_locations.name}` : '—' }}</td>
              <td><span class="status" :class="t.status">{{ STATUS_LABEL[t.status] ?? t.status }}</span></td>
              <td class="sub">{{ t.workers?.name || t.sites?.name ? `${t.workers?.name ?? ''}${t.sites?.name ? ' / ' + t.sites.name : ''}` : '—' }}</td>
              <td class="actions">
                <button class="btn-edit" :data-testid="`tool-qr-${t.id}`" @click="openQr(t)">QR</button>
                <button class="btn-edit" :disabled="busy" @click="openTool(t)">編集</button>
                <button class="btn-del" :disabled="busy" @click="removeTool(t)">削除</button>
              </td>
            </tr>
            <tr v-if="filtered.length === 0"><td colspan="8" class="empty">道具がありません。「＋ 道具を登録」から登録してください。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 道具 登録/編集 -->
    <div v-if="toolModal" class="modal-overlay" @click.self="toolModal = null">
      <div class="modal">
        <h2>{{ toolModal.id ? '道具を編集' : '道具を登録' }}</h2>
        <div class="field">
          <label>道具名 <span class="req">必須</span></label>
          <input v-model="toolModal.name" class="input" data-testid="tool-name" placeholder="例：レーザー墨出し器 A" />
        </div>
        <div class="row2">
          <div class="field">
            <label>種別</label>
            <input v-model="toolModal.kind" class="input" data-testid="tool-kind" placeholder="例：レーザー・脚立" list="tool-kinds" />
            <datalist id="tool-kinds"><option v-for="k in kindOptions" :key="k" :value="k" /></datalist>
          </div>
          <div class="field">
            <label>管理番号</label>
            <input v-model="toolModal.code" class="input" data-testid="tool-code" placeholder="例：L-001" />
          </div>
        </div>
        <div class="field">
          <label>定位置（返す場所）</label>
          <select v-model="toolModal.location_id" class="input" data-testid="tool-location">
            <option :value="null">—</option>
            <option v-for="l in locations.filter(x => x.active)" :key="l.id" :value="l.id">{{ l.base }}＞{{ l.name }}</option>
          </select>
        </div>
        <div class="row2">
          <div class="field">
            <label>状態</label>
            <select v-model="toolModal.status" class="input" data-testid="tool-status">
              <option v-for="(lb, k) in STATUS_LABEL" :key="k" :value="k">{{ lb }}</option>
            </select>
          </div>
          <div class="field">
            <label>有効</label>
            <div class="toggle">
              <button :class="{ active: toolModal.active !== false }" @click="toolModal.active = true">有効</button>
              <button :class="{ active: toolModal.active === false }" @click="toolModal.active = false">無効</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>メモ</label>
          <input v-model="toolModal.note" class="input" data-testid="tool-note" placeholder="例：バッテリー2個付属" />
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" data-testid="tool-save" @click="saveTool">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="toolModal = null">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 保管場所 登録/編集 -->
    <div v-if="locModal" class="modal-overlay" @click.self="locModal = null">
      <div class="modal">
        <h2>{{ locModal.id ? '保管場所を編集' : '保管場所を登録' }}</h2>
        <div class="row2">
          <div class="field">
            <label>拠点 <span class="req">必須</span></label>
            <select v-model="locModal.base_site_id" class="input" data-testid="location-base">
              <option value="" disabled>選択してください</option>
              <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <p class="hint">候補は自社情報の「拠点」（オフィス・工場）です。<a href="#" @click.prevent="openBase()">その場で登録</a></p>
          </div>
          <div class="field">
            <label>場所 <span class="req">必須</span></label>
            <input v-model="locModal.name" class="input" data-testid="location-name" placeholder="例：倉庫1・コンテナ" />
          </div>
        </div>
        <div v-if="locModal.id" class="field">
          <label>有効</label>
          <div class="toggle">
            <button :class="{ active: locModal.active !== false }" @click="locModal.active = true">有効</button>
            <button :class="{ active: locModal.active === false }" @click="locModal.active = false">無効</button>
          </div>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" data-testid="location-save" @click="saveLocation">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="locModal = null">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- QR 1件 -->
    <div v-if="qrTool" class="modal-overlay" @click.self="qrTool = null">
      <div class="modal qr-modal" data-testid="tool-qr-modal">
        <h2>{{ qrTool.name }}</h2>
        <canvas ref="qrCanvas" class="qr-canvas" />
        <a class="qr-url" :href="toolQrUrl(qrTool.id)" target="_blank" rel="noopener">{{ toolQrUrl(qrTool.id) }}</a>
        <p class="hint">スマホで読むと作業員アプリの道具ページが開きます。印刷はラベルPDF（一覧でチェック→「選択した道具のQRを印刷」）をお使いください。</p>
        <div class="modal-actions">
          <button class="btn-save" @click="downloadToolQr([qrTool!])">この1枚をPDF</button>
          <button class="btn-cancel" @click="qrTool = null">閉じる</button>
        </div>
      </div>
    </div>


    <!-- 拠点（オフィス・工場）をこの画面から登録（画面を跨がない・2026-09-19 レビュー指摘） -->
    <BaseSiteModal v-if="baseModal" :site="null" @close="baseModal = false" @saved="onBaseSaved" />
  </div>
</template>

<script setup lang="ts">
/**
 * 道具管理①（2026-09-10 SEED 会議・2026-09-12 決定）
 *  道具マスタ・保管場所マスタ（拠点＞場所）・QR発行・面付け印刷。
 *  Notion: https://app.notion.com/p/3d90ff81c56b818fb7f5c118979b97e0
 * ★拠点＝現場マスタの office/factory 行（2026-09-18 レビュー指摘）。自由入力にしない＝経費・所属拠点と同じ「拠点」。
 * ★CSV取込は 2026-09-18 に外した（要望に無かった）。復活は commit dfc3c4a を参照。
 *
 * ★書き込みは EF(tools) 経由。tools/tool_locations は RLS 有効で authenticated の
 *  INSERT/UPDATE/DELETE を剥がしてあるため、テーブル直叩きは通らない。
 *  権限（オーナー/管理者/役員経理/現場管理者）は EF 側で確認する（assets.vue と同型）。
 * ★持出・返却・又貸しは道具②（作業員アプリ）。ここは「登録して貼る」まで。
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { toolQrUrl, toolLocationQrUrl, downloadQrLabelPdf, type QrLabel } from '../lib/toolQr'
import BaseSiteModal from '../components/BaseSiteModal.vue'

type Base = { id: string; name: string; kind: 'office' | 'factory' }
/** base は EF が拠点サイト名を平らにしたもの（表示用）。保存は base_site_id */
type Location = { id: string; base: string; base_site_id: string; name: string; sort_order: number; active: boolean }
type Tool = {
  id: string; name: string; kind: string | null; code: string | null; location_id: string | null
  status: string; note: string | null; active: boolean; photo_url: string | null
  tool_locations?: { base: string; name: string } | null
  workers?: { name: string } | null
  sites?: { name: string } | null
}

const STATUS_LABEL: Record<string, string> = { available: '保管中', out: '持出中', lost: '行方不明', broken: '故障・修理中', retired: '廃棄' }
const ERRORS: Record<string, string> = {
  TOOL_FORBIDDEN: '道具を変更する権限がありません。',
  DUPLICATE_NAME: '同じ拠点に同じ名前の保管場所が既にあります。',
  DUPLICATE_TOOL: '同じ名前＋管理番号の道具が既にあります。別の道具なら管理番号を付けて区別してください。',
  LOCATION_IN_USE: 'この保管場所を定位置にしている道具があるため削除できません（先に道具の定位置を変えてください）。',
  location_not_found: '定位置の保管場所が見つかりません。',
  not_found: '対象が見つかりません（削除された可能性があります）。',
  name_required: '名前を入力してください。',
  base_and_name_required: '拠点と場所を入力してください。',
  base_not_found: '拠点が見つかりません（現場マスタで区分がオフィス/工場の現場を選んでください）。',
}

const tools = ref<Tool[]>([])
const locations = ref<Location[]>([])
const bases = ref<Base[]>([])
const baseModal = ref(false)
/** 拠点が無効化された/消えた保管場所の受け皿 */
const OTHER = '__other__'
const loading = ref(true)
const busy = ref(false)
const saving = ref(false)
const generating = ref(false)
const saveError = ref('')
const showInactive = ref(false)
const filter = ref('')
const selectedIds = ref<string[]>([])
const toolModal = ref<Partial<Tool> | null>(null)
const locModal = ref<Partial<Location> | null>(null)
const qrTool = ref<Tool | null>(null)
const qrCanvas = ref<HTMLCanvasElement | null>(null)


const kindOptions = computed(() => [...new Set(tools.value.map(t => t.kind).filter(Boolean) as string[])])
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return tools.value
  return tools.value.filter(t => [t.name, t.kind, t.code, t.tool_locations?.base, t.tool_locations?.name].some(v => (v ?? '').toLowerCase().includes(q)))
})
/** 拠点ごとにまとめた保管場所（拠点は自社情報の順・場所は EF の並び） */
const locationGroups = computed(() => {
  const groups = bases.value.map(b => ({ id: b.id, name: b.name, kind: b.kind as string, locations: locations.value.filter(l => l.base_site_id === b.id) }))
  const known = new Set(bases.value.map(b => b.id))
  const rest = locations.value.filter(l => !known.has(l.base_site_id))
  if (rest.length) groups.push({ id: OTHER, name: '拠点が無効・不明', kind: 'other', locations: rest })
  return groups
})
const toolCountByLocation = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {}
  for (const t of tools.value) if (t.location_id && t.active) m[t.location_id] = (m[t.location_id] ?? 0) + 1
  return m
})
const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every(t => selectedIds.value.includes(t.id)))
function toggleAll() {
  selectedIds.value = allSelected.value ? [] : filtered.value.map(t => t.id)
}

async function callEf(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  const { data, error } = await supabase.functions.invoke('tools', { body: payload })
  if (error) {
    // ★4xx/5xx は FunctionsHttpError になり data が来ない。本文のエラーコード（DUPLICATE_NAME 等）を拾う
    const ctx = (error as any)?.context
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); return { ok: false, error: j?.error ?? 'failed', data: j } } catch { /* 本文なし */ }
    }
    return { ok: false, error: 'network' }
  }
  return data?.ok ? { ok: true, data } : { ok: false, error: data?.error ?? 'failed', data }
}
const errMsg = (code?: string, fallback = '失敗しました') => ERRORS[code ?? ''] ?? `${fallback}（${code}）`

async function load() {
  loading.value = true
  const [t, l, b] = await Promise.all([callEf({ action: 'tools', includeInactive: showInactive.value }), callEf({ action: 'locations' }), callEf({ action: 'bases' })])
  tools.value = (t.data?.tools ?? []) as Tool[]
  locations.value = (l.data?.locations ?? []) as Location[]
  bases.value = (b.data?.bases ?? []) as Base[]
  selectedIds.value = selectedIds.value.filter(id => tools.value.some(x => x.id === id))
  loading.value = false
}

// ── 道具 ──
function openTool(t?: Tool) {
  saveError.value = ''
  toolModal.value = t ? { ...t } : { name: '', kind: '', code: '', location_id: null, status: 'available', note: '', active: true }
}
async function saveTool() {
  if (!toolModal.value) return
  const m = toolModal.value
  const name = (m.name ?? '').trim()
  if (!name) { saveError.value = '道具名を入力してください。'; return }
  saving.value = true; saveError.value = ''
  const r = await callEf({
    action: 'tool-save', ...(m.id ? { id: m.id } : {}),
    name, kind: m.kind ?? '', code: m.code ?? '', locationId: m.location_id ?? null,
    status: m.status ?? 'available', note: m.note ?? '', active: m.active !== false,
  })
  saving.value = false
  if (!r.ok) { saveError.value = errMsg(r.error, '保存に失敗しました'); return }
  toolModal.value = null
  await load()
}
async function removeTool(t: Tool) {
  if (!confirm(`「${t.name}」を削除しますか？\n印刷済みのQRコードは使えなくなります（履歴も消えます）。使わなくなった道具は「無効」にするのがおすすめです。`)) return
  busy.value = true
  const r = await callEf({ action: 'tool-delete', id: t.id })
  busy.value = false
  if (!r.ok) { alert(errMsg(r.error, '削除に失敗しました')); return }
  await load()
}

// ── 保管場所 ──
function openLocation(l?: Location, baseSiteId?: string) {
  saveError.value = ''
  locModal.value = l ? { ...l } : { base_site_id: baseSiteId ?? (bases.value.length === 1 ? bases.value[0].id : ''), name: '', active: true }
}
// ── 拠点（オフィス・工場）をその場で登録 ──
function openBase() { baseModal.value = true }
async function onBaseSaved(id: string) {
  baseModal.value = false
  await load()
  // 保管場所の登録モーダルを開いていたら、その拠点を選んだ状態にする
  if (locModal.value && !locModal.value.id) locModal.value.base_site_id = id
}
async function saveLocation() {
  if (!locModal.value) return
  const m = locModal.value
  const baseSiteId = m.base_site_id ?? '', name = (m.name ?? '').trim()
  if (!baseSiteId || !name) { saveError.value = '拠点と場所を入力してください。'; return }
  saving.value = true; saveError.value = ''
  const r = await callEf({ action: 'location-save', ...(m.id ? { id: m.id } : {}), baseSiteId, name, active: m.active !== false })
  saving.value = false
  if (!r.ok) { saveError.value = errMsg(r.error, '保存に失敗しました'); return }
  locModal.value = null
  await load()
}
async function removeLocation(l: Location) {
  if (!confirm(`「${l.base}＞${l.name}」を削除しますか？\n印刷済みの場所QRは使えなくなります。`)) return
  busy.value = true
  const r = await callEf({ action: 'location-delete', id: l.id })
  busy.value = false
  if (!r.ok) { alert(errMsg(r.error, '削除に失敗しました')); return }
  await load()
}

// ── QR ──
async function openQr(t: Tool) {
  qrTool.value = t
  await nextTick()
  if (qrCanvas.value) await QRCode.toCanvas(qrCanvas.value, toolQrUrl(t.id), { width: 240, margin: 2, color: { dark: '#111111', light: '#ffffff' } })
}
function toolLabel(t: Tool): QrLabel {
  const lines: string[] = []
  if (t.kind) lines.push(`種別：${t.kind}`)
  if (t.code) lines.push(`番号：${t.code}`)
  if (t.tool_locations) lines.push(`定位置：${t.tool_locations.base}＞${t.tool_locations.name}`)
  return { url: toolQrUrl(t.id), title: t.name, lines, tag: '道具' }
}
async function downloadToolQr(list?: Tool[]) {
  const targets = list ?? tools.value.filter(t => selectedIds.value.includes(t.id))
  if (!targets.length || generating.value) return
  generating.value = true
  try { await downloadQrLabelPdf(targets.map(toolLabel), `tool_qr_${new Date().toISOString().slice(0, 10)}.pdf`) }
  finally { generating.value = false }
}
async function downloadLocationQr() {
  const targets = locations.value.filter(l => l.active)
  if (!targets.length || generating.value) return
  generating.value = true
  try {
    // 場所QRは壁に貼る＝大きめ（1×2＝A4に2枚）
    await downloadQrLabelPdf(
      targets.map(l => ({ url: toolLocationQrUrl(l.id), title: `${l.base}＞${l.name}`, lines: ['返却するとき：この場所QR → 道具QR の順で読む'], tag: '保管場所' })),
      `tool_location_qr_${new Date().toISOString().slice(0, 10)}.pdf`, { cols: 1, rows: 2 },
    )
  } finally { generating.value = false }
}


onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 22px; font-weight: 700; }
.page-note { color: #64748b; font-size: 13px; margin: 0 0 20px; line-height: 1.7; }
.header-btns { display: flex; gap: 8px; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-ghost.sm { padding: 6px 12px; font-size: 12px; }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.block { margin-bottom: 24px; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
.block-title { font-size: 15px; font-weight: 700; margin: 0; }
.count { font-size: 12px; color: #888; font-weight: 400; margin-left: 6px; }
.head-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.chk { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; }
.filter { width: 220px; padding: 6px 10px; font-size: 13px; }
.base-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.base-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.base-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.base-name { font-weight: 700; font-size: 14px; display: inline-flex; align-items: center; gap: 4px; flex: 1; }
.base-icon { font-size: 18px; color: #64748b; }
.base-kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; }
.loc-table { width: 100%; border-collapse: collapse; }
.loc-table td { padding: 8px 14px; border-top: 1px solid #f1f5f9; font-size: 13px; vertical-align: middle; }
.loc-table tr:first-child td { border-top: none; }
.loc-table tr.inactive td { opacity: .45; }
.loc-name { font-weight: 600; }
.loc-empty { color: #94a3b8; font-size: 12px; }
.chip-btn { background: #f1f5f9; border: none; border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer; color: #475569; white-space: nowrap; }
.chip-btn.del { color: #c0392b; background: #fff1f0; margin-left: 4px; }
.chip-btn.add { background: #e8fff0; color: #0a8a3a; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); max-height: 65vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 14px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2; }
.table td { padding: 10px 14px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.table tr.inactive td { opacity: .45; }
.name { font-weight: 600; }
.sub { color: #64748b; font-size: 13px; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #f5f5f5; color: #555; white-space: nowrap; }
.status.available { background: #e8fff0; color: #0a8a3a; }
.status.out { background: #fff7ed; color: #c2410c; }
.status.lost { background: #fff1f0; color: #c0392b; }
.status.broken { background: #fef9c3; color: #854d0e; }
.empty { color: #aaa; text-align: center; padding: 32px; }
.empty.small { padding: 12px; text-align: left; font-size: 13px; }
.actions { text-align: right; white-space: nowrap; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-left: 6px; }
.btn-del { background: #fff1f0; color: #c0392b; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-left: 6px; }
.btn-edit:disabled, .btn-del:disabled { opacity: .4; cursor: default; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 28px; width: 440px; max-width: 95vw; display: flex; flex-direction: column; gap: 16px; max-height: 92vh; overflow: auto; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; font-size: 11px; margin-left: 4px; }
.hint { font-size: 12px; color: #94a3b8; margin: 2px 0 0; line-height: 1.6; }
.hint code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; margin: 0; }
.qr-modal { align-items: center; text-align: center; }
.qr-canvas { border: 1px solid #eee; border-radius: 8px; }
.qr-url { font-size: 12px; color: #2563eb; word-break: break-all; }
</style>
