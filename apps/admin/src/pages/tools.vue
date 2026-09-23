<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">道具</h1>
      </div>
      <div class="header-btns">
        <template v-if="tab === 'locations'">
          <button class="btn-ghost" data-testid="base-site-add" @click="openBase()">＋ 拠点を登録</button>
          <button class="btn-add" data-testid="location-add-open" :disabled="!bases.length" @click="openLocation()">＋ 保管場所</button>
        </template>
        <button v-else class="btn-add" data-testid="tool-add-open" @click="openTool()">＋ 道具を登録</button>
      </div>
    </div>
    <p class="page-note">
      レーザー・脚立など共有する道具を登録すると、道具1個ごとにQRコードが発行されます。印刷して道具に貼ってください。
      保管場所（拠点＞倉庫）にもQRを発行し、返却時に場所QR→道具QRの順で読みます（持出・返却は作業員アプリ側で次の段階）。
    </p>

    <!-- タブ（2026-09-19 レビュー指摘: 道具と保管場所を1画面に縦積みすると分かりづらい） -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'tools' }" data-testid="tab-tools" @click="tab = 'tools'">道具 <span class="tab-count">{{ tools.length }}</span></button>
      <button class="tab" :class="{ active: tab === 'locations' }" data-testid="tab-locations" @click="tab = 'locations'">保管場所 <span class="tab-count">{{ locations.length }}</span></button>
    </div>

    <!-- 保管場所: 拠点をグループ見出し行にした1本の表（道具の表と同じ幅・見た目） -->
    <section v-if="tab === 'locations'" class="block">
      <div class="block-head">
        <p class="block-note">拠点（オフィス・工場）＞場所（倉庫1・コンテナ …）の2段。拠点は<router-link to="/company-profile">自社情報</router-link>の「拠点」と同じものです（経費申請の紐付け先・作業員の所属拠点と共通）。場所QRは壁に貼り、返却時に読みます。</p>
        <button class="btn-ghost sm" :disabled="!locations.length || generating" data-testid="location-qr-pdf" @click="downloadLocationQr()">場所QRを印刷（PDF）</button>
      </div>
      <div v-if="!bases.length" class="empty-box" data-testid="tool-no-bases">
        <p>拠点がまだありません。先にオフィス・工場を登録してください。</p>
        <button class="btn-add" @click="openBase()">＋ 拠点を登録</button>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>場所</th>
              <th style="width:160px">定位置にしている道具</th>
              <th style="width:90px">状態</th>
              <th style="width:240px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in locationGroups" :key="g.id">
              <tr class="group" :data-testid="`base-group-${g.id}`">
                <td colspan="3">
                  <span class="material-symbols-rounded base-icon">{{ g.kind === 'factory' ? 'factory' : g.kind === 'other' ? 'help' : 'apartment' }}</span>
                  <span class="base-name">{{ g.name }}</span>
                  <span class="base-kind" :class="g.kind">{{ g.kind === 'factory' ? '工場' : g.kind === 'other' ? '' : 'オフィス' }}</span>
                  <span class="sub">{{ g.locations.length }}か所</span>
                </td>
                <td class="actions">
                  <button v-if="g.id !== OTHER" class="btn-edit add" :data-testid="`location-add-${g.id}`" @click="openLocation(undefined, g.id)">＋ 場所を追加</button>
                </td>
              </tr>
              <tr v-for="l in g.locations" :key="l.id" class="loc" :class="{ inactive: !l.active }" :data-testid="`location-row-${l.id}`">
                <td class="name loc-name">{{ l.name }}</td>
                <td class="sub">{{ toolCountByLocation[l.id] ? `${toolCountByLocation[l.id]}件` : '—' }}</td>
                <td><span class="status" :class="l.active ? 'available' : ''">{{ l.active ? '有効' : '無効' }}</span></td>
                <td class="actions">
                  <button class="btn-edit" :disabled="generating" :data-testid="`location-qr-${l.id}`" title="この場所のQRだけをPDFにする" @click="downloadLocationQr([l])">QR</button>
                  <button class="btn-edit" :disabled="busy" @click="openLocation(l)">編集</button>
                  <button class="btn-del" :disabled="busy" :data-testid="`location-del-${l.id}`" @click="removeLocation(l)">削除</button>
                </td>
              </tr>
              <tr v-if="!g.locations.length" class="loc"><td colspan="4" class="loc-empty">場所がありません。「＋ 場所を追加」から登録してください（例：倉庫1・コンテナ）。</td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 道具 -->
    <section v-else class="block">
      <div class="block-head tools-head">
        <div class="head-right nowrap">
          <label class="chk"><input v-model="showInactive" type="checkbox" @change="load" />無効も表示</label>
          <input v-model="filter" class="input filter" placeholder="名前・種別・番号で絞り込み" data-testid="tool-filter" />
          <select v-model="locationFilter" class="input loc-filter" data-testid="tool-location-filter" title="定位置で絞り込み">
            <option value="">定位置：すべて</option>
            <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.base }}＞{{ l.name }}</option>
            <option value="__none__">定位置なし</option>
          </select>
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
              <th style="width:200px">所持者／持出先（いつから）</th>
              <th style="width:110px">最終位置</th>
              <th style="width:230px"></th>
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
              <!-- 道具③: 誰が・どこに・いつから（経過日数）。保管中なら「今ある場所」（最後に返却した場所QR） -->
              <td class="sub" :data-testid="`tool-where-${t.id}`">
                <template v-if="t.status === 'out'">
                  {{ t.workers?.name ?? '—' }} / {{ t.sites?.name ?? '—' }}
                  <span v-if="whereabouts[t.id]?.since" class="since" :class="{ long: (whereabouts[t.id]?.days ?? 0) >= 7 }" :data-testid="`tool-days-${t.id}`">{{ fmtSince(whereabouts[t.id]!) }}</span>
                </template>
                <template v-else-if="t.current_location">{{ t.current_location.base }}＞{{ t.current_location.name }}</template>
                <template v-else>—</template>
              </td>
              <td class="sub">
                <a v-if="whereabouts[t.id]?.lat != null" :href="mapUrl(whereabouts[t.id]!)" target="_blank" rel="noopener" class="map-link" :data-testid="`tool-map-${t.id}`">
                  <span class="material-symbols-rounded">location_on</span>{{ fmtWhen(whereabouts[t.id]!.at) }}
                </a>
                <span v-else-if="whereabouts[t.id]" class="muted" :data-testid="`tool-map-none-${t.id}`">位置なし</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="actions">
                <button class="btn-edit" :data-testid="`tool-history-${t.id}`" @click="openHistory(t)">履歴</button>
                <button class="btn-edit" :data-testid="`tool-qr-${t.id}`" @click="openQr(t)">QR</button>
                <button class="btn-edit" :disabled="busy" @click="openTool(t)">編集</button>
                <button class="btn-del" :disabled="busy" @click="removeTool(t)">削除</button>
              </td>
            </tr>
            <tr v-if="filtered.length === 0"><td colspan="9" class="empty">道具がありません。「＋ 道具を登録」から登録してください。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 道具③: 履歴（持出／返却／又貸し／調整）を時系列で -->
    <div v-if="historyTool" class="modal-overlay" @click.self="historyTool = null">
      <div class="modal history-modal" data-testid="tool-history-modal">
        <h2 class="modal-title">{{ historyTool.name }} の履歴</h2>
        <p v-if="historyLoading" class="muted">読み込み中…</p>
        <p v-else-if="!history.length" class="muted" data-testid="tool-history-empty">まだ持出・返却の記録はありません。</p>
        <ul v-else class="history">
          <li v-for="e in history" :key="e.id" class="h-row" :data-testid="`tool-history-row-${e.id}`">
            <span class="h-when">{{ fmtWhen(e.created_at) }}</span>
            <span class="h-kind" :class="e.kind">{{ EVENT_LABEL[e.kind] ?? e.kind }}</span>
            <span class="h-who">{{ e.worker?.name ?? '—' }}<span v-if="e.kind === 'transfer' && e.from_worker?.name" class="muted">（← {{ e.from_worker.name }}）</span></span>
            <span class="h-where">{{ e.kind === 'return' ? (e.tool_locations ? `${e.tool_locations.base?.name ?? ''}＞${e.tool_locations.name}` : '—') : (e.sites?.name ?? '—') }}</span>
            <a v-if="e.lat != null && e.lng != null" :href="mapUrl({ lat: e.lat, lng: e.lng })" target="_blank" rel="noopener" class="map-link"><span class="material-symbols-rounded">location_on</span>地図</a>
            <span v-else class="muted">位置なし</span>
            <span v-if="e.note" class="muted h-note">{{ e.note }}</span>
          </li>
        </ul>
        <div class="modal-actions"><button class="btn-cancel" @click="historyTool = null">閉じる</button></div>
      </div>
    </div>

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
          <p class="hint"><a href="#" data-testid="tool-location-add" @click.prevent="openLocation(undefined, undefined, true)">＋ 場所をその場で登録</a>（拠点が無ければ<a href="#" @click.prevent="openBase()">拠点を登録</a>）</p>
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
import { getAccountId } from '../lib/account'
import { toolQrUrl, toolLocationQrUrl, downloadQrLabelPdf, type QrLabel } from '../lib/toolQr'
import BaseSiteModal from '../components/BaseSiteModal.vue'

type Base = { id: string; name: string; kind: 'office' | 'factory' }
/** base は EF が拠点サイト名を平らにしたもの（表示用）。保存は base_site_id */
type Location = { id: string; base: string; base_site_id: string; name: string; sort_order: number; active: boolean }
type Tool = {
  id: string; name: string; kind: string | null; code: string | null; location_id: string | null; current_location_id?: string | null
  status: string; note: string | null; active: boolean; photo_url: string | null; updated_at?: string
  tool_locations?: { base: string; name: string } | null
  current_location?: { base: string; name: string } | null
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
const tab = ref<'tools' | 'locations'>('tools')
/** 拠点が無効化された/消えた保管場所の受け皿 */
const OTHER = '__other__'
const loading = ref(true)
const busy = ref(false)
const saving = ref(false)
const generating = ref(false)
const saveError = ref('')
const showInactive = ref(false)
const filter = ref('')
const locationFilter = ref('')   // ''=すべて / location id / '__none__'=定位置なし
const selectedIds = ref<string[]>([])
const toolModal = ref<Partial<Tool> | null>(null)
const locModal = ref<Partial<Location> | null>(null)
const qrTool = ref<Tool | null>(null)
const qrCanvas = ref<HTMLCanvasElement | null>(null)


// ── 道具③: 所在（いつから・経過日数・最終位置）と履歴 ──
type Whereabouts = { since: string | null; days: number | null; at: string; lat: number | null; lng: number | null }
type ToolEvent = {
  id: string; kind: string; created_at: string; lat: number | null; lng: number | null; note: string | null
  worker?: { name: string } | null; from_worker?: { name: string } | null; sites?: { name: string } | null
  tool_locations?: { name: string; base?: { name: string } | null } | null
}
const EVENT_LABEL: Record<string, string> = { checkout: '持出', return: '返却', transfer: '又貸し（所持者移転）', adjust: '調整' }
const whereabouts = ref<Record<string, Whereabouts>>({})
const historyTool = ref<Tool | null>(null)
const history = ref<ToolEvent[]>([])
const historyLoading = ref(false)
const mapUrl = (w: { lat: number | null; lng: number | null }) => `https://www.google.com/maps?q=${w.lat},${w.lng}`
const fmtWhen = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const fmtSince = (w: Whereabouts) => w.days == null ? '' : w.days <= 0 ? '（今日から）' : `（${w.days}日前から）`

/** 各道具の最新イベント（最終位置）と、持出中なら最後の持出/又貸し（いつから）。tool_events は authenticated が自社分を読める */
async function loadWhereabouts(accountId: string) {
  const { data } = await supabase.from('tool_events')
    .select('tool_id, kind, created_at, lat, lng')
    .eq('account_id', accountId).order('created_at', { ascending: false }).limit(2000)
  const m: Record<string, Whereabouts> = {}
  for (const e of (data ?? []) as any[]) {
    const cur = m[e.tool_id]
    if (!cur) m[e.tool_id] = { since: null, days: null, at: e.created_at, lat: e.lat ?? null, lng: e.lng ?? null }
    const w = m[e.tool_id]
    if (w.since === null && (e.kind === 'checkout' || e.kind === 'transfer')) {
      w.since = e.created_at
      w.days = Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86400000)
    }
  }
  // 最終位置は「位置が入っている最新のイベント」を優先（返却で位置なしでも、直前の持出の位置が見える方が役に立つ）
  for (const e of (data ?? []) as any[]) {
    const w = m[e.tool_id]
    if (w && w.lat == null && e.lat != null && e.lng != null) { w.lat = e.lat; w.lng = e.lng; w.at = e.created_at }
  }
  whereabouts.value = m
}

async function openHistory(t: Tool) {
  historyTool.value = t; history.value = []; historyLoading.value = true
  const accountId = await getAccountId()   // RLS に任せず account_id も明示（Gemini 指摘・loadWhereabouts と同じ）
  const { data } = await supabase.from('tool_events')
    .select('id, kind, created_at, lat, lng, note, worker:workers!tool_events_worker_id_fkey(name), from_worker:workers!tool_events_from_worker_id_fkey(name), sites(name), tool_locations(name, base:base_site_id(name))')
    .eq('account_id', accountId).eq('tool_id', t.id).order('created_at', { ascending: false }).limit(200)
  history.value = (data ?? []) as unknown as ToolEvent[]
  historyLoading.value = false
}

const kindOptions = computed(() => [...new Set(tools.value.map(t => t.kind).filter(Boolean) as string[])])
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  const lf = locationFilter.value
  return tools.value.filter(t => {
    if (lf === '__none__' ? !!t.location_id : (lf && t.location_id !== lf)) return false
    if (!q) return true
    return [t.name, t.kind, t.code, t.tool_locations?.base, t.tool_locations?.name].some(v => (v ?? '').toLowerCase().includes(q))
  })
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
  const { data: acct } = await supabase.auth.getUser()
  const accountId = await getAccountId()
  if (acct?.user && accountId) await loadWhereabouts(accountId)
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
/** fromTool=true は道具登録モーダルから「場所をその場で登録」（保存後にその道具の定位置に入れる・タブは切り替えない） */
const locFromTool = ref(false)
function openLocation(l?: Location, baseSiteId?: string, fromTool = false) {
  saveError.value = ''
  locFromTool.value = fromTool
  locModal.value = l ? { ...l } : { base_site_id: baseSiteId ?? (bases.value.length === 1 ? bases.value[0].id : ''), name: '', active: true }
}
// ── 拠点（オフィス・工場）をその場で登録 ──
function openBase() { baseModal.value = true }
async function onBaseSaved(id: string) {
  baseModal.value = false
  tab.value = 'locations'
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
  if (locFromTool.value) {
    // 道具登録の途中で作った場所 → その道具の定位置に入れて、道具モーダルに戻る
    await load()
    if (toolModal.value && r.data?.id) toolModal.value.location_id = r.data.id as string
    return
  }
  tab.value = 'locations'
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
/** 引数なし＝有効な場所すべて／配列＝その場所だけ（場所を1つ足した時に差分だけ刷る・2026-09-19 要望） */
async function downloadLocationQr(list?: Location[]) {
  const targets = list ?? locations.value.filter(l => l.active)
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
.btn-ghost.sm { padding: 6px 12px; font-size: 12px; white-space: nowrap; }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.block { margin-bottom: 24px; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
.block-title { font-size: 15px; font-weight: 700; margin: 0; }
.count { font-size: 12px; color: #888; font-weight: 400; margin-left: 6px; }
.head-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.head-right.nowrap { flex-wrap: nowrap; width: 100%; }
.tools-head { justify-content: flex-start; }
.chk { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; }
.filter { flex: 1; min-width: 160px; max-width: 360px; padding: 6px 10px; font-size: 13px; }
.chk { white-space: nowrap; }
.loc-filter { width: auto; max-width: 260px; padding: 6px 10px; font-size: 13px; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid #e5e7eb; margin-bottom: 14px; }
.tab { background: none; border: none; padding: 10px 16px; font-size: 14px; font-weight: 700; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.tab.active { color: #111; border-bottom-color: #06C755; }
.tab-count { font-size: 11px; font-weight: 400; color: #888; margin-left: 4px; }
.block-note { color: #64748b; font-size: 12px; margin: 0; line-height: 1.7; flex: 1; }
.empty-box { background: #fff; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 28px; text-align: center; color: #64748b; font-size: 13px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.empty-box p { margin: 0; }
.table tr.group td { background: #f1f5f9; border-top: 1px solid #e2e8f0; padding: 9px 14px; font-size: 13px; }
.table tr.group + tr.loc td { border-top: none; }
.base-icon { font-size: 18px; color: #475569; vertical-align: middle; margin-right: 6px; }
.base-name { font-weight: 700; font-size: 14px; vertical-align: middle; }
.base-kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; margin: 0 8px; vertical-align: middle; }
.base-kind.factory { background: #fef3c7; color: #92400e; }
.base-kind.other { display: none; }
.loc-name { padding-left: 38px !important; }
.loc-empty { color: #94a3b8; font-size: 12px; padding-left: 38px !important; }
.btn-edit.add { background: #e8fff0; color: #0a8a3a; font-weight: 700; }
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
.since { display: inline-block; margin-left: 4px; font-size: 11px; color: #64748b; }
.since.long { color: #b91c1c; font-weight: 700; }
.map-link { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: #1d4ed8; text-decoration: none; }
.map-link .material-symbols-rounded { font-size: 16px; }
.muted { color: #94a3b8; font-size: 12px; }
.history-modal { max-width: 720px; }
.history { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; }
.h-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.h-when { color: #64748b; font-variant-numeric: tabular-nums; width: 80px; }
.h-kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.h-kind.checkout { background: #fff7ed; color: #c2410c; } .h-kind.return { background: #ecfdf5; color: #047857; } .h-kind.transfer { background: #eff6ff; color: #1d4ed8; }
.h-who { font-weight: 600; } .h-where { color: #475569; } .h-note { width: 100%; }
</style>
