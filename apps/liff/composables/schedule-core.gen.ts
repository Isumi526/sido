// ⚠️ AUTO-GENERATED from shared/schedule-core.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/schedule-core.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/schedule-core.ts  ★単一ソース（admin / liff 共有）
//  予定管理カレンダー（calendar.vue / calendar/index.vue）で重複していた
//  純粋ロジック（日付グリッド生成・週末判定・セル別予定抽出・カテゴリ色スタイル・
//  編集差分ビルダー）をまとめる。
//  ここだけを編集し、`npm run sync:shared` で各アプリの
//  schedule-core.gen.ts を再生成すること（手動コピーは禁止＝直し漏れ防止）。
//  ※ import を持たない自己完結ファイル（各アプリへそのままコピーされるため）。
// ============================================================

// ──────────────────── 日付・グリッド ────────────────────

/** Date → 'YYYY-MM-DD'（ローカルタイムゾーン基準） */
export function toDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** base の月初から n ヶ月ずらした Date（日は1日固定） */
export function shiftMonth(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return d
}

/** year/month(0-11) の月内全日付を 'YYYY-MM-DD' 配列で返す */
export function genMonthDates(year: number, month: number): string[] {
  const last = new Date(year, month + 1, 0).getDate()
  const dates: string[] = []
  for (let day = 1; day <= last; day++) {
    dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return dates
}

/** 'YYYY-MM-DD' の曜日インデックス(0=日〜6=土)。ラベル文言はアプリ側の WEEKDAYS 配列で解決する */
export function weekdayIndex(date: string): number {
  return new Date(date + 'T00:00:00').getDay()
}

/** 'YYYY-MM-DD' が土日か */
export function isWeekend(date: string): boolean {
  const dow = weekdayIndex(date)
  return dow === 0 || dow === 6
}

/** 日付セルの装飾クラス（日曜/土曜/今日） */
export function dateCellClass(date: string, todayStr: string): Record<string, boolean> {
  const dow = weekdayIndex(date)
  return {
    'date-sunday':   dow === 0,
    'date-saturday': dow === 6,
    'date-today':    date === todayStr,
  }
}

/** ISO日時 → 'M/D HH:MM' 表示（編集履歴・削除日時などのメタ表示用） */
export function fmtDateTime(iso: string): string {
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// ──────────────────── セル別予定抽出 ────────────────────

export interface ScheduleCoreItem {
  id:             string
  worker_id:      string
  start_date:     string
  end_date:       string
  start_time?:    string | null
  category:       string
  is_night_shift: boolean
  deleted_at?:    string | null
}

/**
 * 指定日付×作業員のセルに表示すべき予定を抽出する。
 * sortByStartTime=true の時だけ開始時刻の昇順に並べる（未設定は末尾）。
 * 既定 false（呼び出し元の元の並び=クエリ順を維持）。
 */
export function cellSchedules<T extends ScheduleCoreItem>(
  all: readonly T[],
  date: string,
  workerId: string,
  showDeleted: boolean,
  sortByStartTime = false,
): T[] {
  const rows = all.filter(
    s => s.worker_id === workerId && s.start_date <= date && s.end_date >= date
      && (showDeleted || !s.deleted_at),
  )
  if (!sortByStartTime) return rows
  return [...rows].sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'))
}

/** 既定のカテゴリフォールバック色（カテゴリマスタに色が無い時） */
export const FALLBACK_CATEGORY_COLOR = '#94a3b8'

/**
 * 予定チップのスタイル（カテゴリ色の左バー＋夜勤/削除済みの見た目）。
 * 削除済みは常に空オブジェクト（グレー表示はCSS側の .deleted-chip に任せる＝既存挙動を維持）。
 */
export function chipStyle(
  s: { category: string; is_night_shift: boolean; deleted_at?: string | null },
  categoryColor: Record<string, string>,
  fallbackColor: string = FALLBACK_CATEGORY_COLOR,
): Record<string, string> {
  if (s.deleted_at) return {}
  const col = categoryColor[s.category] || fallbackColor
  if (s.is_night_shift) return { borderLeftColor: col, borderLeftWidth: '6px' }
  return { borderLeftColor: col, borderLeftWidth: '6px', background: col + '26' }   // 26≒15%
}

// ──────────────────── 編集差分ビルダー（schedule_edits 監査ログ） ────────────────────

/**
 * 編集前(orig)/編集後(next) を keys で比較し、変わったフィールドだけの差分マップを作る。
 * normalize は値の同一視ルール（アプリごとに既存挙動を維持するため呼び出し元で指定可能）。
 * 既定は「undefined → null」のみ正規化（admin の既存 `?? null` 相当）。
 */
export function buildScheduleDiff<T extends Record<string, unknown>>(
  orig: Partial<T>,
  next: Partial<T>,
  keys: readonly (keyof T & string)[],
  normalize: (v: unknown) => unknown = (v) => (v === undefined ? null : v),
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const k of keys) {
    const ov = normalize((orig as Record<string, unknown>)[k])
    const nv = normalize((next as Record<string, unknown>)[k])
    if (ov !== nv) changes[k] = { old: ov, new: nv }
  }
  return changes
}
