<!--
  読み仮名の未入力（2026-10-02 設計「見やすさと分かりやすさ」II-3・要望16）
  作業員アプリを英語で使う作業員さんには、名前が読み仮名からローマ字で出る（II-2）。
  読み仮名の無い名前は日本語のまま出るので、ここで未入力のものを一覧にして、その場で入れてもらう。
  ★対象: 現場（失注を除く）・元請け業者・協力業者（削除済みを除く）・作業区分（元請けには削除の印が無いので全件）
  ★作業区分は RLS で直接書けないので EF(master-data の category-kana-save) を通す。他は画面と同じく直接更新
-->
<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">読み仮名の未入力</h1>
      <HelpButton title="読み仮名の未入力" :items="[
        '読み仮名がまだ入っていない現場・業者・作業区分の一覧です。',
        '欄に読み仮名（ひらがな・カタカナ）を入れて「保存」を押すと、一覧から消えます。',
        '作業員アプリを英語で使う人には、読み仮名をもとに名前がローマ字で表示されます（例：山田内装 → Yamada Naisou）。読み仮名が無いものは日本語のまま表示されます。',
      ]" />
    </div>
    <p class="hint">
      作業員アプリを英語で使う作業員さんには、名前が<strong>読み仮名からローマ字</strong>で表示されます。
      読み仮名が無い名前は日本語のまま出るので、ここで入れてください。
    </p>

    <div class="filters">
      <button
        v-for="k in KINDS" :key="k.key" type="button" class="kind-tab" :class="{ on: kind === k.key }"
        :data-testid="`readings-tab-${k.key}`" @click="kind = k.key"
      >{{ k.label }}<span class="kind-count">{{ missingOf(k.key).length }}</span></button>
      <input v-model="q" class="input filter-input" placeholder="名前で絞り込み" data-testid="readings-search" />
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!filtered.length" class="empty" data-testid="readings-empty">
      {{ q ? '一致するものがありません。' : 'すべて読み仮名が入っています。' }}
    </div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="readings-table">
        <thead>
          <tr><th>名前</th><th>読み仮名</th><th class="actions-col"></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" :data-testid="`readings-row-${r.id}`">
            <td class="name">{{ r.name }}<span v-if="r.sub" class="sub">{{ r.sub }}</span></td>
            <td>
              <input
                v-model="draft[r.id]" class="input kana-input" placeholder="例：やまだないそう"
                :data-testid="`readings-input-${r.id}`" @keydown.enter.prevent="save(r)"
              />
              <div v-if="errors[r.id]" class="row-error" :data-testid="`readings-error-${r.id}`">{{ errors[r.id] }}</div>
            </td>
            <td class="actions-col">
              <button
                class="btn-primary" :disabled="saving[r.id] || !(draft[r.id] ?? '').trim()"
                :data-testid="`readings-save-${r.id}`" @click="save(r)"
              >{{ saving[r.id] ? '保存中…' : '保存' }}</button>
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

type Kind = 'sites' | 'contractors' | 'subcontractors' | 'categories'
type Row = { id: string; kind: Kind; name: string; sub?: string; name_kana: string | null }

const KINDS: { key: Kind; label: string }[] = [
  { key: 'sites', label: '現場' },
  { key: 'contractors', label: '元請け業者' },
  { key: 'subcontractors', label: '協力業者' },
  { key: 'categories', label: '作業区分' },
]
const STATUS_LABEL: Record<string, string> = { estimating: '見積中', ordered: '受注', in_progress: '着工', completed: '完了' }

const loading = ref(true)
const rows = ref<Row[]>([])
const kind = ref<Kind>('sites')
const q = ref('')
const draft = ref<Record<string, string>>({})
const saving = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})

const missingOf = (k: Kind) => rows.value.filter(r => r.kind === k && !(r.name_kana ?? '').trim())
const filtered = computed(() => missingOf(kind.value).filter(r => !q.value || r.name.includes(q.value.trim())))

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const [sites, cons, subs, cats] = await Promise.all([
    supabase.from('sites').select('id, name, name_kana, status').eq('account_id', accountId).neq('status', 'lost').order('name'),
    supabase.from('contractors').select('id, name, name_kana').eq('account_id', accountId).order('name'),
    supabase.from('subcontractors').select('id, name, name_kana').eq('account_id', accountId).eq('is_deleted', false).order('name'),
    supabase.functions.invoke('master-data', { body: { action: 'categories' } }),
  ])
  rows.value = [
    ...((sites.data ?? []) as any[]).map(s => ({ id: s.id, kind: 'sites' as Kind, name: s.name, sub: STATUS_LABEL[s.status] ?? '', name_kana: s.name_kana })),
    ...((cons.data ?? []) as any[]).map(c => ({ id: c.id, kind: 'contractors' as Kind, name: c.name, name_kana: c.name_kana })),
    ...((subs.data ?? []) as any[]).map(c => ({ id: c.id, kind: 'subcontractors' as Kind, name: c.name, name_kana: c.name_kana })),
    ...(((cats.data as any)?.categories ?? []) as any[]).map(c => ({ id: c.id, kind: 'categories' as Kind, name: c.name, name_kana: c.name_kana ?? null })),
  ]
  loading.value = false
}

/** 読み仮名として受け付けるか（ひらがな・カタカナ・長音・空白・英数字）。漢字が入っていたら止める */
function kanaError(v: string): string {
  if (/[㐀-鿿]/.test(v)) return 'ひらがな・カタカナで入れてください（漢字は使えません）'
  if (!/[぀-ヿ]/.test(v) && !/^[A-Za-z0-9 .&'-]+$/.test(v)) return 'ひらがな・カタカナで入れてください'
  return ''
}

async function save(r: Row) {
  const v = (draft.value[r.id] ?? '').trim()
  if (!v) return
  const err = kanaError(v)
  errors.value[r.id] = err
  if (err) return
  saving.value[r.id] = true
  try {
    let ok = false
    if (r.kind === 'categories') {
      const { data, error } = await supabase.functions.invoke('master-data', { body: { action: 'category-kana-save', id: r.id, nameKana: v } })
      ok = !error && !!(data as any)?.ok
    } else {
      const { data, error } = await supabase.from(r.kind).update({ name_kana: v }).eq('id', r.id).select('id')
      ok = !error && !!data?.length
    }
    if (!ok) { errors.value[r.id] = '保存できませんでした。もう一度お試しください'; return }
    r.name_kana = v
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
.kana-input { width: 100%; min-width: 220px; box-sizing: border-box; }
.row-error { margin-top: 4px; font-size: 12px; color: #b91c1c; }
.kind-tab {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 14px;
  font-size: 13px; color: #334155; cursor: pointer;
}
.kind-tab.on { background: #06C755; border-color: #06C755; color: #fff; font-weight: 700; }
.kind-count {
  min-width: 20px; padding: 0 6px; border-radius: 999px; background: #f1f5f9; color: #475569;
  font-size: 11px; font-weight: 700; text-align: center;
}
.kind-tab.on .kind-count { background: rgba(255, 255, 255, .25); color: #fff; }
</style>
