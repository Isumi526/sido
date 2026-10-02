<!--
  住所の無い現場（2026-10-02 設計「入力の手間を減らす」I-4・要望14）
  距離の候補（I-5）・高速代の目安（I-6）には現場の住所と位置が要る。住所の無い現場を一覧にして、その場で入れてもらう。
  ★「候補を探す」は現場名で住所を検索して出す（EF site-address-suggest・Google の鍵が入っている時だけ）。
   候補を選ぶと住所と位置（緯度経度）が入る。手で書いた住所は位置なし（距離の候補には使われない）。
  ★住所を書き換えると古い位置は消える（DB のトリガー）。失注の現場は出さない。
-->
<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">住所の無い現場</h1>
      <HelpButton title="住所の無い現場" :items="[
        '住所がまだ入っていない現場の一覧です（失注の現場は出しません）。',
        '「候補を探す」を押すと、現場名から住所の候補が出ます。合っている候補を押すと住所が入り、保存されます。',
        '候補に無い時は、住所を手で入れて「保存」を押してください。',
        '住所と位置は、日報の距離の候補に使います（候補から選んだ住所だけ位置が入ります）。',
      ]" />
    </div>
    <p class="hint">
      日報の距離や高速代の目安を出すには、現場の<strong>住所</strong>が要ります。住所の無い現場をここで入れてください。
      <span v-if="configured === false" data-testid="addresses-no-key">（住所の候補を出す仕組みはまだ準備中です。今は手で入れてください）</span>
    </p>

    <div class="filters">
      <select v-model="statusFilter" class="select" data-testid="addresses-status">
        <option value="open">受注・着工</option>
        <option value="estimating">見積中</option>
        <option value="completed">完了</option>
        <option value="">すべて（失注を除く）</option>
      </select>
      <input v-model="q" class="input filter-input" placeholder="現場名で絞り込み" data-testid="addresses-search" />
      <span class="result-count">{{ filtered.length }} 件</span>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!filtered.length" class="empty" data-testid="addresses-empty">
      {{ q ? '一致する現場がありません。' : 'すべての現場に住所が入っています。' }}
    </div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="addresses-table">
        <thead>
          <tr><th>現場名</th><th>住所</th><th class="actions-col"></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" :data-testid="`addresses-row-${r.id}`">
            <td class="name">{{ r.name }}<span class="sub">{{ STATUS_LABEL[r.status] ?? '' }}</span></td>
            <td>
              <input v-model="draft[r.id]" class="input addr-input" placeholder="例：愛知県名古屋市中区栄3-1-1" :data-testid="`addresses-input-${r.id}`" @keydown.enter.prevent="save(r)" />
              <ul v-if="candidates[r.id]?.length" class="cands" :data-testid="`addresses-cands-${r.id}`">
                <li v-for="(c, ci) in candidates[r.id]" :key="ci">
                  <button type="button" class="cand" :data-testid="`addresses-cand-${r.id}-${ci}`" @click="pick(r, c)">
                    <span class="cand-name">{{ c.name }}</span><span class="cand-addr">{{ c.address }}</span>
                  </button>
                </li>
              </ul>
              <div v-if="candidates[r.id] && !candidates[r.id].length" class="row-note">候補が見つかりませんでした。手で入れてください。</div>
              <div v-if="errors[r.id]" class="row-error">{{ errors[r.id] }}</div>
            </td>
            <td class="actions-col">
              <button v-if="configured" class="btn-ghost" :disabled="searching[r.id]" :data-testid="`addresses-suggest-${r.id}`" @click="suggest(r)">{{ searching[r.id] ? '探しています…' : '候補を探す' }}</button>
              <button class="btn-primary" :disabled="saving[r.id] || !(draft[r.id] ?? '').trim()" :data-testid="`addresses-save-${r.id}`" @click="save(r)">{{ saving[r.id] ? '保存中…' : '保存' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'

type Row = { id: string; name: string; status: string; location: string | null }
type Cand = { name: string; address: string; lat: number | null; lng: number | null }
const STATUS_LABEL: Record<string, string> = { estimating: '見積中', ordered: '受注', in_progress: '着工', completed: '完了' }

const loading = ref(true)
const rows = ref<Row[]>([])
const statusFilter = ref('open')
const q = ref('')
const draft = ref<Record<string, string>>({})
const saving = ref<Record<string, boolean>>({})
const searching = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})
const candidates = ref<Record<string, Cand[]>>({})
const configured = ref<boolean | null>(null)

const filtered = computed(() => rows.value.filter((r) => {
  if ((r.location ?? '').trim()) return false
  if (statusFilter.value === 'open' && !['ordered', 'in_progress'].includes(r.status)) return false
  if (statusFilter.value && statusFilter.value !== 'open' && r.status !== statusFilter.value) return false
  return !q.value || r.name.includes(q.value.trim())
}))

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const { data } = await supabase.from('sites').select('id, name, status, location')
    .eq('account_id', accountId).neq('status', 'lost').neq('name', '__unset__').order('name')
  rows.value = (data ?? []) as Row[]
  loading.value = false
  const r = await supabase.functions.invoke('site-address-suggest', { body: { action: 'status' } })
  configured.value = !!(r.data as any)?.configured
}

async function suggest(r: Row) {
  searching.value[r.id] = true
  errors.value[r.id] = ''
  try {
    const { data, error } = await supabase.functions.invoke('site-address-suggest', { body: { action: 'search', query: r.name } })
    if (error || !(data as any)?.ok) { errors.value[r.id] = '候補を出せませんでした。手で入れてください'; return }
    candidates.value[r.id] = (data as any).candidates ?? []
  } finally {
    searching.value[r.id] = false
  }
}

/** 候補を選ぶ＝住所と位置を入れて保存 */
async function pick(r: Row, c: Cand) {
  draft.value[r.id] = c.address
  await save(r, c)
}

async function save(r: Row, cand?: Cand) {
  const v = (draft.value[r.id] ?? '').trim()
  if (!v) return
  saving.value[r.id] = true
  errors.value[r.id] = ''
  try {
    const patch: Record<string, unknown> = { location: v }
    if (cand && cand.lat != null && cand.lng != null) Object.assign(patch, { lat: cand.lat, lng: cand.lng, geocoded_at: new Date().toISOString() })
    const { data, error } = await supabase.from('sites').update(patch).eq('id', r.id).select('id')
    if (error || !data?.length) { errors.value[r.id] = '保存できませんでした。もう一度お試しください'; return }
    r.location = v
  } finally {
    saving.value[r.id] = false
  }
}

onMounted(load)
</script>

<style scoped>
.name { font-weight: 600; }
.sub { margin-left: 8px; font-size: 11px; font-weight: 400; color: #94a3b8; }
.actions-col { white-space: nowrap; width: 1%; }
.actions-col .btn-ghost { margin-right: 6px; }
.addr-input { width: 100%; min-width: 260px; box-sizing: border-box; }
.row-error { margin-top: 4px; font-size: 12px; color: #b91c1c; }
.row-note { margin-top: 4px; font-size: 12px; color: #64748b; }
.cands { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cand { display: flex; flex-direction: column; align-items: flex-start; width: 100%; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; cursor: pointer; text-align: left; }
.cand:hover { border-color: #06C755; background: #f0fdf4; }
.cand-name { font-size: 13px; font-weight: 700; color: #1f2937; }
.cand-addr { font-size: 12px; color: #475569; }
</style>
