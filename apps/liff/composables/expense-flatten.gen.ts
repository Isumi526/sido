// ⚠️ AUTO-GENERATED from shared/expense-flatten.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/expense-flatten.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/expense-flatten.ts  ★単一ソース（admin / liff 共有）
//  daily_reports.sites[].expenses (JSONB) を経費行に平坦化する純関数。
//  ここだけを編集し、`npm run sync:shared` で各アプリの
//  expense-flatten.gen.ts を再生成すること（手動コピーは禁止＝直し漏れ防止）。
//  ※ import を持たない自己完結ファイル（各アプリへそのままコピーされるため）。
// ============================================================

/** 燃料単価（settings から上書き。未設定時のデフォルト） */
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
 * 経費構造（明細追加・スカラー⇔配列・明細ごと領収書 等）を変える時は
 * docs/expense-data-consumers.md のチェックリストも確認すること。
 */
export function flattenReportExpenses(date: string, sites: any[], rates: ExpenseRates): ExpenseRow[] {
  const rows: ExpenseRow[] = []
  for (const site of (sites ?? [])) {
    const siteName = site.siteName === '__other__' ? (site.customSiteName || '') : (site.siteName || '')
    const exp = site.expenses || {}

    // 共有URL配列は最初の行にだけ添付する（take-once）
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
