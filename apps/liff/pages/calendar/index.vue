<template>
  <div class="cal-page">
    <AppNav :subtitle="$t('calendar.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />

    <!-- 予定追加のお知らせ（未読・気づかないケース対策 #予定通知） -->
    <div v-if="notifs.length" class="notif-banner">
      <div class="notif-head">
        <span>🔔 あなたに新しい予定が {{ notifs.length }} 件追加されました</span>
        <button class="notif-dismiss" @click="dismissNotifs">既読にする</button>
      </div>
      <ul class="notif-list">
        <li v-for="n in notifs" :key="n.id">{{ n.body || n.title }}</li>
      </ul>
    </div>

    <!-- 共有／個人タブ -->
    <div class="cal-tabs">
      <button type="button" class="cal-tab" :class="{ active: activeTab === 'shared' }" @click="activeTab = 'shared'">{{ $t('calendar.tabShared') }}</button>
      <button type="button" class="cal-tab" :class="{ active: activeTab === 'personal' }" @click="activeTab = 'personal'">{{ $t('calendar.tabPersonal') }}</button>
    </div>

    <!-- 月ナビ（ヘッダー：年月＋グループ絞り込み） -->
    <div v-if="activeTab === 'shared'" class="month-nav">
      <span class="nav-label">{{ navLabel }}</span>
      <select v-if="myGroups.length" v-model="selectedGroupId" class="group-select" :aria-label="$t('calendar.filterByGroup')">
        <option :value="null">{{ $t('calendar.everyone') }}</option>
        <option v-for="g in myGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
    </div>

    <div v-if="activeTab === 'shared' && loading" class="loading">{{ $t('common.loading') }}</div>

    <!-- マトリクスグリッド（共有タブ） -->
    <div v-if="activeTab === 'shared'" ref="gridWrapRef" class="grid-wrap" @scroll.passive="onGridScroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col date-col-header"></th>
            <th
              v-for="w in sortedWorkers"
              :key="w.id"
              class="worker-header"
              :class="{ 'my-col': isMyWorker(w.id), 'pinned-col': isPinned(w.id) }"
              @click="togglePin(w.id)"
            >
              <span class="pin-icon" v-if="isPinned(w.id)">📌</span>{{ w.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr class="sentinel-top"><td :colspan="sortedWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
          <tr v-if="isExtending === 'top'" class="extend-loading-row" data-testid="extend-loading-top">
            <td :colspan="sortedWorkers.length + 1" class="extend-loading-cell">
              <span class="extend-spinner" /> {{ $t('common.loading') }}
            </td>
          </tr>
          <tr
            v-for="date in calendarDates"
            :key="date"
            :data-date="date"
            :ref="el => { if (date === todayStr) _todayRow.el = el as HTMLElement | null }"
            :class="{
              'today-row': date === todayStr,
              'weekend-row': isWeekend(date),
              'month-first-row': date.endsWith('-01'),
            }"
          >
            <td class="sticky-col date-cell" :class="dateCellClass(date, todayStr)">
              <span v-if="date.endsWith('-01')" class="month-badge">{{ $t('calendar.monthBadge', { n: Number(date.slice(5, 7)) }) }}</span>
              {{ formatDateLabel(date) }}
            </td>
            <td
              v-for="w in sortedWorkers"
              :key="w.id"
              class="sched-cell"
              :class="{ 'my-col-cell': isMyWorker(w.id), 'pinned-col-cell': isPinned(w.id) }"
              @click="onCellTap(date, w.id)"
            >
              <div class="cell-inner">
                <span v-if="isBirthday(date, w.id)" class="birthday-badge material-symbols-rounded" :title="`${w.name}${$t('calendar.birthdayOf')}`">cake</span>
                <div
                  v-for="s in cellSchedules(date, w.id)"
                  :key="s.id"
                  class="sched-chip"
                  :class="{
                    'night-shift': s.is_night_shift,
                    'deleted-chip': !!s.deleted_at,
                  }"
                  :style="chipStyle(s)"
                  @click.stop="openDetail(s)"
                >
                  <span class="chip-title">{{ s.title }}</span>
                  <span v-if="s.start_time" class="chip-time">{{ s.start_time.slice(0, 5) }}–{{ s.end_time?.slice(0, 5) }}</span>
                </div>
                <button class="cell-add-btn" @click.stop="onCellTap(date, w.id)">＋</button>
              </div>
            </td>
          </tr>
          <tr v-if="isExtending === 'bottom'" class="extend-loading-row" data-testid="extend-loading-bottom">
            <td :colspan="sortedWorkers.length + 1" class="extend-loading-cell">
              <span class="extend-spinner" /> {{ $t('common.loading') }}
            </td>
          </tr>
          <tr class="sentinel-bottom"><td :colspan="sortedWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
        </tbody>
      </table>
    </div>

    <!-- 個人カレンダー（週間／月間） -->
    <div v-if="activeTab === 'personal'" class="personal-cal">
      <div class="personal-nav">
        <button type="button" class="nav-btn" @click="personalNavigate(-1)">‹</button>
        <span class="nav-label">{{ personalNavLabel }}</span>
        <button type="button" class="nav-btn" @click="personalNavigate(1)">›</button>
      </div>
      <div class="personal-view-toggle">
        <button type="button" class="cal-tab" :class="{ active: personalViewMode === 'week' }" @click="personalViewMode = 'week'">{{ $t('calendar.viewWeek') }}</button>
        <button type="button" class="cal-tab" :class="{ active: personalViewMode === 'month' }" @click="personalViewMode = 'month'">{{ $t('calendar.viewMonth') }}</button>
        <button type="button" class="today-btn" @click="personalGoToday">{{ $t('calendar.today') }}</button>
      </div>

      <!-- 週間（画面幅に応じて可変日数・時間軸メモリ表示で予定を開始時刻の位置に配置） -->
      <div v-if="personalViewMode === 'week'" class="personal-week">
        <div class="personal-week-head" :style="{ gridTemplateColumns: `56px repeat(${personalWeekDates.length}, 1fr)` }">
          <div class="week-head-corner"></div>
          <div v-for="date in personalWeekDates" :key="date" class="personal-day-head" :class="dateCellClass(date, todayStr)">
            <span>{{ formatDateLabel(date) }}</span>
            <button type="button" class="cell-add-btn week-head-add-btn" @click="personalAddSchedule(date)">＋</button>
          </div>
        </div>

        <!-- 終日・時刻未設定の予定 -->
        <div v-if="personalWeekDates.some(d => personalCellSchedules(d).some(s => !s.start_time))" class="personal-week-allday" :style="{ gridTemplateColumns: `56px repeat(${personalWeekDates.length}, 1fr)` }">
          <div class="week-head-corner"></div>
          <div v-for="date in personalWeekDates" :key="date" class="week-allday-col">
            <div
              v-for="s in personalCellSchedules(date).filter(x => !x.start_time)"
              :key="s.id"
              class="sched-chip personal-chip-sm"
              :class="{ 'night-shift': s.is_night_shift, 'deleted-chip': !!s.deleted_at }"
              :style="chipStyle(s)"
              @click="openDetail(s)"
            >{{ s.title }}</div>
          </div>
        </div>

        <div ref="weekTimelineScrollRef" class="personal-week-scroll">
          <div class="personal-week-timeline" :style="{ gridTemplateColumns: `56px repeat(${personalWeekDates.length}, 1fr)`, height: WEEK_HOUR_HEIGHT * 24 + 'px' }">
            <div class="week-hour-axis">
              <div v-for="h in 24" :key="h" class="week-hour-label" :style="{ top: (h - 1) * WEEK_HOUR_HEIGHT + 'px' }">{{ h - 1 }}:00</div>
            </div>
            <div v-for="date in personalWeekDates" :key="date" class="week-day-timeline" :class="dateCellClass(date, todayStr)">
              <div v-for="h in 24" :key="h" class="week-hour-line" :style="{ top: (h - 1) * WEEK_HOUR_HEIGHT + 'px' }"></div>
              <div
                v-for="s in personalCellSchedules(date).filter(x => x.start_time)"
                :key="s.id"
                class="sched-chip week-timed-chip"
                :class="{ 'night-shift': s.is_night_shift, 'deleted-chip': !!s.deleted_at }"
                :style="[chipStyle(s), timedChipStyle(s)]"
                @click="openDetail(s)"
              >
                <span class="chip-title">{{ s.title }}</span>
                <span class="chip-time">{{ s.start_time?.slice(0, 5) }}{{ s.end_time ? '–' + s.end_time.slice(0, 5) : '' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 月間（複数月を縦に連結し無限スクロール。前後スクロールで月が継ぎ足され自動切替） -->
      <div v-else ref="personalMonthScrollRef" class="personal-month-scroll" @scroll="onPersonalMonthScroll">
        <div v-for="m in personalMonths" :key="monthKey(m.year, m.month)" class="personal-month-block" :data-year="m.year" :data-month="m.month">
          <div class="personal-month-block-label">{{ monthLabel(m.year, m.month) }}</div>
          <div class="personal-month-grid">
            <div v-for="wd in WEEKDAYS" :key="wd" class="personal-month-wd">{{ wd }}</div>
            <div v-for="cell in monthCellsFor(m.year, m.month)" :key="cell.date || cell.key" class="personal-month-cell" :class="[cell.date ? dateCellClass(cell.date, todayStr) : 'blank']">
              <template v-if="cell.date">
                <div class="personal-month-daynum" @click="personalAddSchedule(cell.date)">{{ Number(cell.date.slice(8, 10)) }}</div>
                <div
                  v-for="s in personalCellSchedules(cell.date)"
                  :key="s.id"
                  class="sched-chip personal-chip-sm"
                  :class="{ 'night-shift': s.is_night_shift, 'deleted-chip': !!s.deleted_at }"
                  :style="chipStyle(s)"
                  @click="openDetail(s)"
                >{{ s.title }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 下部操作バー -->
    <div v-if="activeTab === 'shared'" class="bottom-bar">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <button class="today-btn" @click="goToday">{{ $t('calendar.today') }}</button>
      <label class="deleted-toggle">
        <input type="checkbox" v-model="showDeleted" />
        {{ $t('calendar.deleted') }}
      </label>
      <button class="nav-btn" @click="navigate(1)">›</button>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? $t('calendar.editSchedule') : $t('calendar.addSchedule') }}</h2>

        <!-- 対象者（複数選択＋グループ一括選択） -->
        <div class="form-card worker-card">
          <div class="worker-pick-head">
            <span class="form-row-label">{{ $t('calendar.targetWorkers', { count: selectedWorkerIds.size }) }}</span>
            <select v-if="myGroups.length" class="group-pick" @change="onGroupBulkSelect($event)">
              <option value="">{{ $t('calendar.bulkSelectFromGroup') }}</option>
              <option v-for="g in myGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
          <div class="worker-chips">
            <button
              v-for="w in workers"
              :key="w.id"
              type="button"
              class="worker-chip"
              :class="{ on: selectedWorkerIds.has(w.id) }"
              @click="toggleWorkerSel(w.id)"
            >{{ w.name }}</button>
          </div>
        </div>

        <!-- 現場選択 -->
        <div class="form-card">
          <!-- 現場と紐付けない トグル（独立・現場プルダウンと分離） -->
          <label class="no-site-toggle">
            <input type="checkbox" v-model="noSiteMode" />
            <span>{{ $t('calendar.noSiteToggle') }}</span>
          </label>

          <template v-if="!noSiteMode">
            <!-- 元請け業者（任意）: 選ぶと現場プルダウンをその元請けに紐づく現場へ絞り込む -->
            <div v-if="master.contractorNames.value.length" class="form-row" style="margin-bottom:8px">
              <span class="form-row-label">{{ $t('calendar.contractor') }}</span>
              <select v-model="(formModal as any)._contractor" class="site-select" data-testid="contractor-select">
                <option value="">{{ $t('calendar.contractorAll') }}</option>
                <option v-for="name in master.contractorNames.value" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
            <div class="form-row">
              <span class="form-row-label">{{ $t('calendar.site') }}</span>
              <select v-model="formModal.title" class="site-select" data-testid="site-select">
                <option value="">{{ $t('calendar.pleaseSelect') }}</option>
                <option v-for="s in filteredSiteNames((formModal as any)._contractor)" :key="s" :value="s">{{ s }}</option>
                <option value="__other__">{{ $t('calendar.registerNewSite') }}</option>
              </select>
            </div>
            <div v-if="formModal.title === '__other__'" class="form-row" style="margin-top:8px">
              <span class="form-row-label">{{ $t('calendar.siteName') }}</span>
              <input
                v-model="(formModal as any)._customTitle"
                type="text"
                class="site-select"
                data-testid="custom-site-title"
                :placeholder="$t('calendar.siteNamePlaceholder')"
                @keydown.enter.prevent
              />
            </div>
            <div v-if="formModal.title === '__other__' && customSiteSimilar.length"
                 style="margin-top:6px;font-size:12px;color:#B45309;background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:8px 10px;line-height:1.5">
              ⚠️ {{ $t('calendar.similarSiteWarn') }}：<template v-for="(name, i) in customSiteSimilar" :key="name"><span
                class="similar-site-pick" role="button" tabindex="0" data-testid="similar-site-pick"
                @click="(formModal as any)._customTitle = name"
                @keydown.enter.prevent="(formModal as any)._customTitle = name"
              >{{ name }}</span>{{ i < customSiteSimilar.length - 1 ? '、' : '' }}</template>
            </div>
          </template>

          <!-- 現場と紐付けない 場合のタイトル入力 -->
          <div v-if="noSiteMode" class="form-row" style="margin-top:8px">
            <span class="form-row-label">{{ $t('calendar.titleLabel') }}</span>
            <input
              v-model="(formModal as any)._noneTitle"
              type="text"
              class="site-select"
              :placeholder="$t('calendar.titlePlaceholder')"
              @keydown.enter.prevent
            />
          </div>
          <div v-if="schedCats.length" class="form-row" style="margin-top:8px">
            <span class="form-row-label">カテゴリ</span>
            <!-- 現場管理者以上はカテゴリマスタを管理できる（ラベルの右に配置・一覧/色/名前編集/追加/削除） -->
            <button v-if="canManageCat" type="button" class="cat-add-btn cat-manage-inline" @click="openCatManage">⚙ 管理</button>
            <div class="cat-select-wrap cat-select-wrap--gap">
              <select v-model="formModal.category" class="site-select" data-testid="category-select">
                <option v-for="c in schedCats.filter(x => x.active || x.key === formModal!.category)" :key="c.key" :value="c.key">{{ c.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">{{ $t('calendar.start') }}</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.start_date" class="dt-input dt-date" />
              <span class="dt-sep"></span>
              <span class="dt-time-wrap">
                <input type="time" v-model="formModal.start_time" class="dt-input dt-time" step="300" />
                <span v-if="!formModal.start_time" class="dt-placeholder">--:--</span>
              </span>
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-row">
            <span class="form-row-label">{{ $t('calendar.end') }}</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.end_date" class="dt-input dt-date" />
              <span class="dt-sep"></span>
              <span class="dt-time-wrap">
                <input type="time" v-model="formModal.end_time" class="dt-input dt-time" step="300" />
                <span v-if="!formModal.end_time" class="dt-placeholder">--:--</span>
              </span>
            </div>
          </div>
        </div>

        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">{{ $t('calendar.nightShift') }}</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.is_night_shift" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
          <div class="form-row">
            <span class="form-row-label">他のユーザーに共有</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.is_public" @change="isPublicTouched = true" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
        </div>

        <div class="form-card">
          <div class="form-row notes-row">
            <textarea v-model="formModal.description" class="notes-input" :placeholder="$t('calendar.addNote')" rows="2" />
          </div>
        </div>

        <p v-if="formError" class="error-msg">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="formModal = null">{{ $t('common.cancel') }}</button>
          <button class="btn-save" :disabled="saving" @click="saveSchedule">{{ saving ? $t('common.saving') : $t('common.save') }}</button>
        </div>
      </div>
    </div>

    <!-- カテゴリ管理モーダル（現場管理者以上・アカウント単位・色は固定・使わないカテゴリを非表示にするだけ）-->
    <div v-if="catManageOpen" class="modal-overlay" @click.self="catManageOpen = false">
      <div class="modal cat-manage">
        <div class="cat-manage-head">
          <span class="cat-manage-title">カテゴリ設定</span>
          <button type="button" class="cat-manage-close" @click="catManageOpen = false">閉じる</button>
        </div>
        <p class="cat-manage-hint">名前は編集できます。使わないカテゴリは「非表示」にすると予定追加の選択肢から消えます（色は固定）。</p>
        <ul class="cat-list">
          <li v-for="c in schedCats" :key="c.key" class="cat-item" :class="{ inactive: !c.active }">
            <span class="cat-dot" :style="{ background: c.color }" />
            <input type="text" class="cat-name-input" :value="c.label" @change="updateCat(c, { label: ($event.target as HTMLInputElement).value })" />
            <button type="button" class="cat-active-toggle" :class="{ off: !c.active }" @click="updateCat(c, { active: !c.active })">{{ c.active ? '表示' : '非表示' }}</button>
          </li>
        </ul>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="detailModal" class="modal-overlay" @click.self="closeDetail">
      <div class="modal">
        <div v-if="detailModal.schedule.is_night_shift" class="detail-night-badge">🌙 {{ $t('calendar.nightShift') }}</div>
        <h2 class="detail-title">{{ detailModal.schedule.title }}</h2>
        <p class="detail-meta">👤 {{ detailModal.schedule.worker?.name }}</p>
        <p class="detail-meta">
          📅 {{ detailModal.schedule.start_date }}
          <template v-if="detailModal.schedule.end_date !== detailModal.schedule.start_date">〜 {{ detailModal.schedule.end_date }}</template>
        </p>
        <p v-if="detailModal.schedule.start_time" class="detail-meta">
          🕐 {{ detailModal.schedule.start_time.slice(0, 5) }}〜{{ detailModal.schedule.end_time?.slice(0, 5) }}
        </p>
        <p v-if="detailModal.schedule.description" class="detail-desc">{{ detailModal.schedule.description }}</p>
        <p v-if="detailModal.schedule.created_by_name" class="detail-created">{{ $t('calendar.createdBy') }}: {{ detailModal.schedule.created_by_name }}</p>
        <p v-if="detailModal.schedule.deleted_at" class="detail-deleted">🗑 {{ $t('common.delete') }}: {{ detailModal.schedule.deleted_by_name }} ({{ fmtDateTime(detailModal.schedule.deleted_at) }})</p>

        <!-- 編集履歴 -->
        <details class="edit-history">
          <summary>{{ $t('calendar.editHistory', { count: detailModal.edits.length }) }}</summary>
          <p v-if="!detailModal.edits.length" class="edit-empty">{{ $t('calendar.noEditHistory') }}</p>
          <div v-for="e in detailModal.edits" :key="e.id" class="edit-entry">
            <div class="edit-header">
              <span class="edit-who">{{ e.edited_by_name }}</span>
              <span class="edit-when">{{ fmtDateTime(e.edited_at) }}</span>
            </div>
            <ul v-if="Object.keys(e.changes).length" class="edit-changes">
              <li v-for="(diff, field) in e.changes" :key="field">
                <span class="edit-field">{{ CHANGE_LABELS[field] ?? field }}</span>:
                <span class="edit-old">{{ diff.old ?? '—' }}</span> →
                <span class="edit-new">{{ diff.new ?? '—' }}</span>
              </li>
            </ul>
          </div>
        </details>

        <div class="modal-actions">
          <button class="btn-cancel" @click="closeDetail">{{ $t('common.close') }}</button>
          <template v-if="!detailModal.schedule.deleted_at">
            <button class="btn-delete" @click="confirmDelete(detailModal.schedule.id)">{{ $t('common.delete') }}</button>
            <button class="btn-edit" @click="openEdit(detailModal.schedule)">{{ $t('common.edit') }}</button>
          </template>
          <template v-else>
            <button class="btn-restore" @click="restore(detailModal.schedule)">{{ $t('calendar.restore') }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSchedules, type Schedule, type ScheduleForm } from '~/composables/useSchedules'
import { findSimilarSiteNames } from '~/utils/siteSimilarity'
import {
  shiftMonth, genMonthDates, isWeekend, weekdayIndex, dateCellClass, fmtDateTime,
  cellSchedules as coreCellSchedules, chipStyle as coreChipStyle, buildScheduleDiff, birthdayDatesByWorker,
} from '~/composables/schedule-core.gen'

const { t } = useI18n()
const schedules   = useSchedules()
const master      = useMaster()

// 新規現場(__other__)手入力時、既存に似た現場があれば重複候補を出す
const customSiteSimilar = computed(() =>
  formModal.value?.title === '__other__'
    ? findSimilarSiteNames((formModal.value as any)._customTitle ?? '', master.siteNames.value)
    : [],
)

// 現場プルダウン: 元請けが選択されていれば、その元請けに紐づく現場だけに絞り込む。
//  紐づく現場が0件 or 元請け未選択 なら全現場を出す（後方互換）。report.vue と同一ロジック。
function filteredSiteNames(contractorName?: string): string[] {
  const all = master.siteNames.value
  const cn = (contractorName ?? '').trim()
  if (!cn) return all
  const map = master.siteContractors.value
  const linked = all.filter((n) => map[n] === cn)
  return linked.length ? linked : all
}

// 「現場と紐付けない」トグル。内部状態は title==='__none__'（保存ロジックは従来どおり）。
//  ON で現場プルダウンを隠してタイトル入力に切替、OFF で現場選択に戻す。
const noSiteMode = computed<boolean>({
  get: () => formModal.value?.title === '__none__',
  set: (v) => { if (formModal.value) formModal.value.title = v ? '__none__' : '' },
})

const { profile } = useLiff()
const proxy       = useProxyMode()
const supabase    = useSupabase()
const config      = useRuntimeConfig()

// 予定カテゴリマスタ（#A・色分け）。admin(schedule-categories)で管理・ここは色/ラベルの消費。
type SchedCat = { key: string; label: string; color: string; active: boolean; sort_order: number }
const schedCats = ref<SchedCat[]>([])
const catColor  = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const c of schedCats.value) m[c.key] = c.color
  return m
})
async function loadSchedCats() {
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) return
  const { data } = await supabase.from('schedule_categories')
    .select('key, label, color, active, sort_order').eq('account_id', accountId).order('sort_order')
  schedCats.value = ((data ?? []) as SchedCat[])
}

// 現場管理者以上か（カテゴリの表示/非表示を管理できる。色・名前は固定＝編集不可）
const canManageCat = ref(false)
async function resolveCanManageCat() {
  const wid = schedules.myWorkerId.value
  if (!wid) return
  const { data } = await supabase.from('workers').select('permission_role').eq('id', wid).maybeSingle()
  const role = (data as { permission_role?: string } | null)?.permission_role
  canManageCat.value = role === 'admin' || role === 'office' || role === 'site_manager'
}
// カテゴリマスタ管理（現場管理者以上・アカウント単位・使わないカテゴリの表示/非表示のみ）
const catManageOpen = ref(false)
function openCatManage() { catManageOpen.value = true }
async function updateCat(c: SchedCat, patch: { active?: boolean; label?: string }) {
  if (!canManageCat.value) return
  const label = patch.label !== undefined ? patch.label.trim() : undefined
  if (patch.label !== undefined && !label) { await loadSchedCats(); return }   // 空名は無視して元に戻す
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  await supabase.from('schedule_categories')
    .update({ ...(patch.active !== undefined ? { active: patch.active } : {}), ...(label !== undefined ? { label } : {}) })
    .eq('account_id', accountId).eq('key', c.key)
  await loadSchedCats()   // 即反映
}
// カテゴリ色を太い左バーで常に表示（夜勤も暗背景維持＋カテゴリ色バー＝見分けやすく）。
// ロジックは shared/schedule-core.ts（admin と共有）。
function chipStyle(s: Schedule): Record<string, string> {
  return coreChipStyle(s, catColor.value)
}

// 予定追加のアプリ内通知（未読）。開いた時にバナーで気づかせ、既読で消す #予定通知
type SchedNotif = { id: string; title: string | null; body: string | null }
const notifs = ref<SchedNotif[]>([])
async function loadNotifs() {
  const wid = effectiveWorkerId.value
  if (!wid) return
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) return
  const { data } = await supabase.from('schedule_notifications')
    .select('id, title, body').eq('account_id', accountId).eq('worker_id', wid).is('read_at', null)
    .order('created_at', { ascending: false }).limit(20)
  notifs.value = ((data ?? []) as SchedNotif[])
}
async function dismissNotifs() {
  const ids = notifs.value.map(n => n.id)
  notifs.value = []
  if (!ids.length) return
  await supabase.from('schedule_notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  await refreshScheduleNotifBadge()   // HOME/ハンバーガーの未読バッジも即時反映（#予定通知バッジ）
}

const effectiveWorkerId = computed(() =>
  proxy.proxyTarget.value?.id ?? schedules.myWorkerId.value
)

function isMyWorker(workerId: string): boolean {
  return workerId === effectiveWorkerId.value
}

// ──────────────────── 定数 ────────────────────
const WEEKDAYS = computed<string[]>(() => [
  t('calendar.weekdays.sun'),
  t('calendar.weekdays.mon'),
  t('calendar.weekdays.tue'),
  t('calendar.weekdays.wed'),
  t('calendar.weekdays.thu'),
  t('calendar.weekdays.fri'),
  t('calendar.weekdays.sat'),
])
const CHANGE_LABELS = computed<Record<string, string>>(() => ({
  title:          t('calendar.fields.title'),
  description:    t('calendar.fields.description'),
  start_date:     t('calendar.fields.start_date'),
  end_date:       t('calendar.fields.end_date'),
  start_time:     t('calendar.fields.start_time'),
  end_time:       t('calendar.fields.end_time'),
  is_night_shift: t('calendar.fields.is_night_shift'),
}))
const PIN_KEY  = 'calendar_pinned_workers'
const GROUP_KEY = `calendar_group_filter_${config.public.accountSlug}`

// ──────────────────── 状態 ────────────────────
const workers     = ref<{ id: string; name: string; birth_date: string | null }[]>([])

// グループ絞り込み（自分が参加するグループのメンバー列だけ表示）
const groupsApi = useScheduleGroups()
const myGroups  = groupsApi.groups                         // readonly ref（テンプレートで自動unwrap）
const selectedGroupId = ref<string | null>(null)           // null = 全員

// 選択グループのメンバー worker_id 集合（null=絞り込みなし）
const memberWorkerIds = computed<Set<string> | null>(() => {
  if (!selectedGroupId.value) return null
  const g = myGroups.value.find(x => x.id === selectedGroupId.value)
  if (!g || g.members.length === 0) return null            // 不在/空グループは全員にフォールバック
  return new Set(g.members.map(m => m.worker_id))
})

// 選択を localStorage に記憶
watch(selectedGroupId, (v) => {
  try { localStorage.setItem(GROUP_KEY, v ?? '') } catch { /* quota */ }
})

// ピン留め
const pinnedWorkerIds = ref<string[]>(
  (() => { try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') } catch { return [] } })()
)

function isPinned(id: string): boolean {
  return pinnedWorkerIds.value.includes(id)
}

function togglePin(id: string) {
  if (isMyWorker(id)) return  // 自分はピン操作対象外
  const idx = pinnedWorkerIds.value.indexOf(id)
  if (idx === -1) pinnedWorkerIds.value.push(id)
  else pinnedWorkerIds.value.splice(idx, 1)
  localStorage.setItem(PIN_KEY, JSON.stringify(pinnedWorkerIds.value))
}

// 表示順: 自分 → ピン済み（ピン順）→ その他（name順）
// グループ選択時はそのメンバーの作業員だけに絞ってから並べる
const sortedWorkers = computed(() => {
  const ids  = memberWorkerIds.value
  const base = ids ? workers.value.filter(w => ids.has(w.id)) : workers.value
  const myId   = effectiveWorkerId.value
  const mine   = base.filter(w => w.id === myId)
  const pinned = pinnedWorkerIds.value
    .map(id => base.find(w => w.id === id))
    .filter((w): w is { id: string; name: string } => !!w && w.id !== myId)
  const rest   = base.filter(w => w.id !== myId && !isPinned(w.id))
  // 自分 → ピン留め → 残り50音順（DB側でname順取得済み）
  return [...mine, ...pinned, ...rest]
})
interface ScheduleEdit {
  id: string; schedule_id: string; edited_by_name: string; edited_at: string
  changes: Record<string, { old: unknown; new: unknown }>
}

const loading     = ref(false)
const todayStr    = new Date().toISOString().split('T')[0]
const gridWrapRef = ref<HTMLElement | null>(null)
// テンプレート内の v-for ref は非リアクティブ変数で管理
const _todayRow = { el: null as HTMLElement | null }
const showDeleted = ref(false)
const formModal   = ref<(Partial<ScheduleForm> & { id?: string }) | null>(null)
// 予定追加/編集モーダルの対象作業員（複数選択）
const selectedWorkerIds = ref<Set<string>>(new Set())
function toggleWorkerSel(id: string) {
  const s = new Set(selectedWorkerIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedWorkerIds.value = s
}
function onGroupBulkSelect(e: Event) {
  const gid = (e.target as HTMLSelectElement).value
  ;(e.target as HTMLSelectElement).value = ''   // プレースホルダに戻す
  if (!gid) return
  const g = myGroups.value.find(x => x.id === gid)
  if (!g) return
  const s = new Set(selectedWorkerIds.value)
  for (const m of g.members) s.add(m.worker_id)
  selectedWorkerIds.value = s
}
// 方針C: 新規予定で対象に「自分以外」が含まれるなら共有トグルを既定ON。
// ユーザーが手動でトグルしたら（isPublicTouched）それ以降は尊重し自動更新しない。編集(id有)は対象外。
const isPublicTouched = ref(false)
watch(selectedWorkerIds, (ids) => {
  const f = formModal.value
  if (!f || f.id || isPublicTouched.value) return
  const self = effectiveWorkerId.value
  f.is_public = [...ids].some(id => id !== self)
})
const detailModal = ref<{ schedule: Schedule; edits: ScheduleEdit[] } | null>(null)
const saving      = ref(false)
const formError   = ref('')

// ──────────────────── 無限スクロール ────────────────────
const ROW_HEIGHT    = 72
const calendarDates = ref<string[]>([])
let   loadedFrom    = ''
let   loadedTo      = ''
const navMonth      = ref(new Date())
const isExtending = ref<'top' | 'bottom' | null>(null)   // 月継ぎ足し中のローディング表示用（#月切替ローディング）
let   ioTop:    IntersectionObserver | null = null
let   ioBottom: IntersectionObserver | null = null

const navLabel = computed(() => {
  const d = navMonth.value
  return t('calendar.navLabel', { year: d.getFullYear(), month: d.getMonth() + 1 })
})

// genMonthDates / shiftMonth は shared/schedule-core.ts（admin と共有）から import 済み。

function initCalendar() {
  const now  = new Date()
  const prev = shiftMonth(now, -1)
  const next = shiftMonth(now, +1)
  const dates = [
    ...genMonthDates(prev.getFullYear(), prev.getMonth()),
    ...genMonthDates(now.getFullYear(),  now.getMonth()),
    ...genMonthDates(next.getFullYear(), next.getMonth()),
  ]
  calendarDates.value = dates
  loadedFrom = dates[0]
  loadedTo   = dates[dates.length - 1]
  navMonth.value = now
}

async function extendTop() {
  if (isExtending.value) return; isExtending.value = 'top'
  try {
    const base   = new Date(loadedFrom + 'T00:00:00')
    const target = shiftMonth(base, -1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    const wrap     = gridWrapRef.value
    const prevTop  = wrap?.scrollTop ?? 0
    calendarDates.value = [...newDates, ...calendarDates.value]
    loadedFrom = newDates[0]
    await nextTick()
    if (wrap) wrap.scrollTop = prevTop + newDates.length * ROW_HEIGHT
    await loadSchedules()
  } finally { isExtending.value = null }
}

async function extendBottom() {
  if (isExtending.value) return; isExtending.value = 'bottom'
  try {
    const base     = new Date(loadedTo + 'T00:00:00')
    const target   = shiftMonth(base, +1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    calendarDates.value = [...calendarDates.value, ...newDates]
    loadedTo = newDates[newDates.length - 1]
    await loadSchedules()
  } finally { isExtending.value = null }
}

function setupIO() {
  const wrap = gridWrapRef.value; if (!wrap) return
  const opts = { root: wrap, rootMargin: '300px 0px', threshold: 0 }

  ioTop?.disconnect()
  ioBottom?.disconnect()

  const topSentinel    = wrap.querySelector<HTMLElement>('.sentinel-top')
  const bottomSentinel = wrap.querySelector<HTMLElement>('.sentinel-bottom')

  if (topSentinel) {
    ioTop = new IntersectionObserver(([e]) => { if (e.isIntersecting) extendTop() }, opts)
    ioTop.observe(topSentinel)
  }
  if (bottomSentinel) {
    ioBottom = new IntersectionObserver(([e]) => { if (e.isIntersecting) extendBottom() }, opts)
    ioBottom.observe(bottomSentinel)
  }
}

// scrollToRow()によるprogrammatic scroll中はonGridScrollでのnavMonth更新を止める（#navMonth追従不具合）。
// navigate()/goTodayはnavMonthを直接確定させる権威ソースになったため、その結果としてscrollToRowが
// 起こす'scroll'イベントでonGridScrollが（連打時のロード待ち等で）古い/中間の行を読んでnavMonthを
// 巻き戻すのを防ぐ。カウンタなのは連続したscrollToRow呼び出し（連打）にも対応するため。
let pendingProgrammaticScrolls = 0

function onGridScroll() {
  if (pendingProgrammaticScrolls > 0) return
  const wrap = gridWrapRef.value; if (!wrap) return
  // 行の高さは予定の有無で可変なため、固定 ROW_HEIGHT での scrollTop 割り算だと行数を数えすぎて
  // 月ラベルが大きく早くズレる。実際の行位置を測り、sticky な作業員ヘッダーの直下に来ている
  // 「最上段の表示中の日付行」で月を判定する。
  const headBottom = wrap.getBoundingClientRect().top
    + (wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0)
  const rows = wrap.querySelectorAll<HTMLElement>('tr[data-date]')
  for (const r of rows) {
    if (r.getBoundingClientRect().bottom > headBottom + 4) {
      const d = r.dataset.date
      if (d) navMonth.value = new Date(d + 'T00:00:00')
      break
    }
  }
}

function scrollToRow(dateStr: string) {
  const wrap = gridWrapRef.value; if (!wrap) return
  const row  = wrap.querySelector<HTMLElement>(`tr[data-date="${dateStr}"]`)
  // sticky ヘッダーの高さ分も引いて、対象行がヘッダーに隠れず直下に来るようにする。
  const headH = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0
  if (row) {
    pendingProgrammaticScrolls++
    wrap.scrollTop = Math.max(0, row.offsetTop - wrap.offsetTop - headH - 8)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pendingProgrammaticScrolls = Math.max(0, pendingProgrammaticScrolls - 1)
    }))
  }
}

function scrollToToday() {
  nextTick(() => { if (_todayRow.el) scrollToRow(todayStr) })
}

function navigate(dir: 1 | -1) {
  const target    = shiftMonth(navMonth.value, dir)
  // ボタン操作はscrollイベント経由のonGridScrollでのnavMonth更新を待たず即座に反映する。
  // programmatic scroll(scrollToRow)が既に同じscrollTopに対しては'scroll'イベントを発火しないため
  // (連打で2回目以降がonGridScroll未発火のまま navMonth が古い値から計算され1ヶ月先で足踏みしていた)。
  navMonth.value  = target
  const targetStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
  const prefix    = targetStr.slice(0, 7)
  const found     = calendarDates.value.find(d => d.startsWith(prefix))
  if (found) {
    nextTick(() => scrollToRow(found))
  } else {
    // 未ロード月はロードしてからスクロール
    if (dir === -1) extendTop().then(() => nextTick(() => scrollToRow(calendarDates.value.find(d => d.startsWith(prefix)) ?? '')))
    else            extendBottom().then(() => nextTick(() => scrollToRow(calendarDates.value.find(d => d.startsWith(prefix)) ?? '')))
  }
}

function goToday() {
  const todayPrefix = todayStr.slice(0, 7)
  if (!calendarDates.value.find(d => d.startsWith(todayPrefix))) {
    initCalendar()
    loadSchedules().then(() => nextTick(() => scrollToToday()))
    return
  }
  navMonth.value = new Date()
  scrollToToday()
}

// ──────────────────── セル別スケジュール ────────────────────
// フィルタ＋開始時刻昇順ソート（時刻未設定は末尾）は shared/schedule-core.ts（admin と共有）。
function cellSchedules(date: string, workerId: string): Schedule[] {
  return coreCellSchedules(schedules.schedules.value, date, workerId, showDeleted.value, true)
}
// 誕生日バッジ（DB保存なしの表示専用・要件化回答A「予定管理カレンダーに誕生日を自動表示」）
const birthdayByDate = computed(() => birthdayDatesByWorker(workers.value, calendarDates.value))
function isBirthday(date: string, workerId: string): boolean {
  return !!birthdayByDate.value[date]?.includes(workerId)
}

// ──────────────────── 個人カレンダー（週間／月間・共有グリッドと別タブ） ────────────────────
// 既存の共有ビュー用データ(schedules.schedules)をそのまま流用し、自分の予定だけに絞る
// （is_public問わず＝本人分は既存fetchSchedulesの可視性ルールで既に取得済み）。
const activeTab = ref<'shared' | 'personal'>('shared')
const personalViewMode = ref<'week' | 'month'>('week')
const personalAnchor = ref(new Date())   // 週間=表示開始日／月間=表示月の基準日

function personalCellSchedules(date: string): Schedule[] {
  return cellSchedules(date, effectiveWorkerId.value ?? '')
}
function personalAddSchedule(date: string) {
  if (!effectiveWorkerId.value) return
  onCellTap(date, effectiveWorkerId.value)
}

// ── 週間ビュー：時間軸メモリ表示（#週間時間軸） ──
const WEEK_HOUR_HEIGHT = 48   // 1時間あたりの高さ(px)
const weekTimelineScrollRef = ref<HTMLElement | null>(null)
const WEEK_DEFAULT_SCROLL_HOUR = 6   // 初期表示は朝6時付近から見せる（深夜0時始まりだと使いにくいため）

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function timedChipStyle(s: Schedule): Record<string, string> {
  const startMin = s.start_time ? timeToMinutes(s.start_time) : 0
  let endMin = s.end_time ? timeToMinutes(s.end_time) : startMin + 60
  if (endMin <= startMin) endMin = startMin + 30   // 日跨ぎ/不正値のフォールバック（最低30分ぶんは確保して潰れないように）
  const top = (startMin / 60) * WEEK_HOUR_HEIGHT
  const height = Math.max(18, ((endMin - startMin) / 60) * WEEK_HOUR_HEIGHT)
  return { position: 'absolute', top: `${top}px`, height: `${height}px`, left: '2px', right: '2px' }
}
function scrollWeekTimelineToDefault() {
  const el = weekTimelineScrollRef.value
  if (el) el.scrollTop = WEEK_DEFAULT_SCROLL_HOUR * WEEK_HOUR_HEIGHT
}
watch(personalViewMode, async (mode) => {
  if (mode === 'week') { await nextTick(); scrollWeekTimelineToDefault() }
})
watch(activeTab, async (tab) => {
  if (tab === 'personal' && personalViewMode.value === 'week') { await nextTick(); scrollWeekTimelineToDefault() }
})

// 画面幅に応じた同時表示日数（3〜7日）。リサイズにも追従。
const personalDayCount = ref(4)
function updatePersonalDayCount() {
  if (typeof window === 'undefined') return
  const w = window.innerWidth
  personalDayCount.value = w >= 900 ? 7 : w >= 700 ? 5 : w >= 480 ? 4 : 3
}
onMounted(() => {
  updatePersonalDayCount()
  window.addEventListener('resize', updatePersonalDayCount)
  nextTick(() => scrollWeekTimelineToDefault())
})
onUnmounted(() => window.removeEventListener('resize', updatePersonalDayCount))

const personalWeekDates = computed<string[]>(() => {
  const start = new Date(personalAnchor.value)
  const out: string[] = []
  for (let i = 0; i < personalDayCount.value; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    out.push(toDateStr(d))
  }
  return out
})

// ── 月間ビュー：複数月を縦に連結して無限スクロール（#個人月間無限スクロール） ──
// 週間ビューと違い月間は「固定7列グリッドを月単位で再生成」する構造のため、
// 共有タブの日リスト無限スクロール(calendarDates/ROW_HEIGHT固定行高)とは別実装。
// 月ブロックは高さが可変(5〜6週)なため、行高計算ではなくscrollHeightの差分で
// スクロール位置を補正する。
const personalMonths = ref<{ year: number; month: number }[]>([])
const personalMonthScrollRef = ref<HTMLElement | null>(null)
const MONTH_SCROLL_THRESHOLD = 300   // 上端/下端からこの距離(px)以内で月を継ぎ足す

function monthKey(year: number, month: number): string { return `${year}-${month}` }
function monthLabel(year: number, month: number): string { return t('calendar.monthBadge', { n: month + 1 }) }

function monthCellsFor(year: number, month: number): { date: string | null; key: string }[] {
  const dates = genMonthDates(year, month)
  const leadBlank = weekdayIndex(dates[0])
  const cells: { date: string | null; key: string }[] = []
  for (let i = 0; i < leadBlank; i++) cells.push({ date: null, key: `blank-${year}-${month}-${i}` })
  for (const d of dates) cells.push({ date: d, key: d })
  return cells
}

function initPersonalMonths() {
  const y = personalAnchor.value.getFullYear()
  const m = personalAnchor.value.getMonth()
  personalMonths.value = [-1, 0, 1].map((off) => {
    const d = new Date(y, m + off, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
}
function extendMonthsTop() {
  const first = personalMonths.value[0]
  const d = new Date(first.year, first.month - 1, 1)
  personalMonths.value = [{ year: d.getFullYear(), month: d.getMonth() }, ...personalMonths.value]
}
function extendMonthsBottom() {
  const last = personalMonths.value[personalMonths.value.length - 1]
  const d = new Date(last.year, last.month + 1, 1)
  personalMonths.value = [...personalMonths.value, { year: d.getFullYear(), month: d.getMonth() }]
}

let monthScrollTicking = false
async function onPersonalMonthScroll() {
  if (monthScrollTicking) return
  monthScrollTicking = true
  requestAnimationFrame(async () => {
    monthScrollTicking = false
    const el = personalMonthScrollRef.value
    if (!el) return

    if (el.scrollTop < MONTH_SCROLL_THRESHOLD) {
      const prevHeight = el.scrollHeight
      extendMonthsTop()
      await nextTick()
      el.scrollTop += (el.scrollHeight - prevHeight)   // 継ぎ足し分だけ相殺しスクロール位置のジャンプを防ぐ
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < MONTH_SCROLL_THRESHOLD) {
      extendMonthsBottom()
    }
    updateAnchorFromScroll()
  })
}

// 現在スクロールで見えている月ブロックを判定し、ヘッダーラベル(personalAnchor)を自動追従させる
function updateAnchorFromScroll() {
  const el = personalMonthScrollRef.value
  if (!el) return
  const containerTop = el.getBoundingClientRect().top
  const blocks = el.querySelectorAll<HTMLElement>('.personal-month-block')
  for (const block of Array.from(blocks)) {
    const rect = block.getBoundingClientRect()
    if (rect.bottom - containerTop > 40) {
      const y = Number(block.dataset.year)
      const m = Number(block.dataset.month)
      if (!Number.isNaN(y) && !Number.isNaN(m) && (personalAnchor.value.getFullYear() !== y || personalAnchor.value.getMonth() !== m)) {
        personalAnchor.value = new Date(y, m, 1)
      }
      break
    }
  }
}

async function scrollToMonth(year: number, month: number) {
  if (!personalMonths.value.length) initPersonalMonths()
  let guard = 0
  while (!personalMonths.value.some((mm) => mm.year === year && mm.month === month) && guard < 24) {
    const first = personalMonths.value[0]
    const target = new Date(year, month, 1).getTime()
    if (target < new Date(first.year, first.month, 1).getTime()) extendMonthsTop()
    else extendMonthsBottom()
    guard++
  }
  personalAnchor.value = new Date(year, month, 1)
  await nextTick()
  const el = personalMonthScrollRef.value
  const block = el?.querySelector<HTMLElement>(`.personal-month-block[data-year="${year}"][data-month="${month}"]`)
  if (el && block) el.scrollTop = block.offsetTop
}

watch(personalViewMode, async (mode) => {
  if (mode === 'month') await scrollToMonth(personalAnchor.value.getFullYear(), personalAnchor.value.getMonth())
})

const personalNavLabel = computed(() => {
  if (personalViewMode.value === 'week') {
    const dates = personalWeekDates.value
    if (!dates.length) return ''
    const first = new Date(dates[0] + 'T00:00:00')
    const last = new Date(dates[dates.length - 1] + 'T00:00:00')
    return `${first.getMonth() + 1}/${first.getDate()} – ${last.getMonth() + 1}/${last.getDate()}`
  }
  return t('calendar.monthBadge', { n: personalAnchor.value.getMonth() + 1 })
})

async function personalNavigate(dir: 1 | -1) {
  if (personalViewMode.value === 'week') {
    const d = new Date(personalAnchor.value)
    d.setDate(d.getDate() + dir * personalDayCount.value)
    personalAnchor.value = d
    return
  }
  const d = new Date(personalAnchor.value)
  d.setMonth(d.getMonth() + dir)
  await scrollToMonth(d.getFullYear(), d.getMonth())
}
async function personalGoToday() {
  if (personalViewMode.value === 'week') { personalAnchor.value = new Date(); return }
  const now = new Date()
  await scrollToMonth(now.getFullYear(), now.getMonth())
}

// ──────────────────── 日付ユーティリティ ────────────────────
// toDateStr / isWeekend / fmtDateTime は shared/schedule-core.ts（admin と共有）から import 済み。
function formatDateLabel(date: string): string {
  const dt = new Date(date + 'T00:00:00')
  return t('calendar.dateLabel', { day: dt.getDate(), weekday: WEEKDAYS.value[weekdayIndex(date)] })
}

// ──────────────────── データ取得 ────────────────────
async function loadWorkers() {
  // account は身元優先（認証時は env で上書きしない＝テナント分離。env だと他テナントの作業員が並ぶ）
  const { getAccountId } = useAccount()
  const accId = await getAccountId()
  if (!accId) return
  const { data } = await supabase
    .from('workers')
    .select('id, name, birth_date')
    .eq('account_id', accId)
    .eq('active', true)
    .order('name')
  workers.value = data ?? []
}

async function loadSchedules() {
  await schedules.fetchSchedules(loadedFrom, loadedTo, [], effectiveWorkerId.value)
}

watch(() => proxy.proxyTarget.value, loadSchedules)

// ──────────────────── CRUD ────────────────────
function onCellTap(date: string, workerId: string) {
  formModal.value = {
    _worker_id: workerId,
    title: '', description: '', category: 'work', site_id: '',
    all_day: true, start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
    // 既定は非共有。ただし「自分以外のユーザーへ予定追加」時は既定ON（他者アサインは共有前提／方針C）。
    // 自分の予定(personalAddSchedule→effectiveWorkerId)は従来どおり非共有。ユーザーは保存前にトグルで変更可。
    is_public: workerId !== effectiveWorkerId.value,
    _contractor: '',
  } as any
  isPublicTouched.value = false   // 新規追加のたびに手動フラグをリセット（既定ON判定を有効化）
  selectedWorkerIds.value = new Set([workerId])   // タップした作業員を初期選択
  formError.value = ''
}

function openEdit(ev: Schedule) {
  detailModal.value = null
  formModal.value = {
    id: ev.id, _worker_id: ev.worker_id,
    title: ev.title, description: ev.description ?? '',
    category: ev.category, site_id: ev.site_id ?? '', all_day: ev.all_day,
    start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time ?? '', end_time: ev.end_time ?? '',
    is_night_shift: ev.is_night_shift,
    is_public: ev.is_public,   // 編集は既存値を維持（watchは id 有で自動更新しない）
    _contractor: '',
    _original: {
      title: ev.title, description: ev.description ?? null,
      start_date: ev.start_date, end_date: ev.end_date,
      start_time: ev.start_time ?? null, end_time: ev.end_time ?? null,
      is_night_shift: ev.is_night_shift,
    },
  } as any
  selectedWorkerIds.value = new Set([ev.worker_id])   // 編集対象の作業員（担当変更可）
  formError.value = ''
}

async function openDetail(ev: Schedule) {
  const { data } = await supabase
    .from('schedule_edits')
    .select('*')
    .eq('schedule_id', ev.id)
    .order('edited_at', { ascending: false })
  detailModal.value = { schedule: ev, edits: (data ?? []) as ScheduleEdit[] }
}

function closeDetail() { detailModal.value = null }

async function saveSchedule() {
  if (!formModal.value) return
  // __other__ の場合は customTitle を title に確定し、マスタに保存
  if (formModal.value.title === '__other__') {
    const custom = ((formModal.value as any)._customTitle ?? '').trim()
    if (!custom) { formError.value = t('calendar.errors.enterSiteName'); return }
    formModal.value.title = custom
    await master.saveSite(custom)
  } else if (formModal.value.title === '__none__') {
    // 現場なし: 自由タイトルを title に確定（現場マスタには保存しない＝プライベート/非現場の予定）
    const free = ((formModal.value as any)._noneTitle ?? '').trim()
    if (!free) { formError.value = t('calendar.errors.enterTitle'); return }
    formModal.value.title = free
    formModal.value.site_id = ''   // 現場紐付けなし
  }
  if (!formModal.value.title?.trim()) { formError.value = t('calendar.errors.selectSite'); return }
  if (!formModal.value.start_date || !formModal.value.end_date) { formError.value = t('calendar.errors.enterDate'); return }
  if (formModal.value.start_date > formModal.value.end_date) { formError.value = t('calendar.errors.endAfterStart'); return }
  const targetIds = [...selectedWorkerIds.value]
  if (targetIds.length === 0) { formError.value = t('calendar.errors.selectTarget'); return }
  saving.value = true; formError.value = ''
  try {
    // 時刻が両方入力されていれば時刻あり、なければ終日
    const hasTime = !!(formModal.value.start_time && formModal.value.end_time)
    formModal.value.all_day = !hasTime
    const form = formModal.value as ScheduleForm
    const workerName = proxy.proxyTarget.value?.name ?? profile.value?.displayName ?? undefined
    if (formModal.value.id) {
      // 編集: 既存予定を先頭の対象者に更新（担当変更を含む）、追加分は新規作成
      ;(form as any).worker_id = targetIds[0]
      const orig = (formModal.value as any)._original ?? {}
      await schedules.updateSchedule(formModal.value.id, form)
      // 編集履歴を記録（差分ビルダーは shared/schedule-core.ts＝admin と共有）
      const diffKeys = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'is_night_shift', 'description'] as const
      const norm = (v: unknown) => (v === '' || v === null || v === undefined) ? null : v
      const changes = buildScheduleDiff(orig, form as unknown as Record<string, unknown>, diffKeys, norm)
      if (Object.keys(changes).length) {
        await supabase.from('schedule_edits').insert({
          schedule_id: formModal.value.id,
          edited_by_name: workerName ?? t('calendar.unknown'),
          edited_at: new Date().toISOString(),
          changes,
        })
      }
      // 追加で選択された作業員には同内容で新規作成
      for (const wid of targetIds.slice(1)) {
        await schedules.createSchedule(form, wid, workerName)
      }
    } else {
      // 新規: 選択した各作業員に同内容で作成
      for (const wid of targetIds) {
        await schedules.createSchedule(form, wid, workerName)
      }
    }
    formModal.value = null
    await loadSchedules()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : t('calendar.errors.saveFailed')
  } finally { saving.value = false }
}

async function confirmDelete(id: string) {
  if (!confirm(t('calendar.confirmDelete'))) return
  detailModal.value = null
  const workerName = proxy.proxyTarget.value?.name ?? profile.value?.displayName ?? undefined
  try {
    await schedules.deleteSchedule(id, workerName)
    await loadSchedules()
  }
  catch (e) { alert(e instanceof Error ? e.message : t('calendar.errors.deleteFailed')) }
}

async function restore(ev: Schedule) {
  detailModal.value = null
  const { error } = await supabase.from('schedules').update({ deleted_at: null, deleted_by_name: null }).eq('id', ev.id)
  if (error) { alert(error.message); return }
  await loadSchedules()
}

// ──────────────────── 初期化 ────────────────────
onMounted(async () => {
  loading.value = true
  initCalendar()
  try {
    await master.fetch()
    await schedules.resolveMyWorkerId()
    await resolveCanManageCat()
    await loadWorkers()
    await loadSchedCats()
    await loadNotifs()
    await loadSchedules()
    // 自分が参加するグループを取得し、前回選択を復元（存在するグループのみ）
    const myWid = schedules.myWorkerId.value
    if (myWid) {
      await groupsApi.fetchMyGroups(myWid)
      try {
        const saved = localStorage.getItem(GROUP_KEY)
        if (saved && myGroups.value.some(g => g.id === saved)) selectedGroupId.value = saved
      } catch { /* ignore */ }
    }
  } finally {
    loading.value = false
    await nextTick()
    setupIO()
    scrollToToday()
  }
})
</script>

<style scoped>
.cal-page { display: flex; flex-direction: column; height: 100dvh; background: #fff; color: #111; overflow: hidden; }
.similar-site-pick { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.similar-site-pick:active { opacity: .6; }
.notif-banner { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; margin: 8px 12px; padding: 10px 12px; flex-shrink: 0; }
.notif-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 700; color: #b45309; }
.notif-dismiss { background: #f59e0b; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.notif-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #78350f; line-height: 1.6; }

/* 月ナビ（ヘッダー：年月のみ） */
.month-nav {
  display: flex; align-items: center; gap: 12px;
  padding: max(10px, env(safe-area-inset-top)) 12px 10px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0;
  background: #fff; position: relative; z-index: 2;
}
.nav-label { font-size: 16px; font-weight: 700; color: #111; }
.group-select {
  margin-left: auto; max-width: 55%;
  border: 1px solid #ccc; border-radius: 8px; padding: 6px 10px;
  font-size: 13px; font-family: inherit; background: #fff; color: #111;
}

/* 下部操作バー */
.bottom-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 10px 16px;
  border-top: 1px solid #E0E0E0; flex-shrink: 0;
  background: #fff;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 8px; padding: 10px 20px; font-size: 20px; cursor: pointer; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; font-weight: 600; }
.deleted-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #888; cursor: pointer; user-select: none; }

.loading { flex: 1; display: flex; align-items: center; justify-content: center; color: #888; font-size: 14px; }

.extend-loading-row { background: #fafbfc; }
.extend-loading-cell { text-align: center; padding: 10px 0; color: #999; font-size: 12px; }
.extend-spinner {
  display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -2px;
  border: 2px solid #ddd; border-top-color: #06C755; border-radius: 50%;
  animation: extend-spin .7s linear infinite;
}
@keyframes extend-spin { to { transform: rotate(360deg); } }

/* ── 共有／個人タブ ── */
.cal-tabs { display: flex; gap: 4px; padding: 8px 12px 0; background: #fff; flex-shrink: 0; }
.cal-tab {
  flex: 1; background: #f5f5f5; border: 1px solid #E0E0E0; color: #666;
  border-radius: 8px 8px 0 0; padding: 8px 4px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.cal-tab.active { background: #fff; border-bottom-color: #fff; color: #06C755; }

/* ── 個人カレンダー ── */
.personal-cal { flex: 1; display: flex; flex-direction: column; overflow-y: auto; background: #fff; }
.personal-nav {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  padding: 10px 12px; border-bottom: 1px solid #E0E0E0;
}
.personal-view-toggle { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #E0E0E0; }
.personal-view-toggle .cal-tab { flex: 0 0 auto; border-radius: 8px; padding: 6px 14px; }
.personal-view-toggle .today-btn { margin-left: auto; }

.personal-week { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #fff; }
.personal-chip { font-size: 11px; padding: 4px 6px; border-radius: 4px; }

/* 週ヘッダー（日付＋追加ボタン） */
.personal-week-head { display: grid; gap: 1px; background: #E0E0E0; border-bottom: 1px solid #E0E0E0; }
.week-head-corner { background: #fff; }
.personal-day-head {
  background: #fff; display: flex; align-items: center; justify-content: space-between; gap: 4px;
  font-size: 11px; font-weight: 700; color: #666; padding: 6px 6px 6px 8px; min-width: 0;
}
.personal-day-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.personal-day-head.date-sunday { color: #ef4444; }
.personal-day-head.date-saturday { color: #3b82f6; }
.personal-day-head.date-today { background: #ecfdf5; }
.week-head-add-btn {
  flex-shrink: 0; background: none; border: 1px dashed #ccc; border-radius: 6px;
  color: #aaa; font-size: 12px; padding: 2px 6px; cursor: pointer; line-height: 1.4;
}

/* 終日・時刻未設定の予定 */
.personal-week-allday { display: grid; gap: 1px; background: #E0E0E0; border-bottom: 1px solid #E0E0E0; }
.week-allday-col { background: #fbfbfb; padding: 2px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }

/* 時間軸タイムライン */
.personal-week-scroll { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.personal-week-timeline { display: grid; position: relative; }
.week-hour-axis { position: relative; border-right: 1px solid #E0E0E0; }
.week-hour-label { position: absolute; right: 4px; transform: translateY(-50%); font-size: 10px; color: #999; }
.week-day-timeline { position: relative; border-left: 1px solid #f0f0f0; min-width: 0; }
.week-day-timeline.date-sunday { background: #fff8f8; }
.week-day-timeline.date-saturday { background: #f8fafd; }
.week-day-timeline.date-today { background: #ecfdf5; }
.week-hour-line { position: absolute; left: 0; right: 0; border-top: 1px solid #f0f0f0; }
.week-timed-chip {
  font-size: 10px; padding: 2px 4px; border-radius: 4px; overflow: hidden; cursor: pointer;
  display: flex; flex-direction: column; line-height: 1.3; box-sizing: border-box;
}
.week-timed-chip .chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.week-timed-chip .chip-time { font-size: 9px; opacity: .85; }

.personal-month-scroll { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.personal-month-block { margin-bottom: 14px; }
.personal-month-block-label { font-size: 12px; font-weight: 700; color: #888; padding: 6px 4px 4px; }
.personal-month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #E0E0E0; }
.personal-month-wd { background: #f5f5f5; text-align: center; font-size: 11px; font-weight: 700; color: #666; padding: 6px 0; }
.personal-month-cell { background: #fff; min-height: 64px; padding: 2px; overflow: hidden; min-width: 0; }
.personal-month-cell.blank { background: #fafafa; }
.personal-month-daynum { font-size: 11px; color: #666; padding: 2px 4px; cursor: pointer; }
.personal-month-cell.date-sunday .personal-month-daynum { color: #ef4444; }
.personal-month-cell.date-saturday .personal-month-daynum { color: #3b82f6; }
.personal-month-cell.date-today { background: #ecfdf5; }
.personal-chip-sm {
  font-size: 10px; padding: 1px 4px; border-radius: 3px; margin: 1px 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; box-sizing: border-box;
}

/* グリッド */
.grid-wrap { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }

.matrix-table { border-collapse: collapse; min-width: 100%; }

/* 固定列・行 */
.sticky-col { position: sticky; left: 0; z-index: 2; background: #fff; }
thead th { position: sticky; top: 0; z-index: 10; background: #f8f9fa; border-bottom: 2px solid #E0E0E0; }
thead th.sticky-col { z-index: 11; }

.date-col-header { min-width: 60px; width: 60px; }

.worker-header {
  font-size: 11px; font-weight: 700; color: #444;
  padding: 8px 4px; text-align: center;
  min-width: 80px; border-left: 1px solid #E0E0E0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 90px;
}
.worker-header.my-col    { background: #f0fdf4; color: #06C755; }
.worker-header.pinned-col { background: #fef9ec; color: #b45309; }
.worker-header { cursor: pointer; user-select: none; }
.worker-header:active { opacity: .7; }
.pin-icon { font-size: 9px; margin-right: 2px; }
.pinned-col-cell { background: rgba(245, 158, 11, .03); }

/* 日付セル */
.date-cell {
  font-size: 11px; font-weight: 600;
  padding: 4px 6px; white-space: nowrap;
  border-right: 1px solid #E0E0E0;
  border-bottom: 1px solid #f0f0f0;
  color: #555; min-width: 60px; width: 60px;
}
.date-cell.date-sunday  { color: #ef4444; }
.date-cell.date-saturday { color: #3b82f6; }
.date-cell.date-today { background: #f0fdf4; color: #06C755; font-weight: 700; }
.month-badge { display: block; font-size: 9px; font-weight: 700; color: #06C755; line-height: 1; margin-bottom: 1px; }

/* 行 */
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }
.month-first-row > td { border-top: 2px solid #bbb; }

/* スケジュールセル */
.sched-cell {
  padding: 0; vertical-align: top;
  border-left: 1px solid #E0E0E0;
  border-bottom: 1px solid #f0f0f0;
  min-width: 80px; max-width: 90px;
  min-height: 72px;
}
.cell-inner {
  position: relative;
  display: flex; flex-direction: column;
  padding: 2px 3px;
  min-height: 72px;
}
.sched-cell.my-col-cell { background: rgba(6, 199, 85, .03); }
.birthday-badge { position: absolute; top: 1px; right: 2px; font-size: 13px; color: #f59e0b; pointer-events: none; }

/* スケジュールチップ */
.sched-chip {
  display: flex; flex-direction: column; gap: 1px;
  background: #e8f5ff; border-left: 3px solid #3b82f6;
  border-radius: 3px; padding: 3px 4px;
  margin-bottom: 2px; font-size: 10px; cursor: pointer;
  line-height: 1.4;
}
.sched-chip.night-shift {
  background: #2d2d3d; border-left-color: #6366f1; color: #e2e8f0;
}
.sched-chip.deleted-chip {
  opacity: .4; text-decoration: line-through;
  background: #f0f0f0; border-left-color: #bbb; color: #888;
}
.chip-title { word-break: break-all; white-space: normal; }
.chip-time { font-size: 9px; color: #60a5fa; }
.sched-chip.night-shift .chip-time { color: #a5b4fc; }

/* セル内 + ボタン */
.cell-add-btn {
  display: block; width: 100%;
  background: none; border: 1px dashed #ccc; border-radius: 3px;
  color: #bbb; font-size: 12px; cursor: pointer; padding: 0;
  min-height: 44px;
}
.cell-add-btn:active { background: #f0fdf4; border-color: #06C755; color: #06C755; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #f2f2f7; border-radius: 20px 20px 0 0; padding: 20px 16px 40px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 -4px 20px rgba(0,0,0,.1); }
.modal h2 { font-size: 17px; font-weight: 600; margin: 0 0 14px; color: #111; text-align: center; }

.form-worker-label {
  text-align: center; font-size: 14px; font-weight: 600;
  color: #06C755; margin-bottom: 12px;
}

/* 対象者（複数選択） */
.worker-card { padding: 14px; }
.worker-pick-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.group-pick { border: 1px solid #d0d0d0; border-radius: 8px; padding: 5px 8px; font-size: 12px; font-family: inherit; background: #fff; color: #111; max-width: 52%; }
.worker-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  max-height: 132px; overflow-y: auto; padding: 2px;
}
.worker-chip {
  border: 1px solid #e2e2e2; border-radius: 999px; padding: 4px 11px;
  font-size: 12.5px; line-height: 1.5; white-space: nowrap;
  font-family: inherit; background: #f6f6f6; color: #666; cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.worker-chip.on { background: #06C755; border-color: #06C755; color: #fff; font-weight: 700; }

.site-select {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px; cursor: pointer;
  font-family: inherit; margin-left: auto; max-width: 60%;
  text-align: right;
}

.form-card { background: #fff; border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
.cat-manage { max-width: 460px; }
.cat-manage-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cat-manage-title { font-size: 16px; font-weight: 700; color: #111; }
.cat-manage-close { background: none; border: none; color: #06C755; font-size: 14px; font-weight: 700; }
.cat-manage-hint { font-size: 12px; color: #64748b; margin: 0 0 10px; line-height: 1.5; }
.cat-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.cat-item { display: flex; align-items: center; gap: 10px; padding: 12px 2px; border-bottom: 1px solid #f0f0f0; }
.cat-item.inactive { opacity: .55; }
.cat-dot { flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.08) inset; }
.cat-name-input { flex: 1; min-width: 0; font-size: 15px; color: #111; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
.cat-active-toggle { flex-shrink: 0; background: #dcfce7; color: #15803d; border: none; border-radius: 999px; padding: 6px 16px; font-size: 13px; font-weight: 700; cursor: pointer; min-width: 68px; }
.cat-active-toggle.off { background: #f1f5f9; color: #94a3b8; }
.cat-select-wrap { display: flex; align-items: center; gap: 8px; flex: 1; }
.cat-select-wrap--gap { margin-left: 10px; }
.cat-manage-inline { margin-left: 8px; }
.cat-add-btn { flex-shrink: 0; background: #eef2ff; color: #4338ca; border: none; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 700; }
.form-row { display: flex; align-items: center; padding: 12px 14px; min-height: 44px; }
.form-divider { height: 1px; background: #f0f0f0; margin-left: 14px; }
.form-row-label { font-size: 15px; color: #111; flex-shrink: 0; }
.no-site-toggle { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #334155; cursor: pointer; padding: 12px 14px; margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.no-site-toggle input { width: 18px; height: 18px; flex-shrink: 0; }

.dt-input {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px; cursor: pointer; padding: 0;
  font-family: inherit; margin-left: auto;
  -webkit-appearance: none; appearance: none; min-height: 44px;
}
.dt-date { min-width: 110px; text-align: right; }
.dt-time { width: 80px; text-align: right; }
.dt-time-wrap { position: relative; display: inline-flex; align-items: center; }
/* iOS実機では -webkit-appearance:none の空 type=time がプレースホルダを描画せず
   完全な空白になるため、値が無いときだけ --:-- を重ねてタップ可能だと示す */
.dt-placeholder {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  color: #06C755; font-size: 15px; pointer-events: none; white-space: nowrap;
}
.dt-input::-webkit-calendar-picker-indicator { opacity: 0; width: 0; }
.dt-inline { display: flex; align-items: center; gap: 0; margin-left: auto; }
.dt-sep { width: 1px; height: 18px; background: #D0D0D0; margin: 0 6px; flex-shrink: 0; }

.ios-toggle { position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0; margin-left: auto; }
.ios-toggle input { opacity: 0; width: 0; height: 0; }
.ios-toggle-track { position: absolute; cursor: pointer; inset: 0; background: #E0E0E0; border-radius: 31px; transition: background .25s; }
.ios-toggle-track::before { content: ''; position: absolute; height: 27px; width: 27px; left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: transform .25s; box-shadow: 0 2px 4px rgba(0,0,0,.25); }
.ios-toggle input:checked + .ios-toggle-track { background: #06C755; }
.ios-toggle input:checked + .ios-toggle-track::before { transform: translateX(20px); }

.notes-row { padding: 8px 14px; }
.notes-input { width: 100%; border: none; outline: none; background: none; font-size: 15px; color: #111; font-family: inherit; resize: none; line-height: 1.5; }
.notes-input::placeholder { color: #c7c7cc; }

.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
.btn-cancel { flex: 1; background: #fff; color: #555; border: none; border-radius: 12px; padding: 14px; font-size: 16px; cursor: pointer; }
.btn-edit   { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.btn-delete { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }

.detail-night-badge { background: #2d2d3d; color: #a5b4fc; border-radius: 8px; padding: 4px 12px; font-size: 13px; font-weight: 700; margin-bottom: 10px; display: inline-block; }
.detail-title   { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #111; }
.detail-meta    { font-size: 13px; color: #555; margin: 0 0 4px; }
.detail-desc    { color: #888; font-size: 14px; margin: 8px 0 0; white-space: pre-wrap; }
.detail-created { color: #aaa; font-size: 12px; margin: 6px 0 0; }
.detail-deleted { color: #ef4444; font-size: 12px; margin: 4px 0 0; }
.edit-history { margin-top: 12px; border-top: 1px solid #e0e0e0; padding-top: 10px; }
.edit-history summary { font-size: 13px; color: #666; cursor: pointer; font-weight: 600; }
.edit-empty { font-size: 12px; color: #bbb; margin: 6px 0 0; }
.edit-entry { padding: 6px 0; border-bottom: 1px solid #f5f5f5; }
.edit-header { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.edit-who { font-weight: 600; color: #333; }
.edit-when { color: #aaa; }
.edit-changes { margin: 4px 0 0 8px; padding: 0; list-style: none; font-size: 11px; color: #555; display: flex; flex-direction: column; gap: 2px; }
.edit-field { font-weight: 600; color: #444; }
.edit-old { color: #ef4444; text-decoration: line-through; }
.edit-new { color: #16a34a; }
.btn-restore { flex: 1; background: #f59e0b; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
</style>
