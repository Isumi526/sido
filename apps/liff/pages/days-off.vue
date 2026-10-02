<template>
  <div class="do-page">
    <AppNav :subtitle="$t('daysOff.title')" guide="daysOff" />

    <main class="do-main">
      <p class="do-lead">{{ $t('daysOff.lead') }}</p>

      <div v-if="loading" class="do-state"><div class="spinner" /></div>
      <p v-else-if="loadError" class="do-error" data-testid="do-load-error">{{ $t('daysOff.loadError') }}</p>

      <template v-else>
        <!-- 毎週の定休（確認事項3=A） -->
        <section class="do-card" data-testid="do-weekly">
          <h2 class="do-h">{{ $t('daysOff.weeklyTitle') }}</h2>
          <p class="do-hint">{{ $t('daysOff.weeklyHint') }}</p>
          <div class="do-week">
            <button
              v-for="d in 7" :key="d - 1" type="button" class="do-wd"
              :class="{ on: weekly.includes(d - 1), sun: d - 1 === 0, sat: d - 1 === 6 }"
              :aria-pressed="weekly.includes(d - 1)" :disabled="savingWeekly"
              :data-testid="`do-wd-${d - 1}`" @click="toggleWeekday(d - 1)"
            >{{ weekdayLabel(d - 1) }}</button>
          </div>
          <p v-if="weeklyMsg" class="do-ok" data-testid="do-weekly-msg">{{ weeklyMsg }}</p>
        </section>

        <!-- 休み・有給を入れる -->
        <section class="do-card" data-testid="do-add">
          <h2 class="do-h">{{ $t('daysOff.addTitle') }}</h2>
          <label class="do-label">{{ $t('daysOff.date') }}</label>
          <input v-model="date" type="date" class="do-input" :min="today" data-testid="do-date" />
          <div class="do-kinds" role="radiogroup">
            <button
              v-for="k in KINDS" :key="k" type="button" class="do-kind" :class="{ on: kind === k, [k]: true }"
              role="radio" :aria-checked="kind === k" :data-testid="`do-kind-${k}`" @click="kind = k"
            >{{ $t(`daysOff.kind.${k}`) }}</button>
          </div>
          <button type="button" class="do-submit" :disabled="!date || saving" data-testid="do-submit" @click="submit">
            {{ saving ? $t('daysOff.saving') : $t('daysOff.addButton') }}
          </button>
          <p v-if="addError" class="do-error" data-testid="do-add-error">{{ addError }}</p>
          <p v-if="addMsg" class="do-ok" data-testid="do-add-msg">{{ addMsg }}</p>
          <p v-if="balanceShort" class="do-warn" data-testid="do-balance-short">{{ $t('daysOff.balanceShort') }}</p>
        </section>

        <!-- これからの休み・有給 -->
        <section class="do-card" data-testid="do-list">
          <h2 class="do-h">{{ $t('daysOff.upcomingTitle') }}</h2>
          <p v-if="!upcoming.length" class="do-empty">{{ $t('daysOff.upcomingEmpty') }}</p>
          <ul v-else class="do-items">
            <li v-for="u in upcoming" :key="u.id" class="do-item" :data-testid="`do-item-${u.date}`">
              <span class="do-item-date">{{ rangeLabel(u) }}</span>
              <span class="do-badge" :class="u.kind">{{ $t(`daysOff.kind.${u.kind}`) }}</span>
              <button type="button" class="do-remove" :disabled="removing === u.id" :data-testid="`do-remove-${u.date}`" @click="removeItem(u)">
                {{ $t('daysOff.remove') }}
              </button>
            </li>
          </ul>
        </section>

        <p class="do-note">{{ $t('daysOff.autoNote') }}</p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  休み・有給の予定（2026-10-02 設計「入力の手間を減らす」I-3・要望7）
//  先に入れた日は、その日の夜（20:00）に日報が自動で出る。その日に出勤の打刻をした時は出ない（確認事項2=B）。
//  有給は承認を通さない。残日数が足りない時だけ、日報の画面から出して承認に回す（確認事項1=A）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { todayStr } from '~/composables/schedule-core.gen'
import { mdWithWeekday, weekdayShort } from '~/utils/date-label'
import type { DayOff, DayOffKind } from '~/composables/useDaysOff'

const { t } = useI18n()
const api = useDaysOff()
const KINDS: DayOffKind[] = ['off', 'paid_leave']

const today = todayStr()
const loading = ref(true)
const loadError = ref(false)
const upcoming = ref<DayOff[]>([])
const weekly = ref<number[]>([])
const date = ref('')
const kind = ref<DayOffKind>('off')
const saving = ref(false)
const savingWeekly = ref(false)
const removing = ref<string | null>(null)
const addError = ref('')
const addMsg = ref('')
const weeklyMsg = ref('')
const balanceShort = ref(false)

const weekdayLabel = (wd: number) => weekdayShort(new Date(Date.UTC(2026, 0, 4 + wd)))   // 2026-01-04 は日曜
function rangeLabel(u: DayOff): string {
  return u.endDate && u.endDate !== u.date ? `${mdWithWeekday(u.date)} 〜 ${mdWithWeekday(u.endDate)}` : mdWithWeekday(u.date)
}

async function load() {
  try {
    const r = await api.list()
    upcoming.value = r.upcoming
    weekly.value = r.weekly
    loadError.value = false
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function toggleWeekday(wd: number) {
  const next = weekly.value.includes(wd) ? weekly.value.filter(x => x !== wd) : [...weekly.value, wd]
  savingWeekly.value = true
  weeklyMsg.value = ''
  try {
    weekly.value = await api.setWeekly(next)
    weeklyMsg.value = t('daysOff.weeklySaved')
  } catch {
    weeklyMsg.value = t('daysOff.saveFailed')
  } finally {
    savingWeekly.value = false
  }
}

const ERR_KEYS: Record<string, string> = {
  past_date: 'daysOff.errPast', report_exists: 'daysOff.errReportExists', too_far: 'daysOff.errTooFar',
}
async function submit() {
  if (!date.value) return
  saving.value = true
  addError.value = ''
  addMsg.value = ''
  balanceShort.value = false
  try {
    const r = await api.add(date.value, kind.value)
    balanceShort.value = r.balanceShort
    addMsg.value = t('daysOff.added', { date: mdWithWeekday(date.value), kind: t(`daysOff.kind.${kind.value}`) })
    date.value = ''
    await load()
  } catch (e: any) {
    addError.value = t(ERR_KEYS[e?.message] ?? 'daysOff.saveFailed')
  } finally {
    saving.value = false
  }
}

async function removeItem(u: DayOff) {
  if (!confirm(t('daysOff.removeConfirm', { date: rangeLabel(u) }))) return
  removing.value = u.id
  try {
    await api.remove(u.id)
    await load()
  } catch {
    addError.value = t('daysOff.saveFailed')
  } finally {
    removing.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.do-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f2f2f7; }
.do-main { flex: 1; padding: 16px; max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.do-lead { margin: 0; font-size: 14px; line-height: 1.6; color: #374151; }
.do-state { display: flex; justify-content: center; padding: 40px 0; }
.spinner { width: 32px; height: 32px; border: 3px solid #ddd; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.do-card { background: #fff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.do-h { margin: 0 0 6px; font-size: 15px; font-weight: 800; color: #1f2937; }
.do-hint { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; color: #6b7280; }
.do-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.do-wd { height: 44px; border-radius: 10px; border: 1px solid #d1d5db; background: #fff; font-size: 15px; font-weight: 700; color: #374151; cursor: pointer; }
.do-wd.sun { color: #dc2626; }
.do-wd.sat { color: #2563eb; }
.do-wd.on { background: #06C755; border-color: #06C755; color: #fff; }
.do-wd:disabled { opacity: .6; }
.do-label { display: block; margin: 4px 0 6px; font-size: 13px; font-weight: 700; color: #374151; }
.do-input { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border: 1px solid #d1d5db; border-radius: 10px; font-size: 16px; background: #fff; }
.do-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.do-kind { height: 44px; border-radius: 10px; border: 1px solid #d1d5db; background: #fff; font-size: 15px; font-weight: 700; color: #374151; cursor: pointer; }
.do-kind.on.off { background: #475569; border-color: #475569; color: #fff; }
.do-kind.on.paid_leave { background: #7C3AED; border-color: #7C3AED; color: #fff; }
.do-submit { width: 100%; margin-top: 12px; height: 48px; border: none; border-radius: 12px; background: #06C755; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; }
.do-submit:disabled { opacity: .4; cursor: default; }
.do-error { margin: 8px 0 0; font-size: 13px; color: #dc2626; }
.do-ok { margin: 8px 0 0; font-size: 13px; color: #15803d; }
.do-warn { margin: 8px 0 0; font-size: 13px; line-height: 1.6; color: #92400e; background: #fffbeb; border-radius: 8px; padding: 8px 10px; }
.do-empty { margin: 0; font-size: 13px; color: #9ca3af; }
.do-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.do-item { display: flex; align-items: center; gap: 8px; }
.do-item-date { flex: 1; font-size: 15px; font-weight: 600; color: #1f2937; }
.do-badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #fff; background: #475569; }
.do-badge.paid_leave { background: #7C3AED; }
.do-remove { height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid #fca5a5; background: #fff; color: #dc2626; font-size: 13px; font-weight: 700; cursor: pointer; }
.do-note { margin: 0; font-size: 12.5px; line-height: 1.6; color: #6b7280; }
</style>
