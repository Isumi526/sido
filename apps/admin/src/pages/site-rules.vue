<template>
  <div>
    <div class="page-header">
      <div class="header-left">
        <button class="btn-back" @click="router.push('/sites')">← 現場一覧</button>
        <h1 class="page-title">{{ siteName }} &nbsp;—&nbsp; 確認ルール</h1>
      </div>
      <button class="btn-add" @click="openAdd">＋ ルール追加</button>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="rules.length === 0" class="empty">ルールが登録されていません</div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:48px">順序</th>
            <th>ルール内容</th>
            <th style="width:120px">表示タイミング</th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td class="order-cell">
              <div class="order-btns">
                <button class="btn-order" :disabled="rule.sort_order === 0" @click="moveUp(rule)">▲</button>
                <button class="btn-order" @click="moveDown(rule)">▼</button>
              </div>
            </td>
            <td class="content-cell">{{ rule.content }}</td>
            <td>
              <span class="timing-badge" :class="rule.timing">{{ timingLabel(rule.timing) }}</span>
            </td>
            <td>
              <button class="btn-delete" @click="deleteRule(rule.id)">削除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 追加モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = false">
      <div class="modal">
        <h2>ルールを追加</h2>
        <div v-if="ruleHistory.length" class="field">
          <label>過去のルールから選択</label>
          <select class="select" @change="applyHistory">
            <option value="">— 新規入力 —</option>
            <option v-for="(h, i) in ruleHistory" :key="i" :value="i">{{ h.content }}</option>
          </select>
        </div>
        <div class="field">
          <label>ルール内容</label>
          <textarea v-model="newContent" class="textarea" rows="3" placeholder="例：ヘルメットを必ず着用すること" />
        </div>
        <div class="field">
          <label>表示タイミング</label>
          <select v-model="newTiming" class="select">
            <option value="checkin">出勤時のみ</option>
            <option value="checkout">退勤時のみ</option>
            <option value="both">出勤・退勤両方</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-save" :disabled="!newContent.trim() || saving" @click="saveRule">
            {{ saving ? '保存中...' : '追加' }}
          </button>
          <button class="btn-cancel" @click="modal = false">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Timing = 'checkin' | 'checkout' | 'both'
type Rule = { id: string; content: string; timing: string; sort_order: number }
type RuleHistory = { content: string; timing: Timing }

const route  = useRoute()
const router = useRouter()

const siteId   = route.query.site_id as string
const siteName = ref('')
const rules    = ref<Rule[]>([])
const loading  = ref(true)

const modal      = ref(false)
const newContent = ref('')
const newTiming  = ref<Timing>('both')
const saving     = ref(false)
const saveError  = ref('')

// 過去に他現場含めて登録したルール（content重複排除）
const ruleHistory = ref<RuleHistory[]>([])

function timingLabel(t: string) {
  if (t === 'checkin')  return '出勤時'
  if (t === 'checkout') return '退勤時'
  return '両方'
}

async function load() {
  loading.value = true

  const [{ data: site }, { data: ruleData }] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).single(),
    supabase.from('site_rules').select('id, content, timing, sort_order')
      .eq('site_id', siteId).order('sort_order'),
  ])

  siteName.value = site?.name ?? ''
  rules.value    = (ruleData ?? []) as Rule[]
  loading.value  = false
}

onMounted(load)

// アカウント内の全現場ルールから、過去登録分を重複排除して取得
async function fetchRuleHistory() {
  const accountId = await getAccountId()
  if (!accountId) return

  const { data } = await supabase
    .from('site_rules')
    .select('content, timing, sites!inner(account_id)')
    .eq('sites.account_id', accountId)
    .order('created_at', { ascending: false })

  const seen = new Set<string>()
  const list: RuleHistory[] = []
  for (const r of (data ?? []) as any[]) {
    const c = (r.content ?? '').trim()
    if (!c || seen.has(c)) continue   // 空・重複contentは排除
    seen.add(c)
    list.push({ content: c, timing: r.timing as Timing })
  }
  ruleHistory.value = list
}

function applyHistory(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v === '') return
  const h = ruleHistory.value[Number(v)]
  if (h) {
    newContent.value = h.content
    newTiming.value  = h.timing
  }
}

function openAdd() {
  newContent.value = ''
  newTiming.value  = 'both'
  saveError.value  = ''
  modal.value      = true
  fetchRuleHistory()
}

async function saveRule() {
  const content = newContent.value.trim()
  if (!content) return

  // この現場に同じ内容が既にあれば重複登録を防ぐ
  if (rules.value.some(r => r.content.trim() === content)) {
    saveError.value = 'この現場には同じ内容のルールが既に登録されています'
    return
  }

  saving.value    = true
  saveError.value = ''
  try {
    const maxOrder = rules.value.reduce((m, r) => Math.max(m, r.sort_order), -1)
    await supabase.from('site_rules').insert({
      site_id:    siteId,
      content:    newContent.value.trim(),
      timing:     newTiming.value,
      sort_order: maxOrder + 1,
    })
    modal.value = false
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function deleteRule(id: string) {
  if (!confirm('このルールを削除しますか？')) return
  await supabase.from('site_rules').delete().eq('id', id)
  await load()
}

async function moveUp(rule: Rule) {
  const idx = rules.value.findIndex(r => r.id === rule.id)
  if (idx <= 0) return
  const prev = rules.value[idx - 1]
  await Promise.all([
    supabase.from('site_rules').update({ sort_order: prev.sort_order }).eq('id', rule.id),
    supabase.from('site_rules').update({ sort_order: rule.sort_order }).eq('id', prev.id),
  ])
  await load()
}

async function moveDown(rule: Rule) {
  const idx = rules.value.findIndex(r => r.id === rule.id)
  if (idx < 0 || idx >= rules.value.length - 1) return
  const next = rules.value[idx + 1]
  await Promise.all([
    supabase.from('site_rules').update({ sort_order: next.sort_order }).eq('id', rule.id),
    supabase.from('site_rules').update({ sort_order: rule.sort_order }).eq('id', next.id),
  ])
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; gap: 16px; }
.header-left { display: flex; flex-direction: column; gap: 6px; }
.btn-back { background: none; border: none; color: #06C755; font-size: 13px; cursor: pointer; padding: 0; text-align: left; }
.btn-back:hover { text-decoration: underline; }
.page-title { font-size: 20px; font-weight: 700; }

.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; flex-shrink: 0; }

.empty { color: #888; padding: 40px 0; }

.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }

.order-cell { text-align: center; }
.order-btns { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.btn-order { background: #f5f5f5; border: none; border-radius: 4px; width: 28px; height: 22px; font-size: 11px; cursor: pointer; color: #555; }
.btn-order:disabled { opacity: .3; cursor: default; }

.content-cell { max-width: 480px; line-height: 1.5; }

.timing-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 600; }
.timing-badge.checkin  { background: #e0f2fe; color: #0369a1; }
.timing-badge.checkout { background: #fef3c7; color: #92400e; }
.timing-badge.both     { background: #f0fdf4; color: #166534; }

.btn-delete { background: none; border: 1px solid #fca5a5; color: #ef4444; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.btn-delete:hover { background: #fef2f2; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 440px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.textarea { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; resize: vertical; font-family: inherit; }
.select { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; cursor: pointer; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; cursor: default; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
</style>
