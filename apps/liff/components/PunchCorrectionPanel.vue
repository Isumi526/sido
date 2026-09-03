<template>
  <div class="fix-wrap">
    <button v-if="!open" class="fix-open" data-testid="fix-open" @click="openPanel()">
      <span class="material-symbols-rounded">edit_calendar</span>{{ $t('checkin.fixOpen') }}
    </button>

    <div v-else class="fix-panel" data-testid="fix-panel">
      <div class="fix-title">{{ $t('checkin.fixTitle') }}</div>
      <p class="fix-note">{{ $t('checkin.fixNote') }}</p>

      <div v-if="loading" class="fix-empty">{{ $t('common.loading') }}</div>
      <div v-else-if="!logs.length" class="fix-empty" data-testid="fix-empty">{{ $t('checkin.fixEmpty') }}</div>

      <ul v-else class="fix-list">
        <li v-for="l in logs" :key="l.id" class="fix-item" :class="{ dead: !!l.deleted_at }" :data-testid="`fix-log-${l.id}`">
          <label class="fix-radio">
            <input
              type="radio"
              name="fix-log"
              :value="l.id"
              :disabled="!!l.deleted_at || pendingFor(l.id)"
              :checked="selected === l.id"
              :data-testid="`fix-pick-${l.id}`"
              @change="pick(l.id)"
            />
            <span class="fix-when">{{ fmt(l.checked_at) }}</span>
            <span class="fix-type" :class="l.type">{{ l.type === 'checkin' ? $t('checkin.checkinLabel') : $t('checkin.checkoutLabel') }}</span>
            <span v-if="l.deleted_at" class="fix-tag dead">{{ $t('checkin.fixVoided') }}</span>
            <span v-else-if="pendingFor(l.id)" class="fix-tag pending" :data-testid="`fix-pending-${l.id}`">{{ $t('checkin.fixPending') }}</span>
            <span v-else-if="l.corrected_at" class="fix-tag done">{{ $t('checkin.fixCorrected') }}</span>
          </label>
        </li>
      </ul>

      <template v-if="selected">
        <label class="fix-label">{{ $t('checkin.fixWhat') }}</label>
        <select v-model="kind" class="fix-input" data-testid="fix-kind">
          <option value="type">{{ $t('checkin.fixKindType') }}</option>
          <option value="time">{{ $t('checkin.fixKindTime') }}</option>
          <option value="delete">{{ $t('checkin.fixKindDelete') }}</option>
        </select>

        <template v-if="kind === 'type'">
          <label class="fix-label">{{ $t('checkin.fixCorrectType') }}</label>
          <select v-model="requestedType" class="fix-input" data-testid="fix-type">
            <option value="checkin">{{ $t('checkin.checkinLabel') }}</option>
            <option value="checkout">{{ $t('checkin.checkoutLabel') }}</option>
          </select>
        </template>

        <template v-if="kind === 'time'">
          <label class="fix-label">{{ $t('checkin.fixCorrectTime') }}</label>
          <!-- 5分刻み。後追い入力と同じ刻みにする（実際に働いた時刻を入れる欄なので30分では足りない） -->
          <select v-model="requestedTime" class="fix-input" data-testid="fix-time">
            <option value="">—</option>
            <option v-for="tm in TIME_OPTIONS" :key="tm" :value="tm">{{ tm }}</option>
          </select>
          <p class="fix-hint">{{ $t('checkin.fixTimeSameDay') }}</p>
        </template>

        <label class="fix-label">{{ $t('checkin.fixReason') }}</label>
        <input v-model="reason" type="text" class="fix-input" data-testid="fix-reason"
               :placeholder="$t('checkin.fixReasonPlaceholder')" @keydown.enter.prevent />

        <div class="fix-actions">
          <button class="fix-submit" :disabled="busy" data-testid="fix-submit" @click="submit()">
            {{ busy ? $t('checkin.fixSubmitting') : $t('checkin.fixSubmit') }}
          </button>
          <button class="fix-cancel" data-testid="fix-cancel" @click="open = false">{{ $t('checkin.lateCancel') }}</button>
        </div>
      </template>

      <!-- ★結果の表示は選択ブロックの外に置く。中に置くと、申請後に選択を解除した瞬間に
           成功メッセージごと消えて「押しても何も起きない」ように見える（実装時に踏んだ）。 -->
      <p v-if="error" class="fix-error" data-testid="fix-error">{{ error }}</p>
      <p v-if="done" class="fix-ok" data-testid="fix-done">{{ $t('checkin.fixDone') }}</p>

      <div v-if="!selected" class="fix-actions">
        <button class="fix-cancel" data-testid="fix-close" @click="open = false">{{ $t('checkin.lateCancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  PunchCorrectionPanel — 押し間違えた打刻の修正を申請する
//
//  出所: 2026-09-03 大須賀さん（LINE）
//   「出退勤の打刻間違え打った為修正できますか」
//
//  実データを見ると、間違いは単発では終わらず連鎖する:
//   9/1 朝の出勤を打ち忘れ → 17:58 に退勤しようとしたら画面が「出勤」を出し、押して出勤が記録
//   → 以降アプリは「出勤中」と判断 → 翌朝 8:05 の出勤も「退勤」として記録された。
//  打刻の種別は「直近の最後の打刻」で決まるので、1回ずれると後続が全部ずれる。
//  直す手段が無いと、ずれたまま勤怠が積み上がる。
//
//  ★ここでは打刻を変えない。申請を作るだけで、管理者が承認して初めて直る。
//   打刻は勤怠の証跡（同意したルール文面のスナップショットを持つ）なので、
//   本人が自由に書き換えられるようにはしない＝時刻をサーバが決めているのと同じ理由。
//
//  ★代理では出させない。他人の勤怠を書き換える導線は開けない（後追い入力と同じ方針）。
// ============================================================
import { useI18n } from 'vue-i18n'

const props = defineProps<{ workerId: string | null }>()
const { t } = useI18n()
const attendance = useAttendanceLog()

const TIME_OPTIONS = Array.from({ length: 24 * 12 }, (_, i) =>
  `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`)

type Log = {
  id: string; type: 'checkin' | 'checkout'; checked_at: string
  backdated: boolean | null; deleted_at: string | null; corrected_at: string | null
}

const open    = ref(false)
const loading = ref(false)
const logs    = ref<Log[]>([])
const pendingLogIds = ref<Set<string>>(new Set())
const selected = ref('')
const kind     = ref<'type' | 'time' | 'delete'>('type')
const requestedType = ref<'checkin' | 'checkout'>('checkin')
const requestedTime = ref('')
const reason   = ref('')
const busy     = ref(false)
const error    = ref('')
const done     = ref(false)

const pendingFor = (logId: string) => pendingLogIds.value.has(logId)

function fmt(s: string): string {
  const d = new Date(s)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}（${w}） ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function openPanel() {
  open.value = true
  error.value = ''
  done.value = false
  selected.value = ''
  loading.value = true
  const r = await attendance.correctionMine(7)
  logs.value = r.logs as Log[]
  // 申請中の打刻は選ばせない（同じ打刻に申請を積んでも承認する側が困るだけ）
  pendingLogIds.value = new Set(r.requests.filter(q => q.status === 'pending').map(q => q.log_id))
  loading.value = false
}

function pick(logId: string) {
  selected.value = logId
  error.value = ''
  done.value = false
  const l = logs.value.find(x => x.id === logId)
  // 押し間違いが一番多いので、既定は「反対の種別に直す」を入れておく
  if (l) {
    requestedType.value = l.type === 'checkin' ? 'checkout' : 'checkin'
    requestedTime.value = `${String(new Date(l.checked_at).getHours()).padStart(2, '0')}:${String(Math.floor(new Date(l.checked_at).getMinutes() / 5) * 5).padStart(2, '0')}`
  }
}

async function submit() {
  error.value = ''
  done.value = false
  const workerId = props.workerId ?? (await useCurrentUser().resolve())?.worker_id ?? null
  if (!workerId) { error.value = t('checkin.lateErrNoWorker'); return }
  if (!selected.value) { error.value = t('checkin.fixErrNoLog'); return }
  if (!reason.value.trim()) { error.value = t('checkin.fixErrNoReason'); return }
  if (kind.value === 'time' && !requestedTime.value) { error.value = t('checkin.fixErrNoTime'); return }

  busy.value = true
  try {
    // 本人確認・値の妥当性は EF 側でも検証する（画面のチェックは通信を減らすためのもの）
    const res = await attendance.correctionRequest({
      logId: selected.value,
      kind: kind.value,
      ...(kind.value === 'type' ? { requestedType: requestedType.value } : {}),
      ...(kind.value === 'time' ? { requestedTime: requestedTime.value } : {}),
      reason: reason.value.trim(),
    })
    if (!res.ok) {
      error.value = res.error === 'ALREADY_REQUESTED' ? t('checkin.fixErrAlready')
        : res.error === 'no_change' ? t('checkin.fixErrNoChange')
        : t('checkin.fixErrFailed')
      return
    }
    done.value = true
    reason.value = ''
    pendingLogIds.value = new Set([...pendingLogIds.value, selected.value])
    selected.value = ''
  } catch (e: any) {
    console.error('[PunchCorrectionPanel] 修正申請に失敗:', e)
    error.value = t('checkin.fixErrFailed')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.fix-wrap { flex-shrink: 0; }
.fix-open {
  width: 100%; background: #fff; border: 1px solid #d1d5db; border-radius: 10px;
  padding: 12px; font-size: 14px; font-weight: 600; color: #374151;
  display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
}
.fix-panel { background: #fff; border: 1px solid #d1d5db; border-radius: 10px; padding: 14px; }
.fix-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.fix-note { font-size: 12px; color: #6b7280; line-height: 1.6; margin: 0 0 10px; }
.fix-empty { font-size: 13px; color: #9ca3af; padding: 10px 0; }
.fix-list { list-style: none; margin: 0 0 10px; padding: 0; max-height: 190px; overflow-y: auto; }
.fix-item { border-bottom: 1px solid #f3f4f6; }
.fix-item.dead { opacity: .5; }
.fix-radio { display: flex; align-items: center; gap: 8px; padding: 9px 2px; font-size: 13px; cursor: pointer; }
.fix-when { flex: 1; }
.fix-type { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.fix-type.checkin { color: #15803d; background: #dcfce7; }
.fix-type.checkout { color: #b45309; background: #fef3c7; }
.fix-tag { padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.fix-tag.pending { color: #1d4ed8; background: #dbeafe; }
.fix-tag.done { color: #15803d; background: #dcfce7; }
.fix-tag.dead { color: #991b1b; background: #fee2e2; }
.fix-label { display: block; font-size: 12px; font-weight: 700; color: #374151; margin: 10px 0 4px; }
.fix-input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; font-size: 14px; background: #fff; }
.fix-hint { font-size: 11px; color: #6b7280; margin: 4px 0 0; line-height: 1.5; }
.fix-error { font-size: 13px; color: #b91c1c; margin: 8px 0 0; }
.fix-ok { font-size: 13px; color: #15803d; margin: 8px 0 0; }
.fix-actions { display: flex; gap: 8px; margin-top: 12px; }
.fix-submit { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer; }
.fix-submit:disabled { opacity: .6; }
.fix-cancel { flex: 1; background: #fff; color: #6b7280; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; }
</style>
