<template>
  <div>
    <div v-if="!embedded" class="page-header">
      <h1 class="page-title">自社情報</h1>
    </div>
    <p class="hint">見積書・発注書PDFの発行元（自社）情報です。見積書の表紙・内訳書の計算に使われます。</p>

    <div class="card">
      <h2>会社情報</h2>
      <div class="grid2">
        <div class="field"><label>会社名</label><input v-model="f.company_name" class="input" data-testid="cp-name" placeholder="例: 株式会社〇〇" /></div>
        <div class="field"><label>代表者（役職＋氏名）</label><input v-model="f.company_rep" class="input" placeholder="例: 代表取締役 〇〇 〇〇" /></div>
        <div class="field span2"><label>住所</label><input v-model="f.company_address" class="input" placeholder="例: 〇〇市〇〇区〇〇1-2-3" /></div>
        <div class="field"><label>TEL</label><input v-model="f.company_tel" class="input" placeholder="例: 00-0000-0000" /></div>
        <div class="field"><label>FAX</label><input v-model="f.company_fax" class="input" placeholder="例: 00-0000-0000" /></div>
      </div>
      <div class="field">
        <label>印影（任意・見積書の社判欄に表示）</label>
        <div class="seal-row">
          <img v-if="sealUrl" :src="sealUrl" class="seal-preview" alt="印影" />
          <label class="btn-ghost">
            {{ uploadingSeal ? 'アップロード中…' : '画像を選択' }}
            <input type="file" accept="image/*" hidden :disabled="uploadingSeal" @change="onSeal" />
          </label>
          <button v-if="f.company_seal_path" class="btn-ghost danger" @click="f.company_seal_path = ''">削除</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>見積書の既定値・計算</h2>
      <div class="grid2">
        <div class="field"><label>法定福利費 料率A（%）</label><input v-model.number="f.welfare_rate_a" type="number" class="input" placeholder="23" /></div>
        <div class="field"><label>法定福利費 料率B（%）</label><input v-model.number="f.welfare_rate_b" type="number" class="input" placeholder="15" /></div>
        <div class="field"><label>消費税率（%）</label><input v-model.number="f.tax_rate" type="number" class="input" placeholder="10" /></div>
        <div class="field"><label>見積有効期限（既定）</label><input v-model="f.estimate_valid_until" class="input" placeholder="次回変更まで、もしくは3ヶ月" /></div>
        <div class="field span2"><label>支払条件</label><textarea v-model="f.estimate_payment_terms" class="input" rows="2" placeholder="支払条件を入力"></textarea></div>
        <div class="field span2"><label>別途工事の注記</label><input v-model="f.estimate_separate_note" class="input" placeholder="※見積書に記載なき工事は別途" /></div>
      </div>
      <p class="muted">法定福利費＝小計 × 料率A% × 料率B%（例: 小計×23%×15%）。合計(税抜)＝小計＋法定福利費＋端数調整。消費税＝合計(税抜)×消費税率%。</p>
    </div>

    <div class="actions-row">
      <button class="btn-save" :disabled="saving" data-testid="cp-save" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      <span v-if="savedMsg" class="ok">{{ savedMsg }}</span>
      <span v-if="err" class="err">{{ err }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

defineProps<{ embedded?: boolean }>()

const BUCKET = 'expense-receipts'
// settings の key と日本語ラベル（settings.label が NOT NULL のため必須）
const LABELS: Record<string, string> = {
  company_name: '会社名', company_rep: '代表者', company_address: '住所', company_tel: 'TEL', company_fax: 'FAX',
  company_seal_path: '印影パス', welfare_rate_a: '法定福利費率A', welfare_rate_b: '法定福利費率B', tax_rate: '消費税率',
  estimate_valid_until: '見積有効期限(既定)', estimate_payment_terms: '支払条件', estimate_separate_note: '別途工事注記',
}
type Form = {
  company_name: string; company_rep: string; company_address: string; company_tel: string; company_fax: string
  company_seal_path: string; welfare_rate_a: number; welfare_rate_b: number; tax_rate: number
  estimate_valid_until: string; estimate_payment_terms: string; estimate_separate_note: string
}
const f = ref<Form>({
  company_name: '', company_rep: '', company_address: '', company_tel: '', company_fax: '',
  company_seal_path: '', welfare_rate_a: 23, welfare_rate_b: 15, tax_rate: 10,
  estimate_valid_until: '次回変更まで、もしくは3ヶ月', estimate_payment_terms: '', estimate_separate_note: '※見積書に記載なき工事は別途',
})
const saving = ref(false); const savedMsg = ref(''); const err = ref(''); const uploadingSeal = ref(false)
let accountId = ''

const sealUrl = computed(() => f.value.company_seal_path ? supabase.storage.from(BUCKET).getPublicUrl(f.value.company_seal_path).data.publicUrl : '')

async function load() {
  accountId = await getAccountId()
  const { data } = await supabase.from('settings').select('key, value').eq('account_id', accountId).in('key', Object.keys(LABELS))
  const m = Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
  for (const k of Object.keys(f.value) as (keyof Form)[]) {
    if (m[k] === undefined) continue
    if (k === 'welfare_rate_a' || k === 'welfare_rate_b' || k === 'tax_rate') (f.value[k] as number) = Number(m[k]) || 0
    else (f.value[k] as string) = m[k]
  }
}
onMounted(load)

async function onSeal(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingSeal.value = true; err.value = ''
  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `company/${accountId}/seal-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
    if (error) throw error
    f.value.company_seal_path = path
  } catch (e: any) { err.value = e?.message ?? '印影のアップロードに失敗しました' }
  finally { uploadingSeal.value = false; (e.target as HTMLInputElement).value = '' }
}

async function save() {
  saving.value = true; err.value = ''; savedMsg.value = ''
  try {
    const rows = (Object.keys(LABELS) as (keyof Form)[]).map((k) => ({
      account_id: accountId, key: k as string, label: LABELS[k as string], value: String(f.value[k] ?? ''),
    }))
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'account_id,key' })
    if (error) throw error
    savedMsg.value = '保存しました'; setTimeout(() => (savedMsg.value = ''), 2500)
  } catch (e: any) { err.value = e?.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}
</script>

<style scoped>
.page-header { margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { color: #777; margin-bottom: 16px; font-size: 13px; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.card h2 { font-size: 15px; margin: 0 0 14px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.span2 { grid-column: 1 / -1; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 12px; font-size: 14px; width: 100%; box-sizing: border-box; }
.seal-row { display: flex; align-items: center; gap: 12px; }
.seal-preview { width: 64px; height: 64px; object-fit: contain; border: 1px solid #eee; border-radius: 8px; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer; }
.btn-ghost.danger { color: #c0392b; border-color: #f0caca; }
.actions-row { display: flex; align-items: center; gap: 14px; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px 28px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.muted { color: #888; font-size: 12px; margin-top: 10px; }
.ok { color: #06864a; font-size: 13px; }
.err { color: #c00; font-size: 13px; }
</style>
