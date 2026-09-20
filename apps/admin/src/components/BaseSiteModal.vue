<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" data-testid="base-site-modal">
      <h2>{{ form.id ? '拠点を編集' : '拠点を登録' }}</h2>
      <p class="hint">
        オフィス・工場などの拠点です。現場に紐づかない経費の紐付け先・作業員の所属拠点・道具の保管場所の拠点になります。
        工程管理やスケジュール管理の候補には出ません。
      </p>
      <div class="field">
        <label>名前 <span class="req">必須</span></label>
        <input v-model="form.name" class="input" data-testid="base-site-name" placeholder="例：事務所（名古屋）・東京オフィス・工場" />
      </div>
      <div class="row2">
        <div class="field">
          <label>区分</label>
          <select v-model="form.kind" class="input" data-testid="base-site-kind">
            <option value="office">オフィス（事務所）</option>
            <option value="factory">工場</option>
          </select>
        </div>
        <div v-if="form.id" class="field">
          <label>有効</label>
          <div class="toggle">
            <button :class="{ active: form.active !== false }" @click="form.active = true">有効</button>
            <button :class="{ active: form.active === false }" @click="form.active = false">無効</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>住所（任意）</label>
        <input v-model="form.location" class="input" data-testid="base-site-location" placeholder="例：名古屋市〇〇区〇〇1-2-3" />
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button class="btn-save" :disabled="saving" data-testid="base-site-save" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
        <button class="btn-cancel" @click="$emit('close')">キャンセル</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 拠点（オフィス・工場）の登録/編集モーダル。
 *  保存先は現場マスタ（sites）の kind = office / factory 行（2026-09-13 決定: 別テーブルを作らず sites.kind で持つ）。
 *  導線は「自社情報 › 拠点」と「道具管理」から（2026-09-19 レビュー指摘: 拠点を現場マスタから作らせるのは不自然）。
 *  現場（kind=site）と同じ行なので、現場別集計・経費申請の紐付け・所属拠点がそのまま使える。
 */
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

export type BaseSite = { id?: string; name: string; kind: 'office' | 'factory'; location?: string | null; active?: boolean }

const props = defineProps<{ site?: BaseSite | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', id: string): void }>()

const form = ref<BaseSite>({ name: '', kind: 'office', location: '', active: true })
watch(() => props.site, (s) => { form.value = s ? { ...s, location: s.location ?? '' } : { name: '', kind: 'office', location: '', active: true } }, { immediate: true })
const saving = ref(false)
const error = ref('')

async function save() {
  const name = form.value.name.trim()
  if (!name) { error.value = '名前を入力してください。'; return }
  saving.value = true; error.value = ''
  try {
    const accountId = await getAccountId()
    const payload = { name, kind: form.value.kind, location: form.value.location?.trim() || null, active: form.value.active !== false }
    if (form.value.id) {
      const { error: e } = await supabase.from('sites').update(payload).eq('id', form.value.id).eq('account_id', accountId)
      if (e) throw e
      emit('saved', form.value.id)
    } else {
      // 同名の拠点があれば作らない（連打・別画面からの二重登録を防ぐ）
      const { data: dup } = await supabase.from('sites').select('id').eq('account_id', accountId).eq('name', name).in('kind', ['office', 'factory']).limit(1)
      if (dup?.length) { error.value = '同じ名前の拠点が既にあります。'; return }
      const { data, error: e } = await supabase.from('sites').insert({ ...payload, account_id: accountId }).select('id').single()
      if (e) throw e
      emit('saved', (data as any).id as string)
    }
  } catch (e: any) { error.value = e?.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 110; }
.modal { background: #fff; border-radius: 12px; padding: 28px; width: 440px; max-width: 95vw; display: flex; flex-direction: column; gap: 16px; max-height: 92vh; overflow: auto; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0; }
.hint { font-size: 12px; color: #94a3b8; margin: 0; line-height: 1.6; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.req { color: #E53935; font-size: 11px; margin-left: 4px; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; margin: 0; }
</style>
