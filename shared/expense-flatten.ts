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
  category: string      // 生カテゴリ（集計/フィルタ用の正典。表示は expenseDisplayCategory で変換）
  siteName: string
  amount: number
  liters?: number
  note?: string
  payee?: string        // 支払い先（店名/業者）
  registrationNumber?: string
  fileUrls?: string[]   // 領収書・写真URL（Supabase Storage）
  tategae?: boolean
  vehicle?: string      // 使用車（車両系経費のみ・現場の車両名。交通費/その他/宿泊は無し）
}

/**
 * 経費PDF/明細の「品名」列に出す表示ラベル（客先フォーマットに寄せる）。
 * ※ 生カテゴリ(row.category)は集計/フィルタの正典なので変えない。表示のみここで変換する。
 */
export function expenseDisplayCategory(category: string): string {
  switch (category) {
    case '電車代': case 'バス代': case 'タクシー代': case '駐輪代': return '交通費'
    case '駐車代':                                                  return 'P代'
    case 'ガソリン代': case 'ガソリン代（本日）': case '軽油代':      return 'ガソリン代'
    case 'その他雑経費':                                            return 'その他'
    default:                                                       return category  // 高速代/宿泊費/その他/材料費/名刺 はそのまま
  }
}

/**
 * 1日報の sites[].expenses を経費行に平坦化する。
 * 経費構造（明細追加・スカラー⇔配列・明細ごと領収書 等）を変える時は
 * docs/expense-data-consumers.md のチェックリストも確認すること。
 */
export function flattenReportExpenses(date: string, sites: any[], rates: ExpenseRates): ExpenseRow[] {
  const rows: ExpenseRow[] = []
  for (const site of (sites ?? [])) {
    const siteName = site.siteName === '__unset__' ? '現場未設定' : site.siteName === '__other__' ? (site.customSiteName || '') : (site.siteName || '')
    const exp = site.expenses || {}
    // 使用車: その現場の車両名（複数あれば先頭1台）。車両系経費(駐車/高速/ガソリン)に付ける。
    const siteVehicle: string | undefined = ((exp.vehicles || []).map((v: any) => v?.vehicleName).filter(Boolean))[0] || undefined

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
      // 車両の距離按分（ガソリン/軽油）は距離ベースの配賦＝個人建て替え(tategae)は付けない（実費は「本日のガソリン代」で別入力）
      if (veh.distanceKm) rows.push({ date, category: 'ガソリン代', siteName, amount: Math.round(veh.distanceKm * rates.gasoline), liters: veh.distanceKm, note: veh.vehicleName, vehicle: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: false })
      if (veh.dieselKm)   rows.push({ date, category: '軽油代',    siteName, amount: Math.round(veh.dieselKm   * rates.diesel),   liters: veh.dieselKm,   note: veh.vehicleName, vehicle: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: false })
      // 旧形式（後方互換）: 車両配下の単一 駐車場代/高速代
      if (veh.parkingYen) rows.push({ date, category: '駐車代',    siteName, amount: veh.parkingYen, vehicle: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: !!veh.parkingTategae })
      if (veh.highwayYen) rows.push({ date, category: '高速代',    siteName, amount: veh.highwayYen, note: veh.etcCard || '', vehicle: veh.vehicleName, fileUrls: takeVehicleUrls(), tategae: !!veh.highwayTategae })
    }
    // 新形式: 現場ごとの駐車場代・高速代（複数・明細ごとに個別領収書）
    for (const pk of (exp.parkings || [])) {
      if (pk.yen) rows.push({ date, category: '駐車代', siteName, amount: pk.yen, payee: pk.payee, registrationNumber: pk.registrationNumber, vehicle: siteVehicle, fileUrls: pk.fileUrls, tategae: !!pk.tategae })
    }
    for (const hw of (exp.highways || [])) {
      if (hw.yen) rows.push({ date, category: '高速代', siteName, amount: hw.yen, note: hw.etcCard || '', payee: hw.payee, registrationNumber: hw.registrationNumber, vehicle: siteVehicle, fileUrls: hw.fileUrls, tategae: !!hw.tategae })
    }
    for (const tr of (exp.trains || [])) {
      // 新=明細ごと領収書(tr.fileUrls) / 旧=共通(trainUrls を先頭行に take-once)
      if (tr.yen) rows.push({ date, category: '電車代', siteName, amount: tr.yen, note: tr.label, payee: tr.payee, registrationNumber: tr.registrationNumber, fileUrls: tr.fileUrls?.length ? tr.fileUrls : takeTrainUrls(), tategae: !!tr.tategae })
    }
    // 宿泊費（複数登録・新形式 hotels[]）。明細ごとに1行。
    for (const ho of (exp.hotels || [])) {
      if (ho.yen) rows.push({ date, category: '宿泊費', siteName, amount: ho.yen, note: ho.label, payee: ho.payee, registrationNumber: ho.registrationNumber, fileUrls: ho.fileUrls?.length ? ho.fileUrls : undefined, tategae: !!ho.tategae })
    }
    // 旧スカラー（hotel*/leopalace*）は hotels[] に金額が無い時だけ読む＝二重計上を防ぐ後方互換。
    const hasHotelsArr = (exp.hotels || []).some((h: any) => h.yen)
    if (exp.hotelYen     && !hasHotelsArr) rows.push({ date, category: '宿泊費', siteName, amount: exp.hotelYen,     note: exp.hotelName,     payee: exp.hotelName,     registrationNumber: exp.hotelRegistration,     fileUrls: exp.hotelUrls?.length     ? exp.hotelUrls     : undefined, tategae: !!exp.hotelTategae })
    if (exp.leopalaceYen && !hasHotelsArr) rows.push({ date, category: '宿泊費', siteName, amount: exp.leopalaceYen, note: exp.leopalaceName, payee: exp.leopalaceName, registrationNumber: exp.leopalaceRegistration, fileUrls: exp.leopalaceUrls?.length ? exp.leopalaceUrls : undefined, tategae: !!exp.leopalaceTategae })
    for (const ot of (exp.others || [])) {
      if (ot.yen) rows.push({ date, category: 'その他', siteName, amount: ot.yen, note: ot.label, payee: ot.payee, registrationNumber: ot.registrationNumber, fileUrls: ot.fileUrls?.length ? ot.fileUrls : takeOtherUrls(), tategae: !!ot.tategae })
    }
    for (const ent of (exp.entertainments || [])) {
      if (ent.yen) rows.push({ date, category: 'その他雑経費', siteName, amount: ent.yen, note: ent.label, payee: ent.payee, registrationNumber: ent.registrationNumber, fileUrls: ent.fileUrls?.length ? ent.fileUrls : undefined, tategae: !!ent.tategae })
    }
    if (exp.entertainmentYen && !(exp.entertainments || []).some((e: any) => e.yen)) rows.push({ date, category: 'その他雑経費', siteName, amount: exp.entertainmentYen, note: exp.entertainmentLabel, payee: exp.entertainmentLabel, registrationNumber: exp.entertainmentRegistration, fileUrls: exp.entertainmentUrls?.length ? exp.entertainmentUrls : undefined, tategae: !!exp.entertainmentTategae })
  }
  return applyPayeeFallback(rows)
}

// 支払い先(payee)は 2026-07-03 に追加された新カラム。それ以前 or 未入力の既存データは payee が空で、
// 会社名が 内容(note=label) 側にだけ入っている（PDF/adminの支払先列が空白＝ズレて見える）。
// 対策: payee が空で、内容が「発行元(会社/店名)」であるカテゴリ(その他/雑経費/宿泊/電車)に限り、
//        内容(note)を支払い先に昇格し内容を空にする（表示のみ・非破壊・可逆／金額・集計は不変）。
//  ※ 高速代(note=ETCカード名)・駐車代/ガソリン(note無し) は昇格しない＝誤って支払先に出さない。
//  ※ payee がある新しい正入力データは発火しない＝無影響。
const PAYEE_FALLBACK_CATEGORIES = new Set(['その他', 'その他雑経費', '宿泊費', '電車代'])
function applyPayeeFallback(rows: ExpenseRow[]): ExpenseRow[] {
  for (const r of rows) {
    if (!r.payee && r.note && PAYEE_FALLBACK_CATEGORIES.has(r.category)) {
      r.payee = r.note
      r.note = undefined
    }
  }
  return rows
}
