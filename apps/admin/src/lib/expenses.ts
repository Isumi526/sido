// ============================================================
//  lib/expenses.ts
//  経費の平坦化ロジックへの入口（re-export シム）＋ 月次精算ステータス。
//
//  ★平坦化そのものは admin/liff 共有の単一ソース shared/expense-flatten.ts にある。
//   ロジックを変える時は shared/ を編集し `npm run sync:shared` で
//   expense-flatten.gen.ts（admin/liff 両方）を再生成すること。
//   .gen.ts を直接編集しない。
// ============================================================

// 経費平坦化・単価・ExpenseRow は単一ソース shared/expense-flatten.ts（→ expense-flatten.gen.ts）から再エクスポート。
// ロジック変更は shared/expense-flatten.ts を編集し `npm run sync:shared` で再生成すること。
export { type ExpenseRow, type ExpenseRates, type PersonalExpenseRecord, DEFAULT_RATES, ratesFromSettings, flattenReportExpenses, flattenGasolineItems, flattenPersonalExpenses, isPersonalExpenseRow, expenseDisplayCategory, expenseAccountCategory, requiresCompanions, EXPENSE_ACCOUNT_OPTIONS } from './expense-flatten.gen'

// ---------- 月次精算（申請/差し戻し）ステータス ----------
// 正典: docs/spec/expense.md §2,§3

export type SettlementStatus = '未申請' | '申請中' | '差し戻し' | '支払い済み' | '期限超過'

/** 期(period_key)の締切(JST)を返す。first=当月18日10:00 / second=翌月3日10:00 */
export function deadlineForPeriod(periodKey: string): Date {
  const [y, m, half] = periodKey.split('-')
  const year = Number(y), month = Number(m) // month: 1-12
  if (half === 'first') {
    return new Date(`${y}-${String(month).padStart(2, '0')}-18T10:00:00+09:00`)
  }
  // second: 翌月3日（12月は翌年1月）
  const nm = month === 12 ? 1 : month + 1
  const ny = month === 12 ? year + 1 : year
  return new Date(`${ny}-${String(nm).padStart(2, '0')}-03T10:00:00+09:00`)
}

/** 実効ステータス。行が無ければ締切判定で 未申請/期限超過 を導出 */
export function effectiveStatus(
  row: { status?: string | null } | null | undefined,
  periodKey: string,
  now: Date = new Date(),
): SettlementStatus {
  if (row?.status) return row.status as SettlementStatus
  return now.getTime() <= deadlineForPeriod(periodKey).getTime() ? '未申請' : '期限超過'
}

// ExpenseRow / flattenReportExpenses は冒頭の re-export（./expense-flatten.gen）を参照。
