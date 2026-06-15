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
import { gt } from '~/utils/i18n-global'

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
  startWorkedMin: number = 0,  // 前現場までの累積稼働分（現場跨ぎ残業対応）
): RateBreakdown & { workedMin: number } {
  const zero: RateBreakdown = {
    hoursNormal: 0, hoursOT: 0, hoursNight: 0, hoursOTNight: 0,
    hoursSunday: 0, hoursSundayOT: 0, hoursSundayNight: 0, hoursSundayOTNight: 0,
  }

  let startMin = parseMin(startTime || '08:00')
  let endMin   = parseMin(endTime   || '17:30')
  if (endMin <= startMin) endMin += 1440

  const totalMin = endMin - startMin
  if (totalMin <= 0 || breakMinutes >= totalMin) return { ...zero, workedMin: startWorkedMin }

  // ブレーク配置: シフト開始4h後（最大 totalMin - breakMin で詰める）
  // 15分刻みでスナップ（15分休憩にも対応）
  const breakOffset   = Math.min(240, totalMin - breakMinutes)
  const breakStartMin = startMin + Math.round(breakOffset / 15) * 15
  const breakEndMin   = breakStartMin + breakMinutes

  const OT = 480  // 8h = 480min
  let workedMin = startWorkedMin  // 前現場までの累積を引き継ぐ

  let hoursNormal = 0, hoursOT = 0, hoursNight = 0, hoursOTNight = 0
  let hoursSunday = 0, hoursSundayOT = 0, hoursSundayNight = 0, hoursSundayOTNight = 0

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
    workedMin += 15
  }

  return { hoursNormal, hoursOT, hoursNight, hoursOTNight,
           hoursSunday, hoursSundayOT, hoursSundayNight, hoursSundayOTNight, workedMin }
}

/** プレビュー用: 各料率の行データを返す（0hの行は省略） */
export function getRateLines(r: RateBreakdown): RateLine[] {
  const lines: RateLine[] = []
  if (r.hoursNormal        > 0) lines.push({ label: gt('hours.normal'),        hours: r.hoursNormal,        rate: '×1.00', color: '#374151' })
  if (r.hoursOT            > 0) lines.push({ label: gt('hours.ot'),            hours: r.hoursOT,            rate: '×1.25', color: '#D97706' })
  if (r.hoursNight         > 0) lines.push({ label: gt('hours.night'),         hours: r.hoursNight,         rate: '×1.25', color: '#7C3AED' })
  if (r.hoursOTNight       > 0) lines.push({ label: gt('hours.otNight'),       hours: r.hoursOTNight,       rate: '×1.50', color: '#DC2626' })
  if (r.hoursSunday        > 0) lines.push({ label: gt('hours.sunday'),        hours: r.hoursSunday,        rate: '×1.35', color: '#059669' })
  if (r.hoursSundayOT      > 0) lines.push({ label: gt('hours.sundayOT'),      hours: r.hoursSundayOT,      rate: '×1.60', color: '#EA580C' })
  if (r.hoursSundayNight   > 0) lines.push({ label: gt('hours.sundayNight'),   hours: r.hoursSundayNight,   rate: '×1.60', color: '#6D28D9' })
  if (r.hoursSundayOTNight > 0) lines.push({ label: gt('hours.sundayOTNight'), hours: r.hoursSundayOTNight, rate: '×1.85', color: '#9F1239' })
  return lines
}

/** 30分刻みの時刻オプション "00:00"〜"23:30" */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

/** 休憩時間オプション（分） */
export const BREAK_OPTIONS = [0, 30, 60, 90, 120, 150, 180]
