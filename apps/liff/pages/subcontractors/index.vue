<template>
  <div class="subs-page">
    <AppNav :subtitle="$t('nav.subcontractors')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <div class="subs-body">
      <!-- 検索・絞り込み -->
      <div class="search-bar">
        <div class="search-row">
          <span class="material-symbols-rounded search-icon">search</span>
          <input v-model="q" class="search-input" :placeholder="$t('subcontractors.searchPlaceholder')" />
        </div>
        <div class="filter-row">
          <select v-model="filterTrade" class="filter-select">
            <option value="">{{ $t('subcontractors.tradeAll') }}</option>
            <option v-for="t in tradeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="filterArea" class="filter-area" :placeholder="$t('subcontractors.areaPlaceholder')" />
        </div>
      </div>

      <!-- 登録ボタン -->
      <button class="btn-register" @click="openAdd">
        <span class="material-symbols-rounded">add_business</span>
        <span>{{ $t('subcontractors.registerSub') }}</span>
      </button>

      <!-- 一覧 -->
      <div v-if="loading" class="loading">{{ $t('common.loading') }}</div>
      <template v-else>
        <div v-if="!filtered.length" class="empty">{{ $t('subcontractors.noResults') }}</div>
        <div v-for="s in filtered" :key="s.id" class="sub-card" @click="openDetail(s)">
          <div class="sub-card-head">
            <div class="sub-name">{{ s.name }}</div>
            <span v-if="s.category" class="cat-badge" :class="s.category === '商社' ? 'shosha' : 'gyosha'">{{ s.category }}</span>
          </div>
          <div v-if="s.representative_name" class="sub-rep">{{ s.representative_name }}</div>
          <div v-if="s.trade_types.length || s.service_areas.length" class="sub-chips">
            <span v-for="t in s.trade_types" :key="'t'+t" class="chip">{{ t }}</span>
            <span v-for="a in s.service_areas" :key="'a'+a" class="chip area">{{ a }}</span>
          </div>
          <span class="material-symbols-rounded sub-arrow">chevron_right</span>
        </div>
      </template>
    </div>

    <!-- 詳細シート -->
    <div v-if="detail" class="overlay" @click.self="closeDetail">
      <div class="sheet">
        <div class="sheet-head">
          <h2>{{ detail.name }}</h2>
          <button class="sheet-close" @click="closeDetail">✕</button>
        </div>
        <div class="sheet-body">
          <!-- 基本情報 -->
          <div v-if="detail.category" class="detail-row">
            <span class="detail-label">{{ $t('subcontractors.labelCategory') }}</span>
            <span class="cat-badge" :class="detail.category === '商社' ? 'shosha' : 'gyosha'">{{ detail.category }}</span>
          </div>
          <div v-if="detail.representative_name" class="detail-row">
            <span class="detail-label">{{ $t('subcontractors.labelRep') }}</span>
            <span>{{ detail.representative_name }}</span>
          </div>

          <!-- 連絡先（タップで発信／メール） -->
          <div v-if="detail.mobile_phone" class="detail-row">
            <span class="detail-label">{{ $t('subcontractors.labelMobile') }}</span>
            <a class="contact-link" :href="`tel:${detail.mobile_phone}`">
              <span class="material-symbols-rounded">call</span>{{ detail.mobile_phone }}
            </a>
          </div>
          <div v-if="detail.office_phone" class="detail-row">
            <span class="detail-label">{{ $t('subcontractors.labelOfficePhone') }}</span>
            <a class="contact-link" :href="`tel:${detail.office_phone}`">
              <span class="material-symbols-rounded">call</span>{{ detail.office_phone }}
            </a>
          </div>
          <div v-if="detail.email" class="detail-row">
            <span class="detail-label">{{ $t('subcontractors.labelEmail') }}</span>
            <a class="contact-link" :href="`mailto:${detail.email}`">
              <span class="material-symbols-rounded">mail</span>{{ detail.email }}
            </a>
          </div>

          <!-- 工種・エリア -->
          <div v-if="detail.trade_types.length" class="detail-block">
            <span class="detail-label">{{ $t('subcontractors.labelTrades') }}</span>
            <div class="chips-wrap">
              <span v-for="t in detail.trade_types" :key="t" class="chip">{{ t }}</span>
            </div>
          </div>
          <div v-if="detail.service_areas.length" class="detail-block">
            <span class="detail-label">{{ $t('subcontractors.labelAreas') }}</span>
            <div class="chips-wrap">
              <span v-for="a in detail.service_areas" :key="a" class="chip area">{{ a }}</span>
            </div>
          </div>

          <!-- 操作 -->
          <div class="detail-actions">
            <button class="btn-edit" @click="openEdit(detail)">{{ $t('common.edit') }}</button>
            <button class="btn-delete" @click="softDelete(detail)">{{ $t('common.delete') }}</button>
          </div>

          <!-- コメント -->
          <div class="comments">
            <div class="comments-title">{{ $t('subcontractors.commentsTitle', { count: comments.length }) }}</div>
            <div v-if="commentsLoading" class="muted">{{ $t('common.loading') }}</div>
            <template v-else>
              <div v-for="c in comments" :key="c.id" class="comment">
                <div class="comment-head">
                  <span class="comment-author">{{ workerName(c.worker_id) }}</span>
                  <span class="comment-date">{{ fmtDate(c.created_at) }}</span>
                </div>
                <template v-if="editingCommentId === c.id">
                  <textarea v-model="editCommentDraft" class="comment-edit" rows="2" />
                  <div class="comment-edit-actions">
                    <button class="btn-mini" :disabled="commentBusy" @click="saveEditComment(c)">{{ $t('subcontractors.saveComment') }}</button>
                    <button class="btn-mini ghost" @click="editingCommentId = null">{{ $t('subcontractors.cancelComment') }}</button>
                  </div>
                </template>
                <template v-else>
                  <div class="comment-body">{{ c.content }}</div>
                  <div v-if="isOwnComment(c)" class="comment-own-actions">
                    <button class="comment-link" @click="startEditComment(c)">{{ $t('common.edit') }}</button>
                    <button class="comment-link danger" @click="deleteComment(c)">{{ $t('common.delete') }}</button>
                  </div>
                </template>
              </div>
              <p v-if="!comments.length" class="muted">{{ $t('subcontractors.noComments') }}</p>
            </template>
            <div class="comment-add">
              <textarea v-model="newComment" class="comment-input" rows="2" :placeholder="$t('subcontractors.commentPlaceholder')" />
              <button class="btn-comment" :disabled="commentBusy || !newComment.trim()" @click="addComment">{{ $t('subcontractors.postComment') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 登録・編集シート -->
    <div v-if="modal" class="overlay" @click.self="modal = null">
      <div class="sheet">
        <div class="sheet-head">
          <h2>{{ modal.id ? $t('subcontractors.editSub') : $t('subcontractors.registerSub') }}</h2>
          <button class="sheet-close" @click="modal = null">✕</button>
        </div>
        <div class="sheet-body">
          <div class="form-field">
            <label>{{ $t('subcontractors.labelName') }} <span class="req">*</span></label>
            <input v-model="modal.name" class="input" :placeholder="$t('subcontractors.namePlaceholder')" />
          </div>
          <div class="form-field">
            <label>{{ $t('subcontractors.labelCategory') }}</label>
            <select v-model="modal.category" class="input">
              <option value="業者">{{ $t('subcontractors.categoryGyosha') }}</option>
              <option value="商社">{{ $t('subcontractors.categoryShosha') }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>{{ $t('subcontractors.labelRepName') }}</label>
            <input v-model="modal.representative_name" class="input" :placeholder="$t('subcontractors.repNamePlaceholder')" />
          </div>
          <div class="form-field">
            <label>{{ $t('subcontractors.labelRepMobile') }}</label>
            <input v-model="modal.mobile_phone" class="input" type="tel" placeholder="090-..." />
          </div>
          <div class="form-field">
            <label>{{ $t('subcontractors.labelOfficePhone') }}</label>
            <input v-model="modal.office_phone" class="input" type="tel" placeholder="03-..." />
          </div>
          <div class="form-field">
            <label>{{ $t('subcontractors.labelEmailAddress') }}</label>
            <input v-model="modal.email" class="input" type="email" placeholder="info@example.com" />
          </div>

          <div class="form-field">
            <label>{{ $t('subcontractors.labelAreas') }}</label>
            <div class="chips-input">
              <span v-for="(a, i) in modal.service_areas" :key="a" class="chip area">{{ a }}<button class="chip-x" @click="modal.service_areas.splice(i, 1)">×</button></span>
              <input
                v-model="areaDraft" class="chip-add" list="pref-list"
                :placeholder="$t('subcontractors.areaInputPlaceholder')" @keydown.enter.prevent="addArea"
              />
            </div>
            <datalist id="pref-list">
              <option v-for="p in PREFECTURES" :key="p" :value="p" />
            </datalist>
            <span class="hint">{{ $t('subcontractors.areaHint') }}</span>
          </div>

          <div class="form-field">
            <label>{{ $t('subcontractors.labelTrades') }}</label>
            <div class="presets">
              <button
                v-for="p in presets" :key="p.id" type="button"
                class="preset-btn" :class="{ on: modal.trade_types.includes(p.name) }"
                @click="toggleTrade(p.name)"
              >{{ p.name }}</button>
            </div>
            <div class="chips-input">
              <span v-for="t in customTrades" :key="t" class="chip">{{ t }}<button class="chip-x" @click="removeTrade(t)">×</button></span>
              <input v-model="tradeDraft" class="chip-add" :placeholder="$t('subcontractors.tradeCustomPlaceholder')" @keydown.enter.prevent="addCustomTrade" />
            </div>
          </div>

          <p v-if="saveError" class="error">{{ saveError }}</p>
          <div class="sheet-actions">
            <button class="btn-cancel" @click="modal = null">{{ $t('common.cancel') }}</button>
            <button class="btn-save" :disabled="saving" @click="save">{{ saving ? $t('common.saving') : $t('common.save') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'

const { t } = useI18n()

type Sub = {
  id: string; name: string; active: boolean; category: string | null
  representative_name: string | null; mobile_phone: string | null; office_phone: string | null
  email: string | null; service_areas: string[]; is_deleted: boolean; trade_types: string[]
}
type Preset = { id: string; name: string; category: string; sort_order: number }
type Comment = { id: string; worker_id: string | null; content: string; created_at: string; updated_at: string }

const { profile } = useLiff()
const supabase    = useSupabase()
const config      = useRuntimeConfig()

const currentUser = ref<User | null>(null)
const myWorkerId  = computed<string | null>(() => currentUser.value?.worker_id ?? null)
const accountId   = ref<string | null>(null)

const subs    = ref<Sub[]>([])
const presets = ref<Preset[]>([])
const workersMap = ref<Record<string, string>>({})
const loading = ref(true)

const q           = ref('')
const filterTrade = ref('')
const filterArea  = ref('')

const detail = ref<Sub | null>(null)
const modal  = ref<(Partial<Sub> & { service_areas: string[]; trade_types: string[] }) | null>(null)
const saving = ref(false)
const saveError = ref('')
const areaDraft = ref('')
const tradeDraft = ref('')

const comments = ref<Comment[]>([])
const commentsLoading = ref(false)
const newComment = ref('')
const commentBusy = ref(false)
const editingCommentId = ref<string | null>(null)
const editCommentDraft = ref('')

const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県',
  '埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県',
  '佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
]

const SUB_COLS = 'id, name, active, category, representative_name, mobile_phone, office_phone, email, service_areas, is_deleted'

async function load() {
  loading.value = true
  try {
    // account は身元優先（認証時は env で上書きしない＝テナント分離）
    const { getAccountId } = useAccount()
    const aid = await getAccountId()
    if (!aid) return
    accountId.value = aid

    const [{ data: subRows }, { data: presetRows }, { data: ttRows }, { data: workerRows }] = await Promise.all([
      supabase.from('subcontractors').select(SUB_COLS).eq('account_id', aid).eq('is_deleted', false).order('sort_order'),
      supabase.from('trade_type_presets').select('id, name, category, sort_order').eq('account_id', aid).order('sort_order'),
      supabase.from('subcontractor_trade_types').select('subcontractor_id, trade_type').eq('account_id', aid),
      supabase.from('workers').select('id, name').eq('account_id', aid),
    ])

    const ttMap = new Map<string, string[]>()
    for (const r of (ttRows ?? []) as any[]) {
      const arr = ttMap.get(r.subcontractor_id) ?? []
      arr.push(r.trade_type); ttMap.set(r.subcontractor_id, arr)
    }
    subs.value = ((subRows ?? []) as any[]).map((s) => ({
      ...s,
      service_areas: s.service_areas ?? [],
      is_deleted: !!s.is_deleted,
      trade_types: ttMap.get(s.id) ?? [],
    }))
    presets.value = (presetRows ?? []) as Preset[]
    const wm: Record<string, string> = {}
    for (const w of (workerRows ?? []) as any[]) wm[w.id] = w.name
    workersMap.value = wm
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // LIFFプロファイル取得待ち → 作業員を解決（編集ログ/コメントの作者に使う）
  let tries = 0
  while (!profile.value?.userId && tries++ < 20) await new Promise(r => setTimeout(r, 300))
  await load()
  // email/pw は worker_id 経由・LINEは line_user_id（単一ソース解決）
  const me = await useCurrentUser().resolve()
  if (me) currentUser.value = me as User
})

const tradeOptions = computed(() => {
  const set = new Set<string>(presets.value.map((p) => p.name))
  for (const s of subs.value) for (const t of s.trade_types) set.add(t)
  return [...set]
})

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const area = filterArea.value.trim()
  return subs.value.filter((s) => {
    if (kw && !`${s.name}${s.representative_name ?? ''}`.toLowerCase().includes(kw)) return false
    if (filterTrade.value && !s.trade_types.includes(filterTrade.value)) return false
    if (area && !s.service_areas.some((a) => a.includes(area))) return false
    return true
  })
})

const customTrades = computed(() => (modal.value?.trade_types ?? []).filter((t) => !presets.value.some((p) => p.name === t)))

function workerName(id: string | null) { return (id && workersMap.value[id]) || t('subcontractors.defaultWorker') }
function fmtDate(s: string) {
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── 詳細シート ──
async function openDetail(s: Sub) {
  detail.value = s
  await loadComments(s.id)
}
function closeDetail() { detail.value = null; comments.value = []; editingCommentId.value = null; newComment.value = '' }

// ── 登録・編集 ──
function blankModal(): any {
  return { name: '', category: '業者', representative_name: '', mobile_phone: '', office_phone: '', email: '', service_areas: [], trade_types: [] }
}
function openAdd() { modal.value = blankModal(); areaDraft.value = ''; tradeDraft.value = ''; saveError.value = '' }
function openEdit(s: Sub) {
  modal.value = { ...s, service_areas: [...s.service_areas], trade_types: [...s.trade_types] }
  areaDraft.value = ''; tradeDraft.value = ''; saveError.value = ''
}

function addArea() {
  const v = areaDraft.value.trim()
  if (v && !modal.value!.service_areas.includes(v)) modal.value!.service_areas.push(v)
  areaDraft.value = ''
}
function toggleTrade(name: string) {
  const arr = modal.value!.trade_types
  const i = arr.indexOf(name)
  if (i >= 0) arr.splice(i, 1); else arr.push(name)
}
function addCustomTrade() {
  const v = tradeDraft.value.trim()
  if (v && !modal.value!.trade_types.includes(v)) modal.value!.trade_types.push(v)
  tradeDraft.value = ''
}
function removeTrade(name: string) {
  const arr = modal.value!.trade_types
  const i = arr.indexOf(name); if (i >= 0) arr.splice(i, 1)
}

async function logEdit(subId: string, action: string, changes: unknown) {
  await supabase.from('subcontractor_edit_logs').insert({
    subcontractor_id: subId, account_id: accountId.value, edited_by: myWorkerId.value, action, changes,
  }).then(() => {}, () => {}) // best-effort
}

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = t('subcontractors.errorNameRequired'); return }
  saving.value = true; saveError.value = ''
  try {
    const aid = accountId.value
    const payload = {
      name:                modal.value.name.trim(),
      category:            modal.value.category || '業者',
      representative_name: modal.value.representative_name?.trim() || null,
      mobile_phone:        modal.value.mobile_phone?.trim() || null,
      office_phone:        modal.value.office_phone?.trim() || null,
      email:               modal.value.email?.trim() || null,
      service_areas:       modal.value.service_areas,
    }
    let subId = modal.value.id
    if (subId) {
      await supabase.from('subcontractors').update(payload).eq('id', subId)
      await logEdit(subId, 'update', payload)
    } else {
      const { data, error } = await supabase.from('subcontractors')
        .insert({ ...payload, account_id: aid, active: true, registered_by: myWorkerId.value })
        .select('id').single()
      if (error) throw error
      subId = data?.id
      if (subId) await logEdit(subId, 'create', payload)
    }
    if (subId) await syncTradeTypes(subId, aid!, modal.value.trade_types)
    modal.value = null
    await load()
    // 詳細を開いていたら最新を反映
    if (detail.value) detail.value = subs.value.find((s) => s.id === detail.value!.id) ?? null
  } catch (e: any) { saveError.value = e.message ?? t('subcontractors.errorSaveFailed') }
  finally { saving.value = false }
}

async function syncTradeTypes(subId: string, aid: string, want: string[]) {
  const { data } = await supabase.from('subcontractor_trade_types').select('id, trade_type').eq('subcontractor_id', subId)
  const have = (data ?? []) as { id: string; trade_type: string }[]
  const toAdd = want.filter((w) => !have.some((h) => h.trade_type === w))
  const toDel = have.filter((h) => !want.includes(h.trade_type))
  if (toAdd.length) await supabase.from('subcontractor_trade_types').insert(toAdd.map((t) => ({ subcontractor_id: subId, account_id: aid, trade_type: t })))
  if (toDel.length) await supabase.from('subcontractor_trade_types').delete().in('id', toDel.map((h) => h.id))
}

async function softDelete(s: Sub) {
  if (!confirm(t('subcontractors.confirmDelete', { name: s.name }))) return
  await supabase.from('subcontractors').update({
    is_deleted: true, active: false, deleted_by: myWorkerId.value, deleted_at: new Date().toISOString(),
  }).eq('id', s.id)
  await logEdit(s.id, 'delete', { name: s.name })
  closeDetail()
  await load()
}

// ── コメント ──
async function loadComments(subId: string) {
  commentsLoading.value = true
  try {
    const { data } = await supabase.from('subcontractor_comments')
      .select('id, worker_id, content, created_at, updated_at')
      .eq('subcontractor_id', subId).eq('is_deleted', false)
      .order('created_at', { ascending: true })
    comments.value = (data ?? []) as Comment[]
  } finally {
    commentsLoading.value = false
  }
}
function isOwnComment(c: Comment) { return !!myWorkerId.value && c.worker_id === myWorkerId.value }

async function addComment() {
  const content = newComment.value.trim()
  if (!content || !detail.value) return
  commentBusy.value = true
  try {
    await supabase.from('subcontractor_comments').insert({
      subcontractor_id: detail.value.id, account_id: accountId.value, worker_id: myWorkerId.value, content,
    })
    newComment.value = ''
    await loadComments(detail.value.id)
  } finally { commentBusy.value = false }
}
function startEditComment(c: Comment) { editingCommentId.value = c.id; editCommentDraft.value = c.content }
async function saveEditComment(c: Comment) {
  const content = editCommentDraft.value.trim()
  if (!content) return
  commentBusy.value = true
  try {
    await supabase.from('subcontractor_comments')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', c.id).eq('worker_id', myWorkerId.value)
    editingCommentId.value = null
    if (detail.value) await loadComments(detail.value.id)
  } finally { commentBusy.value = false }
}
async function deleteComment(c: Comment) {
  if (!confirm(t('subcontractors.confirmDeleteComment'))) return
  commentBusy.value = true
  try {
    await supabase.from('subcontractor_comments')
      .update({ is_deleted: true }).eq('id', c.id).eq('worker_id', myWorkerId.value)
    if (detail.value) await loadComments(detail.value.id)
  } finally { commentBusy.value = false }
}
</script>

<style scoped>
.subs-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f2f2f7; overflow-x: hidden; }
.subs-body { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* 検索 */
.search-bar { display: flex; flex-direction: column; gap: 8px; }
.search-row { display: flex; align-items: center; gap: 8px; background: #fff; border-radius: 12px; padding: 0 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.search-icon { color: #999; font-size: 22px; }
.search-input { flex: 1; border: none; outline: none; background: none; padding: 13px 0; font-size: 15px; }
.filter-row { display: flex; gap: 8px; }
.filter-select, .filter-area { flex: 1; min-width: 0; background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box; }

/* 登録ボタン */
.btn-register { display: flex; align-items: center; justify-content: center; gap: 8px; background: #06C755; color: #fff; border: none; border-radius: 12px; padding: 13px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(6,199,85,.25); }
.btn-register:active { opacity: .85; }
.btn-register .material-symbols-rounded { font-size: 20px; }

.loading, .empty { text-align: center; color: #999; padding: 32px 0; font-size: 14px; }

/* カード */
.sub-card { position: relative; background: #fff; border-radius: 14px; padding: 14px 36px 14px 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); cursor: pointer; }
.sub-card:active { background: #fafafa; }
.sub-card-head { display: flex; align-items: center; gap: 8px; }
.sub-name { font-size: 15px; font-weight: 700; color: #111; }
.sub-rep { font-size: 12px; color: #888; margin-top: 2px; }
.sub-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.sub-arrow { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #ccc; font-size: 22px; }

.chip { display: inline-flex; align-items: center; font-size: 11px; background: #eef3ff; color: #1a6fc4; padding: 3px 9px; border-radius: 12px; }
.chip.area { background: #eafaf0; color: #0a8a3a; }
.cat-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700; flex-shrink: 0; }
.cat-badge.shosha { background: #fff3e0; color: #e65100; }
.cat-badge.gyosha { background: #e8f4ff; color: #1a6fc4; }

/* シート（ボトムシート） */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 300; display: flex; align-items: flex-end; justify-content: center; }
.sheet { background: #fff; width: 100%; max-width: 480px; border-radius: 20px 20px 0 0; max-height: 88dvh; display: flex; flex-direction: column; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 12px; border-bottom: 1px solid #f0f0f0; }
.sheet-head h2 { font-size: 17px; font-weight: 700; margin: 0; }
.sheet-close { background: #f5f5f5; border: none; border-radius: 50%; width: 28px; height: 28px; font-size: 13px; cursor: pointer; color: #555; flex-shrink: 0; }
.sheet-body { overflow-y: auto; padding: 16px 20px 28px; display: flex; flex-direction: column; gap: 14px; }

/* 詳細 */
.detail-row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.detail-label { font-size: 12px; color: #999; font-weight: 700; min-width: 64px; }
.detail-block { display: flex; flex-direction: column; gap: 6px; }
.chips-wrap { display: flex; flex-wrap: wrap; gap: 5px; }
.contact-link { display: inline-flex; align-items: center; gap: 5px; color: #06C755; text-decoration: none; font-weight: 600; }
.contact-link .material-symbols-rounded { font-size: 18px; }
.detail-actions { display: flex; gap: 10px; margin-top: 4px; }
.btn-edit { flex: 1; background: #f0f0f0; color: #333; border: none; border-radius: 8px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-delete { flex: 1; background: #fff0f0; color: #dc2626; border: none; border-radius: 8px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }

/* コメント */
.comments { border-top: 1px solid #f0f0f0; padding-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.comments-title { font-size: 13px; font-weight: 700; color: #555; }
.muted { color: #aaa; font-size: 13px; }
.comment { background: #f8f9fa; border-radius: 10px; padding: 10px 12px; }
.comment-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.comment-author { font-size: 12px; font-weight: 700; color: #333; }
.comment-date { font-size: 11px; color: #aaa; }
.comment-body { font-size: 14px; color: #111; white-space: pre-wrap; word-break: break-word; }
.comment-own-actions { display: flex; gap: 12px; margin-top: 6px; }
.comment-link { background: none; border: none; color: #1a6fc4; font-size: 12px; cursor: pointer; padding: 0; }
.comment-link.danger { color: #dc2626; }
.comment-edit { width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 8px; padding: 8px; font-size: 14px; font-family: inherit; resize: vertical; }
.comment-edit-actions { display: flex; gap: 8px; margin-top: 6px; }
.btn-mini { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 5px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
.btn-mini.ghost { background: #eee; color: #666; }
.comment-add { display: flex; gap: 8px; align-items: flex-end; }
.comment-input { flex: 1; box-sizing: border-box; border: 1px solid #ddd; border-radius: 8px; padding: 9px 11px; font-size: 14px; font-family: inherit; resize: vertical; }
.btn-comment { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
.btn-comment:disabled { opacity: .4; }

/* フォーム */
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; }
.input { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 11px 13px; font-size: 15px; width: 100%; box-sizing: border-box; }
.hint { font-size: 11px; color: #aaa; }
.chips-input { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px; }
.chip-add { flex: 1; min-width: 120px; border: none; background: none; outline: none; font-size: 14px; padding: 4px; }
.chip-x { background: none; border: none; color: inherit; cursor: pointer; margin-left: 4px; font-size: 14px; line-height: 1; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.preset-btn { font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 14px; padding: 6px 12px; cursor: pointer; }
.preset-btn.on { background: #1a6fc4; color: #fff; border-color: #1a6fc4; }
.error { color: #E53935; font-size: 13px; }
.sheet-actions { display: flex; gap: 10px; margin-top: 6px; }
.btn-cancel { flex: 1; background: #f1f5f9; color: #666; border: none; border-radius: 8px; padding: 13px; font-size: 15px; cursor: pointer; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 13px; font-size: 15px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
</style>
