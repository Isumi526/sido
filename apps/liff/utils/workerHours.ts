// ============================================================
//  apps/liff / utils/workerHours.ts
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

function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 深夜帯: 22:00〜翌5:00 */
function isDeepNight(minuteOfDay: number): boolean {
  const m = ((minuteOfDay % 1440) + 1440) % 1440
  return m >= 1320 || m < 300
}

export function computeWorkerHours(
  startTime:    string,
  endTime:      string,
  breakMinutes: number,
  isSunday:     boolean,
): RateBreakdown {
  const zero: RateBreakdown = {
    hoursNormal: 0, hoursOT: 0, hoursNight: 0, hoursOTNight: 0,
    hoursSunday: 0, hoursSundayOT: 0, hoursSundayNight: 0, hoursSundayOTNight: 0,
  }

  let startMin = parseMin(startTime || '08:00')
  let endMin   = parseMin(endTime   || '17:00')
  if (endMin <= startMin) endMin += 1440

  const totalMin = endMin - startMin
  if (totalMin <= 0 || breakMinutes >= totalMin) return zero

  // ブレーク配置: シフト開始4h後（最大 totalMin - breakMin で詰める）
  const breakOffset   = Math.min(240, totalMin - breakMinutes)
  const breakStartMin = startMin + Math.round(breakOffset / 30) * 30
  const breakEndMin   = breakStartMin + breakMinutes

  const OT = 480  // 8h = 480min
  let workedMin = 0

  let hoursNormal = 0, hoursOT = 0, hoursNight = 0, hoursOTNight = 0
  let hoursSunday = 0, hoursSundayOT = 0, hoursSundayNight = 0, hoursSundayOTNight = 0

  for (let t = startMin; t < endMin; t += 30) {
    if (t >= breakStartMin && t < breakEndMin) continue  // 休憩スキップ

    const dn = isDeepNight(t)
    const ot = workedMin >= OT

    if (isSunday) {
      if      (dn && ot) hoursSundayOTNight += 0.5  // 1.85
      else if (ot)       hoursSundayOT      += 0.5  // 1.60
      else if (dn)       hoursSundayNight   += 0.5  // 1.60
      else               hoursSunday        += 0.5  // 1.35
    } else {
      if      (dn && ot) hoursOTNight += 0.5  // 1.50
      else if (ot)       hoursOT      += 0.5  // 1.25
      else if (dn)       hoursNight   += 0.5  // 1.25
      else               hoursNormal  += 0.5  // 1.00
    }
    workedMin += 30
  }

  return { hoursNormal, hoursOT, hoursNight, hoursOTNight,
           hoursSunday, hoursSundayOT, hoursSundayNight, hoursSundayOTNight }
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

/** 30分刻みの時刻オプション "00:00"〜"23:30" */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

/** 休憩時間オプション（分） */
export const BREAK_OPTIONS = [0, 30, 60, 90, 120, 150, 180]
