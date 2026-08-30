<template>
  <div class="late-wrap">
    <!-- ★打刻を忘れた日をあとから入れる（2026-08-10 大塚さん「4日前まできればいいんじゃない？」）。
         打刻は「あとから直せない記録」なので既存行は書き換えず、遡り分を新しい1件として
         追記する（backdated=true）。管理画面ではその場で押した打刻と区別して見える。 -->
    <button v-if="!open" class="late-open" data-testid="late-open" @click="openPanel()">
      <span class="material-symbols-rounded">history</span>{{ $t('checkin.lateOpen') }}
    </button>

    <div v-else class="late-panel" data-testid="late-panel">
      <div class="late-title">{{ $t('checkin.lateTitle') }}</div>
      <p class="late-note">{{ $t('checkin.lateNote', { days: LATE_MAX_DAYS }) }}</p>

      <label class="late-label">{{ $t('checkin.lateDate') }}</label>
      <select v-model="date" class="late-input" data-testid="late-date">
        <option v-for="d in dateOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>

      <div class="late-times">
        <div class="late-time-field">
          <label class="late-label">{{ $t('checkin.lateCheckin') }}</label>
          <select v-model="checkin" class="late-input" data-testid="late-checkin">
            <option value="">—</option>
            <option v-for="tm in LATE_TIME_OPTIONS" :key="tm" :value="tm">{{ tm }}</option>
          </select>
        </div>
        <div class="late-time-field">
          <label class="late-label">{{ $t('checkin.lateCheckout') }}</label>
          <select v-model="checkout" class="late-input" data-testid="late-checkout">
            <option value="">—</option>
            <option v-for="tm in LATE_TIME_OPTIONS" :key="tm" :value="tm">{{ tm }}</option>
          </select>
        </div>
      </div>

      <p v-if="error" class="late-error" data-testid="late-error">{{ error }}</p>
      <p v-if="done" class="late-ok" data-testid="late-done">{{ $t('checkin.lateDone') }}</p>

      <div class="late-actions">
        <button class="late-submit" :disabled="busy" data-testid="late-submit" @click="submit()">
          {{ busy ? $t('checkin.lateSubmitting') : $t('checkin.lateSubmit') }}
        </button>
        <button class="late-cancel" data-testid="late-cancel" @click="open = false">{{ $t('checkin.lateCancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  LatePunchPanel — 打刻を忘れた日をあとから入力する
//
//  出所: 大塚さんとの電話 2026-08-10
//   「次の日でも別に今までと同じような感じで、4日前まできればいいんじゃない？3日前か」
//   「出勤するのを忘れたとしても…18時だとしても、出勤するよってすぐ〔打刻〕して、
//     実際に時間を打ち込む」
//
//  ★UPDATE ではなく INSERT。attendance_logs は RLS で UPDATE/DELETE を全面禁止していて
//   「あとから直せない記録」であることが存在意義（同意したルール文面のスナップショットを
//   法的証拠として持っている）。遡り分も1件のログとして積む。
//
//  ★代理では入れない。自分の分だけ（他人の勤怠を後付けで作れる導線を開けない）。
//
//  ★2026-08-27 出退勤モデル変更で現場の選択を外した。打刻は現場に紐づかなくなり
//   （1日＝最初の出勤・最後の退勤の2回）、日付と時刻だけで入る。
// ============================================================
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  workerId: string | null
}>()
const emit = defineEmits<{ (e: 'recorded'): void }>()

const { t } = useI18n()
// ★テーブル直叩きはしない。本番の INSERT ポリシーは checked_at を now()±10分に
//  縛っており（打刻の捏造対策）、過去日時の追記は service_role でしか通らない。
const attendance = useAttendanceLog()

const LATE_MAX_DAYS = 4
// 5分刻み（2026-07-27 打ち合わせで時間の刻みは5分と確定。実際に働いた時刻を入れる欄なので
//  30分刻みだと「実際の時間を打ち込む」という目的に足りない）
const LATE_TIME_OPTIONS = Array.from({ length: 24 * 12 }, (_, i) =>
  `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`)

const open     = ref(false)
const date     = ref('')
const checkin  = ref('')
const checkout = ref('')
const busy     = ref(false)
const error    = ref('')
const done     = ref(false)

/** JSTの YYYY-MM-DD（端末のタイムゾーンに引きずられない） */
function jstDay(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d)
}

/** 今日〜LATE_MAX_DAYS日前。これより前は選べない＝際限なく後付けできないようにする */
const dateOptions = computed(() =>
  Array.from({ length: LATE_MAX_DAYS + 1 }, (_, i) => {
    const value = jstDay(i)
    const [, m, d] = value.split('-')
    return { value, label: i === 0 ? `${Number(m)}/${Number(d)}（今日）` : `${Number(m)}/${Number(d)}` }
  }))

function openPanel() {
  open.value = true
  error.value = ''
  done.value = false
  if (!date.value) date.value = jstDay(1)   // 既定は「昨日」（打刻忘れに気づくのは翌日が普通）
}

async function submit() {
  error.value = ''
  done.value = false

  const workerId = props.workerId ?? (await useCurrentUser().resolve())?.worker_id ?? null
  if (!workerId) { error.value = t('checkin.lateErrNoWorker'); return }
  if (!checkin.value && !checkout.value) { error.value = t('checkin.lateErrNoTime'); return }
  if (!dateOptions.value.some(o => o.value === date.value)) { error.value = t('checkin.lateErrOutOfRange'); return }
  if (checkin.value && checkout.value && checkin.value >= checkout.value) {
    error.value = t('checkin.lateErrOrder'); return
  }

  busy.value = true
  try {
    // 範囲・重複・本人確認は EF 側でも検証する（画面のバリデーションは通信を減らすためのもので、
    // それだけを頼りにしない）。
    const res = await attendance.backdate({
      date: date.value,
      ...(checkin.value ? { checkin: checkin.value } : {}),
      ...(checkout.value ? { checkout: checkout.value } : {}),
    })
    if (!res.ok) {
      error.value = res.error === 'duplicate' ? t('checkin.lateErrDuplicate')
        : res.error === 'out_of_range' ? t('checkin.lateErrOutOfRange')
        : res.error === 'bad_time_order' ? t('checkin.lateErrOrder')
        : t('checkin.lateErrFailed')
      return
    }
    done.value = true
    checkin.value = ''
    checkout.value = ''
    emit('recorded')
  } catch (e: any) {
    console.error('[LatePunchPanel] 遡り打刻に失敗:', e)
    error.value = t('checkin.lateErrFailed')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
/* ★flex-shrink:0。親（現場選択・出勤中画面）は高さ固定で一覧が内部スクロールする作りなので、
   ここが伸びるとページ全体がはみ出す（liff.checkin-select-site の不変条件）。 */
.late-wrap { flex-shrink: 0; width: 100%; max-width: 480px; margin: 0 auto; box-sizing: border-box; padding: 0 16px 12px; }

.late-open {
  margin: 10px auto 0; display: flex; align-items: center; gap: 6px;
  background: none; border: none; color: #475569; font-size: 13px;
  text-decoration: underline; cursor: pointer;
}
.late-panel {
  margin: 10px 0 0; padding: 14px; background: #fff;
  border: 1px solid #cbd5e1; border-radius: 12px; text-align: left;
  max-height: 60vh; overflow-y: auto;
}
.late-title { font-size: 14px; font-weight: 700; color: #0f172a; }
.late-note  { margin: 4px 0 10px; font-size: 12px; color: #64748b; line-height: 1.6; }
.late-label { display: block; margin: 8px 0 4px; font-size: 12px; color: #64748b; }
.late-input {
  width: 100%; box-sizing: border-box; padding: 12px 14px;
  border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; background: #fff;
}
.late-times { display: flex; gap: 10px; }
.late-time-field { flex: 1; min-width: 0; }
.late-error { margin: 10px 0 0; font-size: 13px; color: #b91c1c; line-height: 1.6; }
.late-ok    { margin: 10px 0 0; font-size: 13px; color: #047857; line-height: 1.6; }
.late-actions { display: flex; gap: 8px; margin-top: 12px; }
.late-submit {
  flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px;
  padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer;
}
.late-submit:disabled { opacity: .5; }
.late-cancel {
  background: #fff; color: #64748b; border: 1px solid #ddd; border-radius: 8px;
  padding: 12px 16px; font-size: 14px; cursor: pointer;
}
</style>
