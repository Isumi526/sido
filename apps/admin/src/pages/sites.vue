<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場マスタ</h1>
      <div class="header-actions">
        <button v-if="!mergeMode" class="btn-ghost" @click="startMerge">現場をマージ</button>
        <template v-else>
          <button class="btn-ghost" :disabled="mergePick.length < 2" @click="openMerge">マージ実行（{{ mergePick.length }}件選択）</button>
          <button class="btn-ghost" @click="cancelMerge">キャンセル</button>
        </template>
        <button class="btn-add" @click="openAdd">＋ 追加</button>
      </div>
    </div>

    <!-- 有効 / 無効化済み タブ -->
    <div class="status-tabs">
      <button class="status-tab" :class="{ active: statusFilter === 'active' }" @click="statusFilter = 'active'">有効 <span class="tab-count">{{ sites.filter(s => s.active).length }}</span></button>
      <button class="status-tab" :class="{ active: statusFilter === 'inactive' }" @click="statusFilter = 'inactive'">無効化済み <span class="tab-count">{{ sites.filter(s => !s.active).length }}</span></button>
    </div>

    <!-- AC3: 検索・並び替え -->
    <div class="filters">
      <input v-model="q" class="input filter-input" placeholder="現場名・読み仮名・住所・元請けで検索" />
      <select v-model="sortBy" class="input filter-input">
        <option value="kana">並び替え：五十音</option>
        <option value="recent">並び替え：直近日報が新しい順</option>
      </select>
      <span class="result-count">{{ filtered.length }} 件</span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th v-if="mergeMode"></th><th>現場名</th><th>責任者</th><th>元請け</th><th>固定時刻</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id" :class="{ inactive: !s.active }">
            <td v-if="mergeMode"><input type="checkbox" :value="s.id" v-model="mergePick" :disabled="!s.active" /></td>
            <td class="name"><a class="name-link" @click="router.push(`/sites/${s.id}`)">{{ s.name }}</a><span v-if="s.name_kana" class="kana-sub">{{ s.name_kana }}</span></td>
            <td class="resp">
              <template v-if="s.responsible_worker_id">{{ responsibleName(s.responsible_worker_id) }}</template>
              <span v-else-if="s.active" class="resp-warn" title="責任者が未登録です。編集から登録してください">未登録</span>
              <span v-else>—</span>
            </td>
            <td>{{ s.contractor_id ? contractorName(s.contractor_id) : '—' }}</td>
            <td class="fixed-time">{{ fixedTimeLabel(s) }}</td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(s)">編集</button>
              <button class="btn-toggle" @click="toggleActive(s)">{{ s.active ? '無効化' : '有効化' }}</button>
              <button class="btn-rules" @click="router.push(`/site-rules?site_id=${s.id}`)">ルール・QR設定</button>
            </td>
          </tr>
          <tr v-if="!filtered.length"><td :colspan="mergeMode ? 6 : 5" class="empty">該当する現場がありません</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="tryCloseModal">
      <div class="modal">
        <h2>{{ modal.id ? '現場を編集' : '現場を追加' }}</h2>
        <!-- ① 識別情報（名前・かな・住所） -->
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
          <label>場所 / 住所</label>
          <input v-model="modal.location" class="input" placeholder="例：名古屋市〇〇区…" />
        </div>
        <!-- ② 関係（元請け） -->
        <div class="field">
          <label>元請け（日報の現場絞り込みに使用・任意）</label>
          <select v-model="modal.contractor_id" class="input">
            <option :value="null">未紐付け</option>
            <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>責任者（必須・現場管理者以上）</label>
          <select v-model="modal.responsible_worker_id" class="input">
            <option :value="null">選択してください</option>
            <option v-for="w in responsibleCandidates" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
          <p v-if="!modal.responsible_worker_id" class="resp-hint">責任者は必須です（残業申請の通知先等に使用）。新規現場は既定でログイン中のあなたが入ります。</p>
        </div>
        <!-- ③ 工事内容 -->
        <div class="field">
          <label>工事種類</label>
          <input v-model="modal.construction_type" class="input" placeholder="例：内装・改修" />
        </div>
        <div class="field">
          <label>工事内容</label>
          <textarea v-model="modal.construction_details" class="input" rows="2" placeholder="例：1F内装ボード・クロス工事 一式"></textarea>
        </div>
        <!-- ④ 運用（固定勤務時刻・日報の既定＆終了上限） -->
        <div class="field">
          <label>固定勤務時刻（日報の既定＆終了上限・任意）</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input v-model="modal.default_start_time" type="time" class="input" style="width:auto" @focus="modal.default_start_time || (modal.default_start_time = '08:30')" />
            <span>〜</span>
            <input v-model="modal.default_end_time" type="time" class="input" style="width:auto" @focus="modal.default_end_time || (modal.default_end_time = '17:30')" />
          </div>
          <p class="hint-sm" style="font-size:12px;color:#64748b;margin-top:4px">設定すると日報でこの現場を選んだ時に作業時刻の既定値になり、終了は固定終了を超えて報告できません（早退で下回るのは可）。</p>
        </div>
        <!-- ④' 既定休憩（開始時刻＋分の複数登録。日報でこの現場を選ぶと反映・人件費計算に反映） -->
        <div class="field">
          <label>既定休憩（開始時刻＋休憩時間・任意・複数可）</label>
          <div v-for="(brk, bi) in (modal.default_breaks || [])" :key="bi" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <input v-model="brk.start" type="time" class="input" style="width:auto" data-testid="break-start" />
            <input v-model.number="brk.minutes" type="number" min="0" step="15" class="input" style="width:90px" placeholder="60" data-testid="break-minutes" />
            <span style="font-size:13px;color:#64748b">分</span>
            <button type="button" class="btn-ghost" style="padding:2px 8px" @click="removeBreak(bi)">×</button>
          </div>
          <button type="button" class="btn-ghost" style="padding:4px 10px;font-size:13px" data-testid="add-break" @click="addBreak">＋ 休憩を追加</button>
          <p class="hint-sm" style="font-size:12px;color:#64748b;margin-top:4px">設定すると<b>新規</b>日報でこの現場を選んだ時に休憩がこの時間帯になり、稼働時間・人件費に反映されます（開始時刻が深夜/残業帯なら割増分が減る）。未設定＝役割×勤務時間の自動計算のまま。過去の日報は変わりません。</p>
        </div>
        <!-- ⑤ メモ -->
        <div class="field">
          <label>メモ</label>
          <textarea v-model="modal.memo" class="input" rows="2" placeholder="任意"></textarea>
        </div>
        <!-- ⑥ 絞り込み（協力業者・長いリストは添付の直前＝最下部へ） -->
        <div class="field">
          <label>この現場に紐づく協力業者（日報の業者プルダウンを絞り込み）</label>
          <div class="sub-link-list" data-testid="site-sub-links">
            <label v-for="s in subcontractors" :key="s.id" class="sub-link-item">
              <input type="checkbox" :value="s.id" v-model="modal.linkedSubs" />{{ s.name }}
            </label>
            <span v-if="!subcontractors.length" class="hint">協力業者マスタが空です</span>
          </div>
          <p class="hint">未選択なら日報では全業者が出ます（紐付けすると、その現場では選択した業者のみに絞り込み）。</p>
        </div>

        <!-- ⑦ 現場ルール（新規現場のみここで同時設定・既存はルール/QR設定画面へ） -->
        <div v-if="!modal.id" class="field">
          <label>現場ルール（任意・出退勤時に確認事項を表示）</label>
          <div v-if="modalRules.length" class="rule-list">
            <div v-for="(r, i) in modalRules" :key="i" class="rule-row">
              <textarea v-model="r.content" class="input rule-content" rows="2" placeholder="例：ヘルメットを必ず着用すること" />
              <select v-model="r.timing" class="input rule-timing">
                <option value="checkin">出勤時のみ</option>
                <option value="checkout">退勤時のみ</option>
                <option value="both">出勤・退勤両方</option>
              </select>
              <button type="button" class="rule-del" title="削除" @click="modalRules.splice(i, 1)">×</button>
            </div>
          </div>
          <div v-if="ruleHistory.length" class="rule-history">
            <span class="hint">過去のルールから追加：</span>
            <button v-for="(h, i) in ruleHistory" :key="i" type="button" class="rule-hist-btn" @click="addRuleRow(h.content, h.timing)">{{ h.content }}</button>
          </div>
          <button type="button" class="btn-rule-add" @click="addRuleRow()">＋ ルールを追加</button>
          <p class="hint">現場作成後は「ルール・QR設定」からいつでも追加・編集できます。</p>
        </div>

        <!-- 写真・書類（新規でも添付可・新規は保存時に確定） -->
        <div class="field">
          <label>写真・書類（複数可）</label>
          <div v-if="attachments.length || pendingAtts.length" class="att-list">
            <div v-for="a in attachments" :key="a.id" class="att-item">
              <span class="att-kind">{{ a.kind === 'photo' ? '📷' : '📄' }}</span>
              <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="att-link">{{ a.name || a.path.split('/').pop() }}</a>
              <span v-else class="att-link att-disabled">{{ a.name || a.path.split('/').pop() }}</span>
              <label v-if="a.kind === 'document'" class="att-consent" :class="{ on: a.require_consent }" :title="'出退勤（チェックイン）時に作業員へ提示し同意を取る'">
                <input type="checkbox" :checked="a.require_consent" @change="toggleConsent(a)" />出退勤同意
              </label>
              <button class="att-del" @click="removeAttachment(a)">×</button>
            </div>
            <div v-for="(p, i) in pendingAtts" :key="'pa' + i" class="att-item pending">
              <img v-if="p.preview" :src="p.preview" class="att-thumb" :alt="p.name" />
              <span v-else class="att-kind">📄</span>
              <span class="att-link">{{ p.name }}<span class="muted">（保存時にアップロード）</span></span>
              <button class="att-del" title="取り消し" @click="removePendingAtt(i)">×</button>
            </div>
          </div>
          <div class="att-add att-dropzone" :class="{ dragover: attDragOver, busy: uploading }"
               @drop.prevent="onDropAtt" @dragover.prevent="attDragOver = true" @dragleave.prevent="attDragOver = false">
            <label class="att-btn">＋ 写真<input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onAttach($event, 'photo')" /></label>
            <label class="att-btn">＋ 書類<input type="file" accept="application/pdf,image/*" multiple hidden :disabled="uploading" @change="onAttach($event, 'document')" /></label>
            <span class="att-drop-hint">{{ attDragOver ? 'ここにドロップ' : 'またはここに画像/PDFを複数まとめてドラッグ&ドロップ' }}</span>
            <span v-if="uploading" class="att-up">アップロード中…</span>
          </div>
          <p v-if="!modal.id" class="hint">新規はここで選ぶと「保存時にアップロード」されます。出退勤同意の設定は作成後に「ルール・QR設定」で行えます。</p>
        </div>

        <div v-if="modal.id" class="field">
          <label>この現場の見積書</label>
          <div v-if="siteEstimates.length" class="att-list" data-testid="site-estimates">
            <div v-for="e in siteEstimates" :key="e.id" class="att-item">
              <span class="att-kind">📄</span>
              <span class="att-link">{{ e.estimate_number || '（番号なし）' }}<span class="muted"> ・{{ e.estimate_date || '—' }} ・¥{{ (e.total_amount ?? 0).toLocaleString() }}</span></span>
              <a v-if="e.pdf_path" :href="estPdfUrl(e.pdf_path)" target="_blank" rel="noopener" class="att-link pdf-link">📄 PDF</a>
            </div>
          </div>
          <p v-else class="hint">この現場に紐づく見積書はありません（見積書登録時に現場を選ぶと自動で紐付きます）。</p>
        </div>

        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="tryCloseModal">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>

    <!-- マージモーダル -->
    <div v-if="mergeModal" class="modal-overlay" @click.self="mergeModal = null">
      <div class="modal">
        <h2>現場をマージ</h2>
        <p class="hint">どれに統合しますか？（残す1つを選択。他はすべて無効化され、日報・経費・集計・予定・添付・下請けなどの参照は残す側に統合されます）</p>
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
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { useQueryParam } from '../composables/useQueryParam'
import { currentUser } from '../lib/auth'
import { findSimilarSiteNames } from '../lib/siteSimilarity'

const router = useRouter()

type Site = {
  id: string; name: string; name_kana: string | null; active: boolean
  location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null
  contractor_id: string | null   // 紐づく元請け（任意）
  default_start_time: string | null; default_end_time: string | null   // 固定勤務時刻（日報の既定＆終了上限）
  default_breaks?: { start: string; minutes: number }[] | null   // 既定休憩[{start,minutes}]。新規日報で現場選択時にスナップショット
  responsible_worker_id: string | null   // 現場責任者（現場管理者以上のworker・必須はUIで担保）
}
type Att = { id: string; site_id: string; kind: string; path: string; name: string | null; require_consent?: boolean; url?: string | null }

const BUCKET = 'site-attachments'
const sites     = ref<Site[]>([])
const contractors = ref<{ id: string; name: string }[]>([])   // 元請けマスタ（紐付け用）
const subcontractors = ref<{ id: string; name: string }[]>([]) // 下請け業者マスタ（現場紐付け用）
// 現場責任者の候補＝現場管理者以上(permission_role in admin/office/site_manager)のworker。myWorkerId=ログイン中ユーザーのworker(新規現場の既定)。
const responsibleCandidates = ref<{ id: string; name: string }[]>([])
const workerNames = ref<Record<string, string>>({})   // 全作業員 id→名前（表示用）
const myWorkerId = ref<string | null>(null)
// 責任者名の表示: 実名を出し、候補条件(現場管理者以上・有効)を満たさない人には「要再設定」を添える。
function responsibleName(id: string | null | undefined): string {
  if (!id) return ''
  const name = workerNames.value[id]
  if (!name) return '（不明な作業員・要再設定）'
  const isCandidate = responsibleCandidates.value.some(w => w.id === id)
  return isCandidate ? name : `${name}（要再設定）`
}
const modal     = ref<Partial<Site> & { linkedSubs?: string[] } | null>(null)
const saving    = ref(false)
const saveError = ref('')
// 新規現場追加時にその場で設定する現場ルール（保存時に site_rules へ一括insert・#12）
type RuleTiming = 'checkin' | 'checkout' | 'both'
const modalRules  = ref<{ content: string; timing: RuleTiming }[]>([])
const ruleHistory = ref<{ content: string; timing: RuleTiming }[]>([])
function addRuleRow(content = '', timing: RuleTiming = 'both') { modalRules.value.push({ content, timing }) }
// 未保存の入力があるままモーダルを閉じようとしたら確認を挟む
const formDirty = ref(false)
let armDirty = false
function markFormOpened() {
  armDirty = false
  formDirty.value = false
  nextTick(() => { armDirty = true })
}
watch([() => modal.value, modalRules], () => { if (armDirty && modal.value) formDirty.value = true }, { deep: true })
function tryCloseModal() {
  if (formDirty.value && !confirm('入力中の内容が保存されていません。閉じてもよろしいですか？')) return
  formDirty.value = false
  modal.value = null
}
// 編集中の現場の添付（写真・書類）
const attachments = ref<Att[]>([])
const uploading   = ref(false)
// 新規現場作成時（site_id 未確定）は添付を保留し、保存時にまとめてアップロードする
const pendingAtts = ref<{ file: File; kind: 'photo' | 'document'; name: string; preview?: string }[]>([])
function removePendingAtt(i: number) {
  const p = pendingAtts.value[i]
  if (p?.preview) URL.revokeObjectURL(p.preview)
  pendingAtts.value.splice(i, 1)
}
function clearPendingAtts() {
  for (const p of pendingAtts.value) if (p.preview) URL.revokeObjectURL(p.preview)
  pendingAtts.value = []
}
async function uploadPendingAtts(siteId: string, accountId: string) {
  for (const p of pendingAtts.value) {
    const ext = (p.file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${accountId}/${siteId}/${p.kind}-${Date.now()}-${Math.round(p.file.size % 100000)}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, p.file, { upsert: false, contentType: p.file.type || undefined })
    if (!error) await supabase.from('site_attachments').insert({ account_id: accountId, site_id: siteId, kind: p.kind, path, name: p.file.name })
  }
  clearPendingAtts()
}
// この現場に紐づく見積書（estimates.site_id）。閲覧専用。
type SiteEstimate = { id: string; estimate_number: string | null; estimate_date: string | null; total_amount: number | null; pdf_path: string | null }
const siteEstimates = ref<SiteEstimate[]>([])
const ESTIMATE_BUCKET = 'expense-receipts'
function estPdfUrl(path: string) { return supabase.storage.from(ESTIMATE_BUCKET).getPublicUrl(path).data.publicUrl }
async function loadSiteEstimates(siteId: string) {
  const { data } = await supabase.from('estimates')
    .select('id, estimate_number, estimate_date, total_amount, pdf_path')
    .eq('site_id', siteId).eq('is_deleted', false)
    .order('estimate_date', { ascending: false, nullsFirst: false })
  siteEstimates.value = (data ?? []) as SiteEstimate[]
}
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
      .select('id, name, name_kana, active, location, construction_type, construction_details, memo, contractor_id, default_start_time, default_end_time, default_breaks, responsible_worker_id')
      .eq('account_id', accountId)
      .order('name_kana', { nullsFirst: false })
      .order('name'),
    supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('sort_order').order('name'),
  ])
  sites.value = (data ?? []) as Site[]
  contractors.value = (cons ?? []) as { id: string; name: string }[]
  const { data: subs } = await supabase.from('subcontractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  subcontractors.value = (subs ?? []) as { id: string; name: string }[]
  // 責任者候補＝現場管理者以上のworker。ログイン中ユーザーのworker(auth_user_id一致)を新規現場の既定に。
  const { data: cand } = await supabase.from('workers')
    .select('id, name, auth_user_id, permission_role').eq('account_id', accountId).eq('active', true)
    .in('permission_role', ['admin', 'office', 'site_manager']).order('sort_order').order('name')
  responsibleCandidates.value = ((cand ?? []) as any[]).map(w => ({ id: w.id, name: w.name }))
  myWorkerId.value = ((cand ?? []) as any[]).find(w => w.auth_user_id && w.auth_user_id === currentUser.value?.id)?.id ?? null
  // 表示用: 全作業員の id→名前（候補外の責任者でも実名を出せるように）
  const { data: allW } = await supabase.from('workers').select('id, name').eq('account_id', accountId)
  workerNames.value = Object.fromEntries(((allW ?? []) as any[]).map(w => [w.id, w.name]))
  // AC1: 現場ごとの「直近日報日」「日報件数（直近90日）」を集計（daily_reports.sites JSON の現場名で突合）
  const since = new Date(); since.setDate(since.getDate() - 90)
  const sinceStr = since.toISOString().split('T')[0]
  const { data: reps } = await supabase.from('daily_reports')
    .select('date, sites').eq('account_id', accountId).gte('date', sinceStr)
  const stats: Record<string, { count: number; lastDate: string }> = {}
  for (const r of (reps ?? []) as any[]) {
    for (const st of (r.sites ?? [])) {
      const nm = (st?.siteName === '__other__' ? st?.customSiteName : st?.siteName)?.trim()
      if (!nm) continue
      const cur = stats[nm] ??= { count: 0, lastDate: '' }
      cur.count++
      if (r.date > cur.lastDate) cur.lastDate = r.date
    }
  }
  siteStats.value = stats
}
onMounted(load)

const siteStats = ref<Record<string, { count: number; lastDate: string }>>({})
const contractorName = (id: string | null | undefined) => contractors.value.find((c) => c.id === id)?.name ?? '—'
// 一覧の固定時刻カラム表示（HH:MM:SS → HH:MM、未設定は —）
function fixedTimeLabel(s: Site): string {
  const a = (s.default_start_time ?? '').slice(0, 5)
  const b = (s.default_end_time ?? '').slice(0, 5)
  return (!a && !b) ? '—' : `${a || '—'}〜${b || '—'}`
}

// AC3: 検索（名称/読み仮名/住所/元請け）・状態絞り込み・並び替え
const q          = useQueryParam('q', '')                                  // URL ?q= 検索
// 既定は『有効のみ』表示（無効現場はデフォルト非表示・フィルタで切替可）
const statusFilter = useQueryParam<'active' | 'inactive'>('status', 'active')   // ?status= 有効/無効化済みタブ
const sortBy     = useQueryParam<'kana' | 'recent'>('sort', 'kana')             // ?sort= 並び順
const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  let list = sites.value.filter((s) => {
    if (statusFilter.value === 'active' && !s.active) return false
    if (statusFilter.value === 'inactive' && s.active) return false
    if (!kw) return true
    const hay = [s.name, s.name_kana, s.location, contractorName(s.contractor_id)].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(kw)
  })
  if (sortBy.value === 'recent') {
    list = [...list].sort((a, b) => (siteStats.value[b.name]?.lastDate ?? '').localeCompare(siteStats.value[a.name]?.lastDate ?? ''))
  } else {
    list = [...list].sort((a, b) => (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja'))
  }
  return list
})

function openAdd()        { modal.value = { name: '', name_kana: '', location: '', construction_type: '', construction_details: '', memo: '', contractor_id: null, default_start_time: '', default_end_time: '', default_breaks: [], responsible_worker_id: myWorkerId.value ?? null, linkedSubs: [] }; attachments.value = []; siteEstimates.value = []; saveError.value = ''; modalRules.value = []; clearPendingAtts(); markFormOpened(); fetchRuleHistory() }
function addBreak()    { if (!modal.value) return; (modal.value.default_breaks ??= []).push({ start: '12:00', minutes: 60 }) }
function removeBreak(i: number) { modal.value?.default_breaks?.splice(i, 1) }

// アカウント内の既存現場ルールを重複排除して候補化（新規現場のルール設定を素早くするため・site-rules.vue と同方針）
async function fetchRuleHistory() {
  const accountId = await getAccountId()
  if (!accountId) return
  const [{ data }, { data: hiddenData }] = await Promise.all([
    supabase.from('site_rules').select('content, timing, sites!inner(account_id)').eq('sites.account_id', accountId).order('created_at', { ascending: false }),
    supabase.from('hidden_rule_suggestions').select('content').eq('account_id', accountId),
  ])
  const hidden = new Set(((hiddenData ?? []) as any[]).map(r => (r.content ?? '').trim()))
  const seen = new Set<string>(); const list: { content: string; timing: RuleTiming }[] = []
  for (const r of (data ?? []) as any[]) {
    const c = (r.content ?? '').trim()
    if (!c || seen.has(c) || hidden.has(c)) continue
    seen.add(c); list.push({ content: c, timing: r.timing as RuleTiming })
  }
  ruleHistory.value = list
}
async function openEdit(s: Site) {
  // time入力は HH:MM を期待するため DB の HH:MM:SS を切り詰める
  modal.value = { ...s, default_start_time: (s.default_start_time ?? '').slice(0, 5), default_end_time: (s.default_end_time ?? '').slice(0, 5),
    default_breaks: Array.isArray(s.default_breaks) ? s.default_breaks.map(b => ({ start: String(b.start ?? '').slice(0, 5), minutes: Number(b.minutes) || 0 })) : [],
    linkedSubs: [] }; saveError.value = ''
  const { data: links } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', s.id)
  if (modal.value) modal.value.linkedSubs = ((links ?? []) as any[]).map(l => l.subcontractor_id)
  siteEstimates.value = []
  clearPendingAtts()
  await Promise.all([loadAttachments(s.id), loadSiteEstimates(s.id)])
  markFormOpened()   // 非同期ロード後に dirty 監視を開始（ロード自体を編集と誤認しない）
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

// 既定休憩を「開始時刻でソート」＋「時間帯の重なりバリデート」して返す（人件費計算の入力を堅くする）
function brkToMin(s: string): number { const [h, mm] = String(s).split(':').map(Number); return (h || 0) * 60 + (mm || 0) }
function normalizeBreaks(breaks: { start: string; minutes: number }[] | null | undefined):
  { ok: true; breaks: { start: string; minutes: number }[] } | { ok: false; error: string } {
  const arr = (breaks ?? [])
    .filter(b => b && b.start && (Number(b.minutes) || 0) > 0)
    .map(b => ({ start: String(b.start).slice(0, 5), minutes: Number(b.minutes) || 0 }))
    .sort((a, b) => brkToMin(a.start) - brkToMin(b.start))   // 開始時刻で自動ソート
  // 重なり/重複チェック: 前の休憩の終了 > 次の休憩の開始 なら重なり
  for (let i = 0; i + 1 < arr.length; i++) {
    const endPrev = brkToMin(arr[i].start) + arr[i].minutes
    if (endPrev > brkToMin(arr[i + 1].start)) {
      return { ok: false, error: `既定休憩が重なっています（${arr[i].start}〜 と ${arr[i + 1].start}〜）。時間帯が重ならないよう修正してください。` }
    }
  }
  return { ok: true, breaks: arr }
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '現場名を入力してください'; return }
  if (!modal.value?.responsible_worker_id) { saveError.value = '責任者を選択してください（現場管理者以上）'; return }
  // 既定休憩をソート＋重なり検証（重なりがあれば保存を止める）
  const nb = normalizeBreaks(modal.value.default_breaks)
  if (!nb.ok) { saveError.value = nb.error; return }
  modal.value.default_breaks = nb.breaks   // 画面の並びもソート済みに反映
  saving.value = true; saveError.value = ''
  try {
    const m = modal.value
    const payload = {
      name: m.name!.trim(), name_kana: m.name_kana?.trim() || null,
      location: m.location?.trim() || null, construction_type: m.construction_type?.trim() || null,
      construction_details: m.construction_details?.trim() || null, memo: m.memo?.trim() || null,
      contractor_id: m.contractor_id || null,
      default_start_time: m.default_start_time || null, default_end_time: m.default_end_time || null,
      // 既定休憩: ソート＋重なり検証済み。空なら null（＝現場休憩なし＝自動計算に戻す）。
      default_breaks: (() => {
        const arr = nb.breaks
        return arr.length ? arr : null
      })(),
      responsible_worker_id: m.responsible_worker_id || null,
    }
    const accountId = await getAccountId()
    let siteId = m.id
    if (siteId) {
      await supabase.from('sites').update(payload).eq('id', siteId)
    } else {
      const { data } = await supabase.from('sites').insert({ ...payload, account_id: accountId }).select('id').single()
      siteId = (data as any)?.id
      // 新規現場: その場で入力された現場ルールを site_rules へ一括登録（#12・空行は除外・重複contentは1つに）
      if (siteId) {
        const seen = new Set<string>()
        const rows = modalRules.value
          .map(r => ({ content: (r.content ?? '').trim(), timing: r.timing }))
          .filter(r => r.content && !seen.has(r.content) && seen.add(r.content))
          .map((r, idx) => ({ site_id: siteId, content: r.content, timing: r.timing, sort_order: idx }))
        if (rows.length) await supabase.from('site_rules').insert(rows)
        // 新規現場: 保留していた写真・書類を確定した site_id で添付アップロード
        if (pendingAtts.value.length) await uploadPendingAtts(siteId, accountId)
      }
    }
    if (siteId) await syncSiteSubcontractors(siteId, accountId, m.linkedSubs ?? [])
    formDirty.value = false; modal.value = null; await load()
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
// ボタン選択（複数可）→ 各ファイルを処理
async function onAttach(ev: Event, kind: 'photo' | 'document') {
  const input = ev.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) await processAttFile(f, kind)
  input.value = ''
}
// ドラッグ&ドロップ（写真/PDF混在可）→ ファイル種別から kind を推定して処理
const attDragOver = ref(false)
async function onDropAtt(ev: DragEvent) {
  attDragOver.value = false
  if (uploading.value) return
  for (const f of Array.from(ev.dataTransfer?.files ?? [])) {
    const kind: 'photo' | 'document' = f.type.startsWith('image/') ? 'photo' : 'document'
    await processAttFile(f, kind)
  }
}
async function processAttFile(file: File | undefined | null, kind: 'photo' | 'document') {
  if (!file || !modal.value) return
  // 新規現場: 保留（保存時にアップロード）。写真はサムネ用プレビュー生成。
  if (!modal.value.id) {
    pendingAtts.value.push({ file, kind, name: file.name, preview: kind === 'photo' ? URL.createObjectURL(file) : undefined })
    return
  }
  uploading.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    // path 先頭フォルダ = account_id（storage RLS の account スコープに使用）。複数同時でも衝突しないよう乱数付与
    const path = `${accountId}/${modal.value.id}/${kind}-${Date.now()}-${Math.round(file.size % 100000)}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    await supabase.from('site_attachments').insert({ account_id: accountId, site_id: modal.value.id, kind, path, name: file.name })
    await loadAttachments(modal.value.id)
  } catch (e: any) { saveError.value = e.message ?? 'アップロードに失敗しました' }
  finally { uploading.value = false }
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
  if (picked.length < 2) return   // 2現場以上（3つ以上の同時マージ対応）
  mergeModal.value = { sites: picked }; mergeTarget.value = picked[0].id; saveError.value = ''
}

async function doMerge() {
  const all = mergeModal.value!.sites
  const target = all.find((s) => s.id === mergeTarget.value)!
  const sources = all.filter((s) => s.id !== target.id)   // 統合元＝target以外の全選択（複数対応）
  if (!sources.length) return
  const sourceIds = sources.map((s) => s.id)
  const sourceNames = sources.map((s) => s.name)
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    // 1) site_id(FK) を持つ参照を統合先へ付け替え（単純repoint）。付け替え漏れ防止で消費テーブルを網羅。
    const SIMPLE_FK = [...SITE_FK_TABLES, 'site_attachments', 'process_tasks', 'estimate_projects']
    for (const tbl of SIMPLE_FK) {
      await supabase.from(tbl).update({ site_id: target.id }).in('site_id', sourceIds).then(() => {}, () => {})
    }
    // 1b) site_subcontractors は unique(site_id,subcontractor_id)。統合先に既にある業者は重複になるので除去してから付け替え。
    const { data: tgtSubs } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', target.id)
    const tgtSet = new Set((tgtSubs ?? []).map((x: any) => x.subcontractor_id))
    const { data: srcSubs } = await supabase.from('site_subcontractors').select('id, subcontractor_id').in('site_id', sourceIds)
    for (const row of (srcSubs ?? []) as any[]) {
      if (tgtSet.has(row.subcontractor_id)) {
        await supabase.from('site_subcontractors').delete().eq('id', row.id).then(() => {}, () => {})
      } else {
        await supabase.from('site_subcontractors').update({ site_id: target.id }).eq('id', row.id).then(() => {}, () => {})
        tgtSet.add(row.subcontractor_id)
      }
    }
    // 2) 名称スナップショット(site_name)も target.name に更新。集計は現場名キーのため site_id 付け替えだけでは統合されない。
    //    id-scoped（付け替え済み=site_id が target のもの）に限定＝他テナントの同名現場を巻き込まない。
    for (const tbl of ['subcontractor_invoice_items', 'purchase_orders']) {
      await supabase.from(tbl).update({ site_name: target.name }).eq('site_id', target.id).in('site_name', sourceNames).then(() => {}, () => {})
    }
    // 3) daily_reports.sites[] の現場参照を target.name へ寄せる。
    //    siteName===source.name だけでなく、__other__ の customSiteName===source.name も統合（集計は現場名/customSiteName キーのため取りこぼし防止）。
    const { data: reps } = await supabase.from('daily_reports').select('id, sites').eq('account_id', accountId).limit(10000)
    for (const r of (reps ?? []) as any[]) {
      const arr = Array.isArray(r.sites) ? r.sites : []
      let changed = false
      const next = arr.map((s: any) => {
        if (s?.siteName && sourceNames.includes(s.siteName)) { changed = true; return { ...s, siteName: target.name } }
        if (s?.siteName === '__other__' && s?.customSiteName && sourceNames.includes(s.customSiteName)) {
          changed = true; return { ...s, siteName: target.name, customSiteName: '' }
        }
        return s
      })
      if (changed) await supabase.from('daily_reports').update({ sites: next }).eq('id', r.id)
    }
    // 4) 統合元を無効化（複数）
    await supabase.from('sites').update({ active: false }).in('id', sourceIds)
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
.status-tabs { display: flex; gap: 4px; margin-bottom: 14px; }
.status-tab { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
.status-tab.active { background: #06C755; border-color: #06C755; color: #fff; }
.status-tab .tab-count { font-size: 11px; opacity: .8; margin-left: 2px; }
.filters { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.filter-input { max-width: 280px; }
.result-count { color: #888; font-size: 13px; margin-left: auto; }
.kana-sub { color: #aaa; font-size: 11px; margin-left: 8px; font-weight: 400; }
.name-link { color: #06A050; cursor: pointer; text-decoration: none; }
.name-link:hover { text-decoration: underline; }
.btn-detail { background: #e8f9ef; color: #06A050; font-weight: 700; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.loc { color: #555; font-size: 13px; }
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
.modal { background: #fff; border-radius: 12px; padding: 32px; width: min(560px, 92vw); display: flex; flex-direction: column; gap: 20px; max-height: 90vh; overflow-y: auto; }
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
.resp-warn { display: inline-block; margin-left: 8px; padding: 1px 6px; font-size: 11px; font-weight: 700; color: #b91c1c; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 4px; }
.resp-hint { margin: 4px 0 0; font-size: 12px; color: #b45309; }
.att-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.att-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.att-item.pending { opacity: .9; }
.att-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.08) inset; }
.att-link { color: #1a56c4; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-del { background: none; border: none; color: #c0392b; cursor: pointer; font-size: 16px; }
.att-consent { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #888; white-space: nowrap; cursor: pointer; }
.att-consent.on { color: #0a8a3a; font-weight: 700; }
.att-consent input { cursor: pointer; }
.att-add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.att-dropzone { border: 2px dashed #d1d5db; border-radius: 10px; padding: 12px 14px; background: #fafafa; transition: border-color .15s, background .15s; }
.att-dropzone.dragover { border-color: #2563eb; background: #eff6ff; }
.att-dropzone.busy { opacity: .7; }
.att-drop-hint { font-size: 12px; color: #6b7280; pointer-events: none; }
.att-btn { background: #f0f0f0; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.att-up { font-size: 12px; color: #888; }
textarea.input { resize: vertical; font-family: inherit; }
.rule-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.rule-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
.rule-content { flex: 1; min-width: 0; min-height: 48px; resize: vertical; box-sizing: border-box; }
.rule-timing { width: 150px; flex-shrink: 0; }
.rule-del { flex-shrink: 0; width: 32px; height: 32px; border: 1px solid #fca5a5; background: none; color: #ef4444; border-radius: 6px; cursor: pointer; font-size: 14px; }
.rule-del:hover { background: #fef2f2; }
.rule-history { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.rule-hist-btn { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #222; cursor: pointer; }
.rule-hist-btn:hover { background: #f0fdf4; border-color: #06C755; }
.btn-rule-add { align-self: flex-start; background: #e0f2fe; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; color: #0369a1; font-weight: 600; cursor: pointer; }
</style>
