<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積もり</h1>
      <div class="header-actions">
        <RouterLink to="/estimate-masters" class="btn-ghost" data-testid="to-masters">マスタ・単価表</RouterLink>
        <button class="btn-add" :disabled="creating" data-testid="new-estimate" @click="goNew">{{ creating ? '作成中…' : '＋ 新規見積' }}</button>
      </div>
    </div>

    <div class="filters">
      <input v-model="q" class="input filter-input" placeholder="案件名・元請けで検索" data-testid="estimate-search" />
      <span v-if="createErr" class="err" data-testid="new-estimate-err">{{ createErr }}</span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>案件名</th><th>元請け</th><th class="num">合計（税抜）</th><th>状態</th>
            <th>見積送信</th><th>商社発注</th><th>更新</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" class="row" :data-testid="`estimate-row-${r.id}`" @click="open(r.id)">
            <!-- ★R52: 「＋新規見積」を押した時点で行を作るので、案件名がまだ無い下書きが並ぶ。
                 生の仮名を出すと分かりにくいので、下書きは明示してから続きを促す。 -->
            <td class="name">
              <template v-if="r.is_draft">
                <span class="badge draft" :data-testid="`estimate-draft-${r.id}`">下書き</span>
                <span class="draft-name">案件名を入力していません（クリックで続ける）</span>
              </template>
              <template v-else>{{ r.name }}</template>
            </td>
            <td>{{ r.contractorName || '—' }}</td>
            <td class="num">{{ yen(r.total) }}</td>
            <td><span class="status" :class="r.status">{{ statusLabel(r.status) }}</span></td>
            <td>
              <span v-if="r.sent" class="badge ok">送信済み</span>
              <span v-else class="badge muted">未送信</span>
            </td>
            <td>
              <span v-if="r.poCount" class="badge" :class="r.poSent >= r.poCount ? 'ok' : 'partial'">{{ r.poSent }}/{{ r.poCount }}社</span>
              <span v-else class="badge muted">—</span>
            </td>
            <td class="date">{{ shortDate(r.updated_at) }}</td>
            <!-- 下書きだけ消せるようにする。中身のある見積は誤って消せると困るのでここでは消させない -->
            <td>
              <button v-if="r.is_draft" class="btn-del" :data-testid="`estimate-del-${r.id}`" @click.stop="removeDraft(r)">×</button>
            </td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="8" class="empty">{{ loading ? '読み込み中…' : '見積はまだありません。「＋ 新規見積」で作成できます。' }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { logFeatureUsage } from '../lib/usageLog'

type Row = {
  id: string; name: string; contractorName: string; status: string
  total: number; updated_at: string; sent: boolean; poCount: number; poSent: number
  is_draft: boolean
}

const router    = useRouter()
const rows      = ref<Row[]>([])
const loading   = ref(true)
const q         = ref('')
const creating  = ref(false)
const createErr = ref('')

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
// 業務フローに沿った状態（Q5・確認16で合意）。issued は見積書PDF発行時に自動セットされる。
const STATUS: Record<string, string> = {
  draft: '対応中', issued: '提出済み', active: '受注',
  lost: '失注', declined: '辞退', closed: 'クローズ',
}
function statusLabel(s: string) { return STATUS[s] ?? s }
function shortDate(iso: string) { try { return new Date(iso).toLocaleDateString('ja-JP', { year: '2-digit', month: 'numeric', day: 'numeric' }) } catch { return '' } }

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter(r => `${r.name}${r.contractorName}`.toLowerCase().includes(kw))
})

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: projects }, { data: contractors }, { data: items }, { data: sends }, { data: pos }] = await Promise.all([
    supabase.from('estimate_projects').select('id, name, contractor_id, status, updated_at, is_draft').eq('account_id', accountId).order('updated_at', { ascending: false }),
    supabase.from('contractors').select('id, name').eq('account_id', accountId),
    supabase.from('estimate_items').select('project_id, amount').eq('account_id', accountId),
    supabase.from('estimate_sends').select('project_id, sent_at').eq('account_id', accountId),
    supabase.from('purchase_orders').select('estimate_project_id, email_sent_at').eq('account_id', accountId).eq('is_deleted', false).not('estimate_project_id', 'is', null),
  ])
  const cName = new Map((contractors ?? []).map((c: any) => [c.id, c.name]))
  const totalByProj = new Map<string, number>()
  for (const it of (items ?? []) as any[]) totalByProj.set(it.project_id, (totalByProj.get(it.project_id) ?? 0) + Number(it.amount || 0))
  const sentByProj = new Set<string>()
  for (const s of (sends ?? []) as any[]) if (s.sent_at) sentByProj.add(s.project_id)
  const poByProj = new Map<string, { count: number; sent: number }>()
  for (const p of (pos ?? []) as any[]) {
    const cur = poByProj.get(p.estimate_project_id) ?? { count: 0, sent: 0 }
    cur.count++; if (p.email_sent_at) cur.sent++
    poByProj.set(p.estimate_project_id, cur)
  }
  rows.value = ((projects ?? []) as any[]).map((p) => ({
    id: p.id, name: p.name, contractorName: cName.get(p.contractor_id) ?? '', status: p.status,
    total: totalByProj.get(p.id) ?? 0, updated_at: p.updated_at,
    sent: sentByProj.has(p.id),
    poCount: poByProj.get(p.id)?.count ?? 0, poSent: poByProj.get(p.id)?.sent ?? 0,
    is_draft: !!p.is_draft,
  }))
  loading.value = false
}
onMounted(load)

function open(id: string) { router.push({ path: '/estimate-builder', query: { project: id } }) }

/**
 * ★R52: 押した時点で案件を作り、URLにIDを載せてから遷移する。
 *  これまでは案件名を入力して「作成」を押すまでDBに何も無かったため、
 *  途中で担当者マスタを直しに行って戻ると入力が全部消えていた。
 *  案件名は図面のファイル名から起こす（R51）ので、この時点では仮名を入れる。
 *  (account_id, lower(name)) に一意indexがあるため、仮名は時刻入りで衝突を避ける。
 */
async function goNew() {
  creating.value = true
  createErr.value = ''
  const accountId = await getAccountId()
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = draftName(attempt)
    const { data, error } = await supabase.from('estimate_projects')
      .insert({ account_id: accountId, name, is_draft: true }).select('id').single()
    if (!error) {
      creating.value = false
      logFeatureUsage('estimate_created')
      // step=1 = 図面アップロードから始めるステップ式フロー（R51）
      router.push({ path: '/estimate-builder', query: { project: (data as any).id, step: '1' } })
      return
    }
    lastErr = error.message
    if (!/duplicate|unique/i.test(error.message)) break   // 一意違反以外は再試行しても無駄
  }
  creating.value = false
  createErr.value = `見積を作成できませんでした: ${lastErr}`
}

/** 仮の案件名。人が見て「まだ名前が無い」と分かる形にする（同時作成でも衝突しないよう時刻入り） */
function draftName(attempt: number) {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return attempt === 0 ? `（案件名未入力）${stamp}` : `（案件名未入力）${stamp}#${attempt + 1}`
}

/** 下書きは消せる（案件名すら入れずに離脱したものが溜まるため） */
async function removeDraft(r: Row) {
  if (!confirm('この下書きを削除します。よろしいですか？')) return
  const { error } = await supabase.from('estimate_projects').delete().eq('id', r.id)
  if (error) { createErr.value = error.message; return }
  rows.value = rows.value.filter(x => x.id !== r.id)
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer; text-decoration: none; color: #333; }
.btn-ghost:hover { background: #f5f5f5; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.filters { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
.err { color: #dc2626; font-size: 13px; }
.badge.draft { background: #fff7ed; color: #9a3412; }
.draft-name { color: #94a3b8; font-weight: 400; margin-left: 8px; }
.btn-del { background: none; border: none; color: #cbd5e1; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.btn-del:hover { color: #dc2626; }
.btn-add:disabled { opacity: .6; cursor: default; }
.filter-input { min-width: 280px; }
.input { padding: 8px 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table th.num { text-align: right; }
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.row { cursor: pointer; }
.row:hover { background: #f7faf8; }
.name { font-weight: 600; }
.date { color: #888; white-space: nowrap; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #eef0ee; color: #555; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.closed { background: #f5f5f5; color: #aaa; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.ok { background: #e8fff0; color: #0a8a3a; }
.badge.partial { background: #fff7ed; color: #9a3412; }
.badge.muted { background: #f5f5f5; color: #aaa; font-weight: 400; }
.empty { text-align: center; color: #aaa; padding: 32px; }
.status.lost, .status.declined { background: #f3f4f6; color: #6b7280; }
.status.issued { background: #e0f2fe; color: #0369a1; }
</style>
