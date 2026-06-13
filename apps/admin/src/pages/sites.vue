<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>現場名</th><th>読み仮名</th><th>状態</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in sites" :key="s.id" :class="{ inactive: !s.active }">
            <td class="name">{{ s.name }}</td>
            <td class="kana">{{ s.name_kana || '—' }}</td>
            <td><span class="status" :class="s.active ? 'active' : 'off'">{{ s.active ? '有効' : '無効' }}</span></td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(s)">編集</button>
              <button class="btn-toggle" @click="toggleActive(s)">{{ s.active ? '無効化' : '有効化' }}</button>
              <button class="btn-rules" @click="router.push(`/site-rules?site_id=${s.id}`)">ルール・QR設定</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '現場を編集' : '現場を追加' }}</h2>
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
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { findSimilarSiteNames } from '../lib/siteSimilarity'

const router = useRouter()

type Site = { id: string; name: string; name_kana: string | null; active: boolean }

const sites     = ref<Site[]>([])
const modal     = ref<Partial<Site> | null>(null)
const saving    = ref(false)
const saveError = ref('')

// 入力中の現場名に「似た」既存現場（自分自身=編集中のidは除外）。重複登録の気づき用。
const similarSites = computed(() =>
  modal.value
    ? findSimilarSiteNames(modal.value.name ?? '', sites.value.filter((s) => s.id !== modal.value!.id).map((s) => s.name))
    : [],
)

async function load() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('sites')
    .select('id, name, name_kana, active')
    .eq('account_id', accountId)
    .order('name_kana', { nullsFirst: false })
    .order('name')
  sites.value = (data ?? []) as Site[]
}
onMounted(load)

function openAdd()        { modal.value = { name: '', name_kana: '' }; saveError.value = '' }
function openEdit(s: Site) { modal.value = { ...s };   saveError.value = '' }

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '現場名を入力してください'; return }
  saving.value = true; saveError.value = ''
  try {
    const kana = modal.value.name_kana?.trim() || null
    if (modal.value.id) {
      await supabase.from('sites').update({ name: modal.value.name.trim(), name_kana: kana }).eq('id', modal.value.id)
    } else {
      const accountId = await getAccountId()
      await supabase.from('sites').insert({ name: modal.value.name!.trim(), name_kana: kana, account_id: accountId })
    }
    modal.value = null; await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally { saving.value = false }
}

async function toggleActive(s: Site) {
  await supabase.from('sites').update({ active: !s.active }).eq('id', s.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
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
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 360px; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.dup-warn { margin-top: 6px; font-size: 12px; color: #B45309; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 6px; padding: 8px 10px; line-height: 1.5; }
.dup-warn strong { color: #92400E; }
</style>
