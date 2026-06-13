// ============================================================
//  lib/expenses.ts
//  daily_reports.sites[].expenses (JSONB) を経費行に平坦化する純関数。
//  LIFF 側 composables/useExpense.ts の getExpenseRowsFromReports と
//  同一ロジック（同じ単価キー・カテゴリ・tategae 判定）。
//  ※ composable は admin から直接 import できないため移植。
//    将来は packages/ への共通化を検討（残課題）。
// ============================================================

/** 燃料単価（settings から上書き。未設定時のデフォルトは useExpense と一致） */
export interface ExpenseRates {
  gasoline: number // gasoline_rate_per_km, default 23
  diesel: number   // diesel_rate_per_km,   default 20
}

export const DEFAULT_RATES: ExpenseRates = { gasoline: 23, diesel: 20 }

/** settings 行配列（key/value）から単価を解決 */
export function ratesFromSettings(rows: Array<{ key: string; value: any }> | null | undefined): ExpenseRates {
  const map = Object.fromEntries((rows ?? []).map((s) => [s.key, Number(s.value)]))
  return {
    gasoline: map['gasoline_rate_per_km'] ?? DEFAULT_RATES.gasoline,
    diesel:   map['diesel_rate_per_km']   ?? DEFAULT_RATES.diesel,
  }
}

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

/** 月次集計用の経費行 */
export interface ExpenseRow {
  date: string
  category: string
  siteName: string
  amount: number
  liters?: number
  note?: string
  registrationNumber?: string
  fileUrls?: string[]   // 領収書・写真URL（Supabase Storage）
  tategae?: boolean
}

/**
 * 1日報の sites[].expenses を経費行に平坦化する。
 * （useExpense.getExpenseRowsFromReportsById の内側ループと同一。fileUrls も同じく
 *  共有URL配列をカテゴリ先頭行にだけ添付する take-once 方式）
 */
export function flattenReportExpenses(date: string, sites: any[], rates: ExpenseRates): ExpenseRow[] {
  const rows: ExpenseRow[] = []
  for (const site of (sites ?? [])) {
    const siteName = site.siteName === '__other__' ? (site.customSiteName || '') : (site.siteName || '')
    const exp = site.expenses || {}

    // 共有URL配列は最初の行にだけ添付する
    let vehicleUrlsAttached = false
    const takeVehicleUrls = (): string[] | undefined => {
      if (!vehicleUrlsAttached && exp.vehicleUrls?.length) { vehicleUrlsAttached = true; return exp.vehicleUrls }
    }
    let trainUrlsAttached = false
    const takeTrainUrls = (): string[] | undefined => {
      if (!trainUrlsAttached && exp.trainUrls?.length) { trainUrlsAttached = true; return exp.trainUrls }
    }
    let otherUrlsAttached = false
    const takeOtherUrls = (): string[] | undefined => {
      if (!otherUrlsAttached && exp.otherUrls?.length) { otherUrlsAttached = true; return exp.otherUrls }
    }

    for (const veh of (exp.vehicles || [])) {
      if (veh.distanceKm) rows.push({ date, category: 'ガソリン代', siteName, amount: Math.round(veh.distanceKm * rates.gasoline), liters: veh.distanceKm, note: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: !!veh.gasTategae })
      if (veh.dieselKm)   rows.push({ date, category: '軽油代',    siteName, amount: Math.round(veh.dieselKm   * rates.diesel),   liters: veh.dieselKm,   note: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: !!veh.dieselTategae })
      // 旧形式（後方互換）: 車両配下の単一 駐車場代/高速代
      if (veh.parkingYen) rows.push({ date, category: '駐車代',    siteName, amount: veh.parkingYen, fileUrls: takeVehicleUrls(), tategae: !!veh.parkingTategae })
      if (veh.highwayYen) rows.push({ date, category: '高速代',    siteName, amount: veh.highwayYen, note: veh.etcCard || '', fileUrls: takeVehicleUrls(), tategae: !!veh.highwayTategae })
    }
    // 新形式: 現場ごとの駐車場代・高速代（複数・明細ごとに個別領収書）
    for (const pk of (exp.parkings || [])) {
      if (pk.yen) rows.push({ date, category: '駐車代', siteName, amount: pk.yen, fileUrls: pk.fileUrls, tategae: !!pk.tategae })
    }
    for (const hw of (exp.highways || [])) {
      if (hw.yen) rows.push({ date, category: '高速代', siteName, amount: hw.yen, note: hw.etcCard || '', fileUrls: hw.fileUrls, tategae: !!hw.tategae })
    }
    for (const tr of (exp.trains || [])) {
      // 新=明細ごと領収書(tr.fileUrls) / 旧=共通(trainUrls を先頭行に take-once)
      if (tr.yen) rows.push({ date, category: '電車代', siteName, amount: tr.yen, note: tr.label, fileUrls: tr.fileUrls?.length ? tr.fileUrls : takeTrainUrls(), tategae: !!tr.tategae })
    }
    if (exp.hotelYen)     rows.push({ date, category: '宿泊費', siteName, amount: exp.hotelYen,     note: exp.hotelName,     registrationNumber: exp.hotelRegistration,     fileUrls: exp.hotelUrls?.length     ? exp.hotelUrls     : undefined, tategae: !!exp.hotelTategae })
    if (exp.leopalaceYen) rows.push({ date, category: '宿泊費', siteName, amount: exp.leopalaceYen, note: exp.leopalaceName, registrationNumber: exp.leopalaceRegistration, fileUrls: exp.leopalaceUrls?.length ? exp.leopalaceUrls : undefined, tategae: !!exp.leopalaceTategae })
    for (const ot of (exp.others || [])) {
      if (ot.yen) rows.push({ date, category: 'その他', siteName, amount: ot.yen, note: ot.label, registrationNumber: ot.registrationNumber, fileUrls: ot.fileUrls?.length ? ot.fileUrls : takeOtherUrls(), tategae: !!ot.tategae })
    }
    for (const ent of (exp.entertainments || [])) {
      if (ent.yen) rows.push({ date, category: 'その他雑経費', siteName, amount: ent.yen, note: ent.label, registrationNumber: ent.registrationNumber, fileUrls: ent.fileUrls?.length ? ent.fileUrls : undefined, tategae: !!ent.tategae })
    }
    if (exp.entertainmentYen && !(exp.entertainments || []).some((e: any) => e.yen)) rows.push({ date, category: 'その他雑経費', siteName, amount: exp.entertainmentYen, note: exp.entertainmentLabel, registrationNumber: exp.entertainmentRegistration, fileUrls: exp.entertainmentUrls?.length ? exp.entertainmentUrls : undefined, tategae: !!exp.entertainmentTategae })
  }
  return rows
}
