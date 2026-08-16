// ============================================================
//  lib/workerHours.ts
//  ★計算ロジックの正典は shared/worker-hours.ts（npm run sync:shared で配布）。
//   ここは「admin 固有の表示」だけを持つ。
//   2026-08-16 まで liff と2本に分かれ、**同じ関数名で workedMin の意味が
//   違っていた**（liff=累積 / admin=その現場ぶん）。統合して admin 版を正とした。
//
//  ★getRateLines だけは共有しない。ラベルを日本語直書きで出すため（liff は i18n）。
// ============================================================
import type { RateBreakdown, RateLine } from './worker-hours.gen'

export * from './worker-hours.gen'

/** 料率別の内訳を表示用の行にする */
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
