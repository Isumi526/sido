// ============================================================
//  utils/workerHours.ts
//  稼働時間の料率別時間計算
//
//  加算ルール（全組み合わせ対応）:
//   基本       : 1.00
//   残業       : +0.25
//   深夜       : +0.25
//   法定休日   : 基本が 1.35 に変わる（+0.35）
//
//   通常               1.00
//   残業               1.25
//   深夜               1.25
//   残業+深夜          1.50
//   法定休日           1.35
//   法定休日+残業      1.60
//   法定休日+深夜      1.60
//   法定休日+残業+深夜 1.85
// ============================================================

export interface RateBreakdown {
  hoursNormal:        number  // 1.00  通常
  hoursOT:            number  // 1.25  残業
  hoursNight:         number  // 1.25  深夜
  hoursOTNight:       number  // 1.50  残業+深夜
  hoursSunday:        number  // 1.35  法定休日
  hoursSundayOT:      number  // 1.60  法定休日+残業
  hoursSundayNight:   number  // 1.60  法定休日+深夜
  hoursSundayOTNight: number  // 1.85  法定休日+残業+深夜
}

export interface RateLine {
  label: string
  hours: number
  rate:  string
  color: string
}

export function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 深夜帯: 22:00〜翌5:00 */
function isDeepNight(minuteOfDay: number): boolean {
  const m = ((minuteOfDay % 1440) + 1440) % 1440
  return m >= 1320 || m < 300
}

/** 休憩ウィンドウ（分単位、日跨ぎ補正済み） */
interface BreakWindow { start: number; end: number }

/**
 * 勤務時間帯に含まれる休憩ウィンドウを返す
 * 判定: startMin < breakTime < endMin（厳密不等号）
 */
function getBreakWindows(
  workerRole: 'factory' | 'site',
  startTime: string,
  endTime: string,
): BreakWindow[] {
  const startMin = parseMin(startTime || '08:00')
  let   endMin   = parseMin(endTime   || '17:30')
  if (endMin <= startMin) endMin += 1440

  const isNight = startMin >= 18 * 60  // 18:00以降スタート = 夜勤

  const windows: BreakWindow[] = []

  const addBreak = (breakHour: number, durationMin: number) => {
    let bt = breakHour * 60
    // 日跨ぎ: breakTime がシフト開始以前なら翌日扱い
    if (bt <= startMin) bt += 1440
    if (startMin < bt && bt < endMin)
      windows.push({ start: bt, end: bt + durationMin })
  }

  if (!isNight) {
    // 昼勤: 10時・昼・15時
    const small = workerRole === 'factory' ? 15 : 30
    addBreak(10, small)  // 10時休憩
    addBreak(12, 60)     // 昼休憩
    addBreak(15, small)  // 15時休憩
  } else {
    // 夜勤: 22時・AM1時・AM3時（各30分）
    addBreak(22, 30)
    addBreak(1,  30)
    addBreak(3,  30)
  }

  return windows
}

/**
 * 勤務時間帯に応じた休憩時間（分）を自動計算する
 * @param workerRole - 'factory'（工場）or 'site'（現場）
 * @param startTime  - 開始時刻 "HH:MM"
 * @param endTime    - 終了時刻 "HH:MM"
 */
export function calcBreakMinutes(
  workerRole: 'factory' | 'site',
  startTime: string,
  endTime: string,
): number {
  return getBreakWindows(workerRole, startTime, endTime)
    .reduce((sum, w) => sum + (w.end - w.start), 0)
}

export function computeWorkerHours(
  startTime:      string,
  endTime:        string,
  breakMinutes:   number,
  isSunday:       boolean,
  prevWorkedMin = 0,
): RateBreakdown & { workedMin: number } {
  const zero = {
    hoursNormal: 0, hoursOT: 0, hoursNight: 0, hoursOTNight: 0,
    hoursSunday: 0, hoursSundayOT: 0, hoursSundayNight: 0, hoursSundayOTNight: 0,
    workedMin: 0,
  }

  let startMin = parseMin(startTime || '08:00')
  let endMin   = parseMin(endTime   || '17:30')
  if (endMin <= startMin) endMin += 1440

  const totalMin = endMin - startMin
  if (totalMin <= 0 || breakMinutes >= totalMin) return zero

  // ブレーク配置: シフト開始4h後（最大 totalMin - breakMin で詰める）
  // 15分刻みでスナップ（15分休憩にも対応）
  const breakOffset   = Math.min(240, totalMin - breakMinutes)
  const breakStartMin = startMin + Math.round(breakOffset / 15) * 15
  const breakEndMin   = breakStartMin + breakMinutes

  const OT = 480  // 8h = 480min
  let workedMin = prevWorkedMin  // 前現場からの累積を引き継ぐ

  let hoursNormal = 0, hoursOT = 0, hoursNight = 0, hoursOTNight = 0
  let hoursSunday = 0, hoursSundayOT = 0, hoursSundayNight = 0, hoursSundayOTNight = 0
  let ownWorkedMin = 0

  for (let t = startMin; t < endMin; t += 15) {
    if (t >= breakStartMin && t < breakEndMin) continue  // 休憩スキップ

    const dn = isDeepNight(t)
    const ot = workedMin >= OT

    if (isSunday) {
      if      (dn && ot) hoursSundayOTNight += 0.25  // 1.85
      else if (ot)       hoursSundayOT      += 0.25  // 1.60
      else if (dn)       hoursSundayNight   += 0.25  // 1.60
      else               hoursSunday        += 0.25  // 1.35
    } else {
      if      (dn && ot) hoursOTNight += 0.25  // 1.50
      else if (ot)       hoursOT      += 0.25  // 1.25
      else if (dn)       hoursNight   += 0.25  // 1.25
      else               hoursNormal  += 0.25  // 1.00
    }
    workedMin    += 15
    ownWorkedMin += 15
  }

  return { hoursNormal, hoursOT, hoursNight, hoursOTNight,
           hoursSunday, hoursSundayOT, hoursSundayNight, hoursSundayOTNight,
           workedMin: ownWorkedMin }
}

/** プレビュー用: 各料率の行データを返す（0hの行は省略） */
export function getRateLines(r: RateBreakdown): RateLine[] {
  const lines: RateLine[] = []
  if (r.hoursNormal        > 0) lines.push({ label: '通常',              hours: r.hoursNormal,        rate: '×1.00', color: '#374151' })
  if (r.hoursOT            > 0) lines.push({ label: '残業',              hours: r.hoursOT,            rate: '×1.25', color: '#D97706' })
  if (r.hoursNight         > 0) lines.push({ label: '深夜',              hours: r.hoursNight,         rate: '×1.25', color: '#7C3AED' })
  if (r.hoursOTNight       > 0) lines.push({ label: '残業+深夜',         hours: r.hoursOTNight,       rate: '×1.50', color: '#DC2626' })
  if (r.hoursSunday        > 0) lines.push({ label: '法定休日',          hours: r.hoursSunday,        rate: '×1.35', color: '#059669' })
  if (r.hoursSundayOT      > 0) lines.push({ label: '法定休日+残業',     hours: r.hoursSundayOT,      rate: '×1.60', color: '#EA580C' })
  if (r.hoursSundayNight   > 0) lines.push({ label: '法定休日+深夜',     hours: r.hoursSundayNight,   rate: '×1.60', color: '#6D28D9' })
  if (r.hoursSundayOTNight > 0) lines.push({ label: '法定休日+残業+深夜', hours: r.hoursSundayOTNight, rate: '×1.85', color: '#9F1239' })
  return lines
}

// ── 昇給(単価変更)履歴を使った「日付別の有効単価」解決 ────────────────
export type WageChange = { effectiveDate: string; oldUnitPrice: number | null; newUnitPrice: number }

/** wage_history 行 → 作業員ごとの timeline（effectiveDate 昇順）。effective_date 未設定行は changed_at の日付で代替。 */
export function buildWageTimelines(
  rows: { worker_id: string; effective_date?: string | null; changed_at?: string | null; old_unit_price: number | null; new_unit_price: number }[],
): Map<string, WageChange[]> {
  const m = new Map<string, WageChange[]>()
  for (const r of rows ?? []) {
    const ed = (r.effective_date || (r.changed_at || '').slice(0, 10))
    if (!ed || !r.worker_id) continue
    const arr = m.get(r.worker_id) ?? []
    arr.push({ effectiveDate: ed, oldUnitPrice: r.old_unit_price, newUnitPrice: r.new_unit_price })
    m.set(r.worker_id, arr)
  }
  for (const arr of m.values()) arr.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  return m
}

/** 日報日付(YYYY-MM-DD)に有効だった日当単価。timeline は effectiveDate 昇順。
 *  date >= effectiveDate の最新 newUnitPrice。全昇給より前なら最古の oldUnitPrice、履歴無しは currentPrice。 */
export function unitPriceForDate(date: string, timeline: WageChange[] | undefined, currentPrice: number): number {
  if (!timeline || timeline.length === 0) return currentPrice
  let applied: number | null = null
  for (const c of timeline) {
    if (c.effectiveDate <= date) applied = c.newUnitPrice
    else break
  }
  if (applied != null) return applied
  const firstOld = timeline[0].oldUnitPrice
  return firstOld != null ? firstOld : currentPrice
}

/** 料率別時間 × 日当単価(/8h) で人件費を算出 */
export function laborCostForBreakdown(b: RateBreakdown, unitPrice: number): number {
  if (!unitPrice) return 0
  const ph = unitPrice / 8
  return Math.round(
    (b.hoursNormal        || 0) * ph * 1.00 +
    (b.hoursOT            || 0) * ph * 1.25 +
    (b.hoursNight         || 0) * ph * 1.25 +
    (b.hoursOTNight       || 0) * ph * 1.50 +
    (b.hoursSunday        || 0) * ph * 1.35 +
    (b.hoursSundayOT      || 0) * ph * 1.60 +
    (b.hoursSundayNight   || 0) * ph * 1.60 +
    (b.hoursSundayOTNight || 0) * ph * 1.85,
  )
}

export const ZERO_BREAKDOWN: RateBreakdown = {
  hoursNormal: 0, hoursOT: 0, hoursNight: 0, hoursOTNight: 0,
  hoursSunday: 0, hoursSundayOT: 0, hoursSundayNight: 0, hoursSundayOTNight: 0,
}

/**
 * 1日報(=1人1日)の sites[] から、各作業員(worker)の料率別時間を再計算して返す。
 * 日報には開始/終了/休憩のみが保存され hoursNormal 等は持たないため、
 * ここで実時間から計算する（保存値依存をやめ「通常×8h固定」バグを解消）。
 * 同一作業員が複数現場に跨る場合は startTime 順に 8h 超過分を累積して残業判定する
 * （worker-reports.vue と同じ現場跨ぎ残業ルール）。
 * @returns 各 worker オブジェクト参照 → RateBreakdown の Map（参照一致で引く）
 */
export function laborBreakdownForReport(
  sites: any[],
  isSunday: boolean,
): Map<any, RateBreakdown> {
  const result = new Map<any, RateBreakdown>()
  // 作業員(workerId||workerName)ごとに現場セグメントを集める
  const byWorker: Record<string, { w: any; start: number }[]> = {}
  for (const site of sites ?? []) {
    for (const w of (site?.workers ?? [])) {
      if (!w?.workerName) continue
      const key = String(w.workerId ?? w.workerName)
      ;(byWorker[key] ??= []).push({ w, start: parseMin(w.startTime || '08:00') })
    }
  }
  for (const segs of Object.values(byWorker)) {
    segs.sort((a, b) => a.start - b.start)  // 早い現場から累積
    let acc = 0
    for (const { w } of segs) {
      const role = (w.workerRole === 'factory' ? 'factory' : 'site') as 'factory' | 'site'
      const start = w.startTime || '08:00'
      const end   = w.endTime   || '17:30'
      const brk   = (w.breakMinutes != null) ? w.breakMinutes : calcBreakMinutes(role, start, end)
      const h = computeWorkerHours(start, end, brk, isSunday, acc)
      acc += h.workedMin
      const { workedMin: _wm, ...breakdown } = h
      result.set(w, breakdown)
    }
  }
  return result
}

/** 出張手当（+¥3,000/日・作業員ごと）。出張日(daily_reports.is_business_trip)に計上。 */
export const BUSINESS_TRIP_ALLOWANCE = 3000

/**
 * 出張日に出張手当を二重計上せず計上するための
 * 「各作業員の主たる現場（その日 最も稼働時間が長い現場）の worker-entry」集合。
 * 同一作業員が複数現場に跨る出張日でも、最長現場の1エントリだけを対象にする＝+3000は1回だけ。
 * 戻り値 Set に含まれる worker オブジェクト参照（= site.workers[] の要素）に手当を加える。
 */
export function businessTripMainEntries(sites: any[]): Set<any> {
  const byWorker: Record<string, { w: any; mins: number }[]> = {}
  for (const site of sites ?? []) {
    for (const w of (site?.workers ?? [])) {
      if (!w?.workerName) continue
      const role  = (w.workerRole === 'factory' ? 'factory' : 'site') as 'factory' | 'site'
      const start = w.startTime || '08:00'
      const end   = w.endTime   || '17:30'
      const brk   = (w.breakMinutes != null) ? w.breakMinutes : calcBreakMinutes(role, start, end)
      const mins  = Math.max(0, parseMin(end) - parseMin(start) - brk)
      const key   = String(w.workerId ?? w.workerName)
      ;(byWorker[key] ??= []).push({ w, mins })
    }
  }
  const set = new Set<any>()
  for (const segs of Object.values(byWorker)) {
    let best: { w: any; mins: number } | null = null
    for (const s of segs) if (!best || s.mins > best.mins) best = s
    if (best) set.add(best.w)
  }
  return set
}

/** 30分刻みの時刻オプション "00:00"〜"23:30" */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

/** 休憩時間オプション（分） */
export const BREAK_OPTIONS = [0, 30, 60, 90, 120, 150, 180]
