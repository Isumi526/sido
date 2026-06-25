<template>
  <div class="site-detail">
    <div class="page-header">
      <div>
        <button class="btn-back" @click="router.push('/sites')">← 現場マスタ</button>
        <h1 class="page-title">{{ site?.name || '現場' }}<span v-if="site?.name_kana" class="kana">{{ site.name_kana }}</span></h1>
      </div>
      <div class="header-actions" v-if="site">
        <span class="status" :class="site.active ? 'active' : 'off'">{{ site.active ? '有効' : '無効' }}</span>
        <button class="btn-ghost" @click="router.push('/sites')">編集</button>
        <button class="btn-ghost" @click="router.push(`/site-rules?site_id=${site.id}`)">ルール・QR設定</button>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!site" class="empty">現場が見つかりません</div>
    <template v-else>
      <!-- 概要サマリ -->
      <div class="summary-cards">
        <div class="sum-card"><div class="sum-label">日報（90日）</div><div class="sum-val">{{ stats.count }}</div></div>
        <div class="sum-card"><div class="sum-label">直近日報</div><div class="sum-val sm">{{ stats.lastDate || '—' }}</div></div>
        <div class="sum-card"><div class="sum-label">紐づく下請け</div><div class="sum-val">{{ linkedSubs.length }}</div></div>
        <div class="sum-card"><div class="sum-label">見積/注文書</div><div class="sum-val sm">{{ estimates.length }} / {{ orders.length }}</div></div>
      </div>

      <!-- 基本情報 -->
      <section class="card">
        <h2 class="card-title">基本情報</h2>
        <dl class="kv">
          <div class="kv-row"><dt>元請け</dt><dd>{{ contractorName || '—' }}</dd></div>
          <div class="kv-row"><dt>住所</dt><dd>
            <template v-if="site.location">{{ site.location }}
              <a :href="mapUrl" target="_blank" rel="noopener" class="map-link">🗺 地図で開く</a>
            </template><template v-else>—</template>
          </dd></div>
          <div class="kv-row"><dt>工種</dt><dd>{{ site.construction_type || '—' }}</dd></div>
          <div class="kv-row"><dt>工事内容</dt><dd class="pre">{{ site.construction_details || '—' }}</dd></div>
          <div class="kv-row"><dt>メモ</dt><dd class="pre">{{ site.memo || '—' }}</dd></div>
        </dl>
      </section>

      <!-- 紐づく下請け -->
      <section class="card">
        <h2 class="card-title">紐づく協力業者（{{ linkedSubs.length }}）</h2>
        <div v-if="linkedSubs.length" class="chips">
          <span v-for="s in linkedSubs" :key="s.id" class="chip">{{ s.name }}<span v-if="s.category" class="chip-cat">{{ s.category }}</span></span>
        </div>
        <p v-else class="muted">紐づく協力業者はありません</p>
      </section>

      <!-- 見積書 -->
      <section class="card">
        <h2 class="card-title">見積書（{{ estimates.length }}）</h2>
        <table v-if="estimates.length" class="mini-table">
          <thead><tr><th>見積番号</th><th>日付</th><th class="num">金額</th><th>PDF</th></tr></thead>
          <tbody>
            <tr v-for="e in estimates" :key="e.id">
              <td>{{ e.estimate_number || '—' }}</td><td>{{ e.estimate_date || '—' }}</td>
              <td class="num">{{ e.total_amount != null ? `¥${e.total_amount.toLocaleString()}` : '—' }}</td>
              <td><a v-if="e.pdf_path" :href="estPdfUrl(e.pdf_path)" target="_blank" rel="noopener" class="pdf-link">📄</a><span v-else class="muted">—</span></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">見積書はありません</p>
      </section>

      <!-- 注文書 -->
      <section class="card">
        <h2 class="card-title">注文書（{{ orders.length }}）</h2>
        <table v-if="orders.length" class="mini-table">
          <thead><tr><th>注文書番号</th><th>受注者</th><th class="num">金額</th><th>状態</th></tr></thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id">
              <td>{{ o.order_number }}</td><td>{{ o.vendor_name || '—' }}</td>
              <td class="num">{{ o.total_amount != null ? `¥${o.total_amount.toLocaleString()}` : '—' }}</td>
              <td><span class="status sm" :class="o.status === 'accepted' ? 'active' : 'off'">{{ o.status === 'accepted' ? '承諾済' : '未承諾' }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">注文書はありません</p>
      </section>

      <!-- 関連日報 -->
      <section class="card">
        <h2 class="card-title">関連日報（直近{{ reports.length }}件）</h2>
        <table v-if="reports.length" class="mini-table">
          <thead><tr><th>日付</th><th>作業員</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in reports" :key="i"><td>{{ r.date }}</td><td>{{ r.workers || '—' }}</td></tr>
          </tbody>
        </table>
        <p v-else class="muted">関連する日報はありません（直近180日）</p>
      </section>

      <!-- 添付 -->
      <section class="card">
        <h2 class="card-title">添付（{{ attachments.length }}）</h2>
        <div v-if="attachments.length" class="att-list">
          <button v-for="a in attachments" :key="a.id" class="att-link" @click="openAttachment(a.id)">📎 {{ a.name || a.kind || 'ファイル' }}</button>
        </div>
        <p v-else class="muted">添付はありません</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const route = useRoute()
const router = useRouter()
const siteId = String(route.params.id ?? '')

type Site = { id: string; name: string; name_kana: string | null; active: boolean; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null; contractor_id: string | null }
const site = ref<Site | null>(null)
const contractorName = ref('')
const linkedSubs = ref<{ id: string; name: string; category: string | null }[]>([])
const estimates = ref<any[]>([])
const orders = ref<any[]>([])
const reports = ref<{ date: string; workers: string }[]>([])
const attachments = ref<{ id: string; kind: string; name: string | null }[]>([])
const stats = ref<{ count: number; lastDate: string }>({ count: 0, lastDate: '' })
const loading = ref(true)

const ESTIMATE_BUCKET = 'expense-receipts'
function estPdfUrl(path: string) { return supabase.storage.from(ESTIMATE_BUCKET).getPublicUrl(path).data.publicUrl }
const mapUrl = computed(() => site.value?.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.value.location)}` : '#')

async function openAttachment(attachmentId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('site-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) { alert('添付を開けませんでした'); return }
    window.open(data.url as string, '_blank', 'noopener')
  } catch { alert('添付を開けませんでした') }
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data: s } = await supabase.from('sites')
    .select('id, name, name_kana, active, location, construction_type, construction_details, memo, contractor_id')
    .eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (s as Site) ?? null
  if (!site.value) { loading.value = false; return }

  if (site.value.contractor_id) {
    const { data: c } = await supabase.from('contractors').select('name').eq('id', site.value.contractor_id).maybeSingle()
    contractorName.value = c?.name ?? ''
  }
  // 紐づく下請け
  const { data: links } = await supabase.from('site_subcontractors').select('subcontractor_id').eq('site_id', siteId)
  const subIds = ((links ?? []) as any[]).map(l => l.subcontractor_id)
  if (subIds.length) {
    const { data: subs } = await supabase.from('subcontractors').select('id, name, category').in('id', subIds)
    linkedSubs.value = (subs ?? []) as any[]
  }
  // 見積書・注文書
  const [{ data: est }, { data: po }] = await Promise.all([
    supabase.from('estimates').select('id, estimate_number, estimate_date, total_amount, pdf_path').eq('site_id', siteId).eq('is_deleted', false).order('estimate_date', { ascending: false, nullsFirst: false }),
    supabase.from('purchase_orders').select('id, order_number, vendor_name, total_amount, status').eq('site_id', siteId).eq('is_deleted', false).order('order_number', { ascending: false }),
  ])
  estimates.value = (est ?? []) as any[]
  orders.value = (po ?? []) as any[]
  // 添付
  const { data: atts } = await supabase.from('site_attachments').select('id, kind, name').eq('site_id', siteId)
  attachments.value = (atts ?? []) as any[]
  // 関連日報（現場名で突合・直近180日）
  const since = new Date(); since.setDate(since.getDate() - 180)
  const { data: reps } = await supabase.from('daily_reports')
    .select('date, sites').eq('account_id', accountId).gte('date', since.toISOString().split('T')[0]).order('date', { ascending: false })
  const rows: { date: string; workers: string }[] = []
  let count = 0, lastDate = ''
  for (const r of (reps ?? []) as any[]) {
    for (const st of (r.sites ?? [])) {
      const nm = (st?.siteName === '__other__' ? st?.customSiteName : st?.siteName)?.trim()
      if (nm !== site.value.name) continue
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
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.btn-back { background: none; border: none; color: #06A050; font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 4px; }
.page-title { font-size: 22px; font-weight: 700; }
.page-title .kana { color: #aaa; font-size: 13px; margin-left: 10px; font-weight: 400; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.btn-ghost { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.sm { font-size: 10px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.empty { color: #888; padding: 40px; text-align: center; }

.summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.sum-card { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.sum-label { font-size: 11px; color: #888; }
.sum-val { font-size: 22px; font-weight: 800; color: #222; }
.sum-val.sm { font-size: 14px; }

.card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-title { font-size: 14px; font-weight: 800; color: #333; margin: 0 0 12px; }
.kv { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.kv-row { display: flex; gap: 12px; font-size: 14px; }
.kv-row dt { color: #888; flex: 0 0 90px; }
.kv-row dd { margin: 0; color: #222; flex: 1; }
.kv-row dd.pre { white-space: pre-wrap; }
.map-link { margin-left: 10px; font-size: 12px; color: #1a56c4; text-decoration: none; }
.muted { color: #aaa; font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: #eef2ff; color: #3a52a8; border-radius: 6px; padding: 4px 10px; font-size: 13px; }
.chip-cat { color: #888; font-size: 11px; margin-left: 6px; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini-table th { text-align: left; color: #888; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #eee; }
.mini-table td { padding: 6px 8px; border-bottom: 1px solid #f3f3f3; }
.mini-table .num { text-align: right; }
.pdf-link { text-decoration: none; }
.att-list { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.att-link { background: #f5f7fa; border: 1px solid #e3e8ef; border-radius: 6px; padding: 6px 12px; font-size: 13px; color: #1a56c4; cursor: pointer; }
@media (max-width: 640px) { .summary-cards { grid-template-columns: repeat(2, 1fr); } }
</style>
