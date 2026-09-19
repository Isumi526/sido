<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" data-testid="site-status-modal">
      <h2>{{ sites.length === 1 ? `「${sites[0].name}」を${SITE_STATUS_LABEL[next]}にする` : `${sites.length}件を${SITE_STATUS_LABEL[next]}にする` }}</h2>
      <p v-if="missing.length" class="req-warn" data-testid="site-status-missing">
        {{ SITE_STATUS_LABEL[next] }}にするには {{ missing.join('・') }} が必要です。「編集」から入力してください。
      </p>
      <template v-else>
        <div v-if="next === 'completed'" class="field">
          <label>終了日（実績）</label>
          <input v-model="endDate" type="date" class="input" style="width:auto" data-testid="site-status-end-date" />
          <p class="hint">工期の終了日として保存されます。日報・集計はそのまま残ります。</p>
        </div>
        <div v-else-if="next === 'lost'" class="field">
          <label>失注の理由（任意）</label>
          <input v-model="reason" class="input" placeholder="例：他社が安かった／計画中止" data-testid="site-status-lost-reason" />
          <p class="hint">見積の参考データとして残ります。日報や予定の現場候補には出なくなります。</p>
        </div>
        <p v-else class="hint">{{ isOpenSiteStatus(next) ? '日報・予定・工程管理などの現場候補に出るようになります。' : '日報や予定の現場候補に出なくなります。過去の日報・集計はそのまま残ります。' }}</p>
      </template>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button v-if="!missing.length" class="btn-save" :disabled="saving || (next === 'completed' && !endDate)" data-testid="site-status-confirm" @click="apply">{{ saving ? '変更中...' : '変更する' }}</button>
        <button class="btn-cancel" @click="$emit('close')">{{ missing.length ? '閉じる' : 'キャンセル' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 現場のステータス変更モーダル（2026-09-19 A-1）。現場マスタ一覧（単体・一括）と現場詳細から使う。
 *  ・完了 → 終了日（実績・既定＝今日）を聞く（既に入っていれば触らない）
 *  ・失注 → 理由（任意）を聞く
 *  ・その段階の必須項目（shared/site-status.ts）が揃っていない現場があれば止めて「編集から入力」を促す
 *  ・変更は operation_logs に必ず残す。active は DB トリガが status から導出するので status だけ書く
 */
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { logOperation } from '../lib/operationLog'
import { todayStr } from '../lib/schedule-core.gen'
import { SITE_STATUS_LABEL, SITE_REQUIRED_FIELD_LABEL, missingSiteFields, isOpenSiteStatus } from '../lib/site-status.gen'
import type { SiteStatus } from '../lib/site-status.gen'

export type SiteForStatus = {
  id: string; name: string; status: SiteStatus
  location?: string | null; period_start?: string | null; period_end?: string | null; responsible_worker_id?: string | null; kind?: string | null
}

const props = defineProps<{ sites: SiteForStatus[]; next: SiteStatus }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const endDate = ref(todayStr())
const reason = ref('')
const saving = ref(false)
const error = ref('')

// 完了の終了日はこのモーダルで入れるので必須判定から除く
const missing = computed(() => {
  const set = new Set<string>()
  for (const s of props.sites) {
    for (const f of missingSiteFields(props.next, s)) {
      if (props.next === 'completed' && f === 'period_end') continue
      set.add(SITE_REQUIRED_FIELD_LABEL[f])
    }
  }
  return [...set]
})

async function apply() {
  saving.value = true; error.value = ''
  try {
    for (const s of props.sites) {
      const patch: Record<string, unknown> = { status: props.next }
      if (props.next === 'completed' && !s.period_end) patch.period_end = endDate.value
      if (props.next === 'lost') patch.lost_reason = reason.value.trim() || null
      const { error: e } = await supabase.from('sites').update(patch).eq('id', s.id)
      if (e) throw new Error(`「${s.name}」のステータス変更に失敗しました: ${e.message}`)
      await logOperation(`現場を${SITE_STATUS_LABEL[props.next]}に変更`, {
        targetType: 'site', targetId: s.id, summary: `${s.name}（${SITE_STATUS_LABEL[s.status]}→${SITE_STATUS_LABEL[props.next]}）`,
      })
    }
    emit('done')
  } catch (e: any) {
    error.value = e?.message ?? 'ステータス変更に失敗しました'
  } finally { saving.value = false }
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 110; }
.modal { background: #fff; border-radius: 12px; padding: 28px; width: 440px; max-width: 95vw; display: flex; flex-direction: column; gap: 16px; max-height: 92vh; overflow: auto; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0; }
.hint { font-size: 12px; color: #64748b; margin: 4px 0 0; line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; font-size: 14px; }
.req-warn { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px; margin: 0; }
.error { color: #E53935; font-size: 13px; margin: 0; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; cursor: default; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 10px 24px; cursor: pointer; }
</style>
