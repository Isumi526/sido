// ============================================================
//  paidLeaveGrant.ts — 有給の法令付与計算（純関数）
//  paid-leave.vue（付与UI）と navBadges.ts（付与待ちバッジ）で共用。
//  労基法の付与日数テーブル・勤続月数・基準日計算・未付与の基準日算出。
// ============================================================

// 法令付与日数テーブル（勤続月数 → 日数）
const FULLTIME_TABLE: { minMonths: number; days: number }[] = [
  { minMonths: 78, days: 20 },
  { minMonths: 66, days: 18 },
  { minMonths: 54, days: 16 },
  { minMonths: 42, days: 14 },
  { minMonths: 30, days: 12 },
  { minMonths: 18, days: 11 },
  { minMonths:  6, days: 10 },
]
// 比例付与（週所定労働日数 → 勤続ステップ別の日数）
const PARTTIME_TABLE: Record<number, number[]> = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6,  8,  9, 10, 11],
  2: [3, 4, 4,  5,  6,  6,  7],
  1: [1, 2, 2,  2,  3,  3,  3],
}
const TENURE_STEPS = [6, 18, 30, 42, 54, 66, 78]

// 勤続月数（day-of-month は無視）
export function tenureMonths(hireDate: string): number {
  const hire = new Date(hireDate)
  const now  = new Date()
  return (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth())
}

// 日付文字列(YYYY-MM-DD)に months ヶ月足す
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 勤続月数 → 法令付与日数（雇用形態・週所定労働日数で分岐）
export function daysForTenureMonths(months: number, employmentType: string | null | undefined, weeklyDays: number | null | undefined): number {
  if (months < 6) return 0
  if ((employmentType ?? 'fulltime') === 'fulltime') {
    return FULLTIME_TABLE.find(r => months >= r.minMonths)?.days ?? 0
  }
  const days = weeklyDays ?? 5
  if (days >= 5) return FULLTIME_TABLE.find(r => months >= r.minMonths)?.days ?? 0
  const table = PARTTIME_TABLE[days]
  if (!table) return 0
  const idx = TENURE_STEPS.filter(m => months >= m).length - 1
  return idx < 0 ? 0 : (table[idx] ?? 0)
}

// 入社日基準の付与日数（現時点）
export function suggestedGrantDays(hireDate: string | null, employmentType: string | null | undefined, weeklyDays: number | null | undefined): number {
  if (!hireDate || employmentType === 'contractor') return 0
  return daysForTenureMonths(tenureMonths(hireDate), employmentType, weeklyDays)
}

// 未付与の基準日（入社+6,+18…今日まで・既存付与日に無い・失効前・除外指定でない）。自動付与と付与待ちバッジで共用。
//  excludedDates: 恒久除外する基準日(削除で記録)。ここに含まれる基準日はスキップ＝再付与しない。
export function pendingBaseDatesFor(
  hireDate: string | null, employmentType: string | null | undefined, weeklyDays: number | null | undefined,
  existingGrantDates: Set<string>, todayStr: string, excludedDates?: Set<string>,
): { granted: string; expires: string; days: number; note: string }[] {
  if (!hireDate || employmentType === 'contractor') return []
  const rows: { granted: string; expires: string; days: number; note: string }[] = []
  for (let m = 6; ; m += 12) {
    const granted = addMonths(hireDate, m)
    if (granted > todayStr) break
    if (existingGrantDates.has(granted)) continue
    if (excludedDates?.has(granted)) continue         // 恒久除外された基準日はスキップ
    const expires = addMonths(granted, 24)
    if (expires < todayStr) continue
    const days = daysForTenureMonths(m, employmentType, weeklyDays)
    if (days <= 0) continue
    rows.push({ granted, expires, days, note: `自動付与（勤続${m}ヶ月）` })
  }
  return rows
}
