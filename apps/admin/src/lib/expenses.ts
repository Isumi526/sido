// ============================================================
//  lib/expenses.ts
//  daily_reports.sites[].expenses (JSONB) を経費行に平坦化する純関数。
//  LIFF 側 composables/useExpense.ts の getExpenseRowsFromReports と
//  同一ロジック（同じ単価キー・カテゴリ・tategae 判定）。
//  ※ composable は admin から直接 import できないため移植。
//    将来は packages/ への共通化を検討（残課題）。
// ============================================================

// 経費平坦化・単価・ExpenseRow は単一ソース shared/expense-flatten.ts（→ expense-flatten.gen.ts）から再エクスポート。
// ロジック変更は shared/expense-flatten.ts を編集し `npm run sync:shared` で再生成すること。
export { type ExpenseRow, type ExpenseRates, DEFAULT_RATES, ratesFromSettings, flattenReportExpenses, expenseDisplayCategory } from './expense-flatten.gen'

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
