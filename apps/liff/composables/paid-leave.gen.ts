// ⚠️ AUTO-GENERATED from shared/paid-leave.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/paid-leave.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/paid-leave.ts — 有給の法令付与計算(純関数・単一ソース)
//  admin(付与UI/バッジ)と liff(作業員の有給状況ページ)で共用。sync:shared で各アプリへ .gen 生成。
//  労基法の付与日数テーブル・勤続月数・基準日計算・FIFO残高・未付与の基準日算出。
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

// FIFO残高計算: 消化(初期使用済み＋システム使用)を失効が近い付与から順に充当し、各付与の残を出す。
//  通常の年次付与(失効=付与+24ヶ月で一律)なら「古い付与から」と「失効が近い付与から」は一致するが、
//  移行初期残高等の失効日が不規則な手動付与が混じると食い違いうる＝消化順の意図(失効が近い方を優先し
//  切り捨てを防ぐ)を直接表現するため expires_at でソートする(2026-07-13)。
//  失効した付与は「未使用分のみ消滅」＝消化済み分は残に影響しない（従来の『有効付与合計−全期間使用』の
//  過少計上バグを修正）。remaining = 有効な付与の未消化分の合計 −（付与総量を超えた過剰消化分）。
export type GrantLite = { granted_at: string; expires_at: string; days: number }
export function fifoBalance(
  grants: GrantLite[], consumed: number, todayStr: string,
): { remaining: number; validGranted: number; perGrant: (GrantLite & { used: number; leftover: number; expired: boolean })[] } {
  const sorted = [...grants].sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.granted_at.localeCompare(b.granted_at))  // 失効が近い付与から
  let c = Math.max(0, consumed)
  let validRemaining = 0, validGranted = 0
  const perGrant: (GrantLite & { used: number; leftover: number; expired: boolean })[] = []
  for (const g of sorted) {
    const days = Number(g.days) || 0
    const used = Math.min(c, days)   // FIFO: 古い付与から消化を充当
    c -= used
    const leftover = days - used
    const expired = g.expires_at < todayStr
    if (!expired) { validRemaining += leftover; validGranted += days }
    perGrant.push({ ...g, used, leftover, expired })
  }
  // c>0 = 付与総量を超えた消化（過剰）。有効残から引く（通常は c=0）。
  return { remaining: validRemaining - c, validGranted, perGrant }
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

// ── 半日・時間単位の有給（2026-08-30 追加） ────────────────────
//
//  ★法令の前提（分岐に直結するので明記する）
//   - 半日単位年休: 法令上の定めが無く **労使協定は不要**。会社の判断で導入できる。
//   - 時間単位年休: 労基法39条4項。**労使協定が必須**で、**年5日分が上限**。
//     「1日分が何時間か」も協定で定める。
//  → 半日は無条件、時間単位はアカウント設定（労使協定あり）で開き、年5日を超えさせない。

/** 時間単位年休の年間上限（労基法39条4項）。日数で5日ぶんまで。 */
export const HOURLY_LEAVE_ANNUAL_CAP_DAYS = 5

/** 1日ぶんの所定労働時間の既定。労使協定で別途定めた場合はアカウント設定で上書きする。 */
export const DEFAULT_LEAVE_DAY_HOURS = 8

export type LeaveUnit = 'day' | 'half' | 'hour'

/**
 * 消化量（日数）を出す。集計はこの値を合計する。
 * ★時間単位は「時間数 ÷ 1日の所定労働時間」。端数は丸めない（0.125日＝1時間/8h などをそのまま持つ）。
 */
export function leaveDaysFor(unit: LeaveUnit, hours?: number | null, dayHours?: number | null): number {
  if (unit === 'half') return 0.5
  if (unit === 'hour') {
    const h = Math.max(0, Number(hours) || 0)
    const per = Math.max(1, Number(dayHours) || DEFAULT_LEAVE_DAY_HOURS)
    return h / per
  }
  return 1
}

/**
 * 保存済みの日報1件が何日ぶんの有給かを返す。
 * ★leave_days が null の行は、この列を足す前の既存データ＝「1日」として扱う。
 *  ここを忘れると過去の消化が0日になり、残日数が実際より増えて見える。
 */
export function storedLeaveDays(row: { leave_type?: string | null; leave_days?: number | null }): number {
  if (row?.leave_type !== 'paid_leave') return 0
  const v = row?.leave_days
  return v == null ? 1 : Math.max(0, Number(v) || 0)
}

/**
 * その年に時間単位で取った日数が上限（5日）に収まるか。
 * ★超える申請は通さない（労基法39条4項に反するため）。
 * @returns 追加できるなら null、駄目なら理由
 */
export function hourlyLeaveCapError(
  alreadyHourlyDaysThisYear: number, addingDays: number,
): string | null {
  const after = alreadyHourlyDaysThisYear + addingDays
  if (after <= HOURLY_LEAVE_ANNUAL_CAP_DAYS + 1e-9) return null
  const rest = Math.max(0, HOURLY_LEAVE_ANNUAL_CAP_DAYS - alreadyHourlyDaysThisYear)
  return `時間単位の有給は年${HOURLY_LEAVE_ANNUAL_CAP_DAYS}日ぶんまでです（残り ${rest.toFixed(2)} 日ぶん）`
}
