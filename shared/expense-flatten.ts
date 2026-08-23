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
  account?: string      // 勘定科目（入力値）。others/entertainments のみ入力可・未入力/既存データは expenseAccountCategory で導出
  companions?: string   // 同行者名（接待交際費・会議費のみ必須。税務上「誰と行ったか」の記録）
  // ── 出所（申請前インライン編集の書き戻し用・追加のみ／金額・集計には無影響）──
  //  新形式配列カテゴリ(parkings/highways/trains/hotels/others/entertainments)のみ付与。
  //  レガシースカラー・車両按分・旧車両配下(駐車/高速)は付けない＝編集対象外。
  srcSiteIndex?: number  // sites[] のindex
  srcKey?: string        // expenses配下の配列キー（'parkings'|'highways'|'trains'|'hotels'|'others'|'entertainments'）
                         //  ＋ 'gasolineItems'（日報直下）／'personalExpenses'（日報に依存しない独立テーブル）
  srcIndex?: number      // その配列内のindex
  personalExpenseId?: string  // personal_expenses.id（現場に紐付かない個人経費のみ・編集/削除の戻り先）
  workerName?: string    // 個人経費の申請者名（日報由来の行は日報側で作業員が決まるので使わない）
}

/** 勘定科目の固定選択肢（2026-07-30 ユーザー確定・入力selectとバリデーションの正本） */
export const EXPENSE_ACCOUNT_OPTIONS = ['旅費交通費', '車両費', '消耗品費', '材料費', '接待交際費', '会議費', '雑費'] as const

/**
 * 同行者名の記録が必須になる科目。
 * 税務上「誰と行ったか」の記録が要るのは **接待交際費のみ**（2026-07-31 ユーザー確定）。
 * ※会議費は対象外。
 * 入力フォームの必須バリデーションと、admin 側の未記入検出の両方でこれを正とする。
 */
export const COMPANION_REQUIRED_ACCOUNTS = ['接待交際費'] as const

/** その明細に同行者名の記録が要るか（科目は入力値優先・未入力なら導出値で判定） */
export function requiresCompanions(row: { category: string; account?: string }): boolean {
  return (COMPANION_REQUIRED_ACCOUNTS as readonly string[]).includes(expenseAccountCategory(row))
}

/**
 * 領収書の添付が構造的に要らない経費。
 *
 * 領収書・レシートは 99% もらえるので添付を必須にする、というのが方針
 * （2026-08-14 ユーザー確定）。ただし ETC の高速代だけは、その場で領収書が出ず
 * 後日の利用明細でまとめて精算する別の話になるため、最初から対象外にする。
 * 「レジ故障でもらえなかった」のような例外は免除ではなく **理由を書けば通す**
 * （noReceiptReason）で扱う＝もらえるはずのものを黙って素通りさせない。
 */
export function receiptExempt(row: { category: string; etcCard?: string }): boolean {
  return row.category === '高速代' && !!String(row.etcCard ?? '').trim()
}

/**
 * 経費行の「科目」列（勘定科目）。入力値(account)があればそれ、無ければ生カテゴリから導出する。
 * 導出マッピングは 2026-07-30 ユーザー確定回答:
 *  電車/バス/タクシー/駐輪/駐車/高速/宿泊 → 旅費交通費、ガソリン/軽油 → 車両費、
 *  その他(資材等) → 消耗品費、その他雑経費 → 接待交際費。
 * ※「品名」列(expenseDisplayCategory)とは別物。品名=客先向け表示、科目=会計仕訳用。
 */
export function expenseAccountCategory(row: { category: string; account?: string }): string {
  if (row.account) return row.account
  switch (row.category) {
    case '電車代': case 'バス代': case 'タクシー代': case '駐輪代':
    case '駐車代': case '高速代': case '宿泊費':                     return '旅費交通費'
    case 'ガソリン代': case 'ガソリン代（本日）': case '軽油代':      return '車両費'
    case 'その他': case '材料費':                                    return '消耗品費'
    case 'その他雑経費':                                            return '接待交際費'
    default:                                                       return '雑費'
  }
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
  const allSites = (sites ?? [])
  for (let si = 0; si < allSites.length; si++) {
    const site = allSites[si]
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
    for (let i = 0; i < (exp.parkings || []).length; i++) {
      const pk = exp.parkings[i]
      if (pk.yen) rows.push({ date, category: '駐車代', siteName, amount: pk.yen, payee: pk.payee, registrationNumber: pk.registrationNumber, vehicle: siteVehicle, fileUrls: pk.fileUrls, tategae: !!pk.tategae, srcSiteIndex: si, srcKey: 'parkings', srcIndex: i })
    }
    for (let i = 0; i < (exp.highways || []).length; i++) {
      const hw = exp.highways[i]
      if (hw.yen) rows.push({ date, category: '高速代', siteName, amount: hw.yen, note: hw.etcCard || '', payee: hw.payee, registrationNumber: hw.registrationNumber, vehicle: siteVehicle, fileUrls: hw.fileUrls, tategae: !!hw.tategae, srcSiteIndex: si, srcKey: 'highways', srcIndex: i })
    }
    for (let i = 0; i < (exp.trains || []).length; i++) {
      const tr = exp.trains[i]
      // 新=明細ごと領収書(tr.fileUrls) / 旧=共通(trainUrls を先頭行に take-once)
      if (tr.yen) rows.push({ date, category: '電車代', siteName, amount: tr.yen, note: tr.label, payee: tr.payee, registrationNumber: tr.registrationNumber, fileUrls: tr.fileUrls?.length ? tr.fileUrls : takeTrainUrls(), tategae: !!tr.tategae, srcSiteIndex: si, srcKey: 'trains', srcIndex: i })
    }
    // 宿泊費（複数登録・新形式 hotels[]）。明細ごとに1行。
    for (let i = 0; i < (exp.hotels || []).length; i++) {
      const ho = exp.hotels[i]
      if (ho.yen) rows.push({ date, category: '宿泊費', siteName, amount: ho.yen, note: ho.label, payee: ho.payee, registrationNumber: ho.registrationNumber, fileUrls: ho.fileUrls?.length ? ho.fileUrls : undefined, tategae: !!ho.tategae, srcSiteIndex: si, srcKey: 'hotels', srcIndex: i })
    }
    // 旧スカラー（hotel*/leopalace*）は hotels[] に金額が無い時だけ読む＝二重計上を防ぐ後方互換。
    const hasHotelsArr = (exp.hotels || []).some((h: any) => h.yen)
    if (exp.hotelYen     && !hasHotelsArr) rows.push({ date, category: '宿泊費', siteName, amount: exp.hotelYen,     note: exp.hotelName,     payee: exp.hotelName,     registrationNumber: exp.hotelRegistration,     fileUrls: exp.hotelUrls?.length     ? exp.hotelUrls     : undefined, tategae: !!exp.hotelTategae })
    if (exp.leopalaceYen && !hasHotelsArr) rows.push({ date, category: '宿泊費', siteName, amount: exp.leopalaceYen, note: exp.leopalaceName, payee: exp.leopalaceName, registrationNumber: exp.leopalaceRegistration, fileUrls: exp.leopalaceUrls?.length ? exp.leopalaceUrls : undefined, tategae: !!exp.leopalaceTategae })
    for (let i = 0; i < (exp.others || []).length; i++) {
      const ot = exp.others[i]
      if (ot.yen) rows.push({ date, category: 'その他', siteName, amount: ot.yen, note: ot.label, payee: ot.payee, registrationNumber: ot.registrationNumber, account: ot.account || undefined, companions: ot.companions || undefined, fileUrls: ot.fileUrls?.length ? ot.fileUrls : takeOtherUrls(), tategae: !!ot.tategae, srcSiteIndex: si, srcKey: 'others', srcIndex: i })
    }
    for (let i = 0; i < (exp.entertainments || []).length; i++) {
      const ent = exp.entertainments[i]
      if (ent.yen) rows.push({ date, category: 'その他雑経費', siteName, amount: ent.yen, note: ent.label, payee: ent.payee, registrationNumber: ent.registrationNumber, account: ent.account || undefined, companions: ent.companions || undefined, fileUrls: ent.fileUrls?.length ? ent.fileUrls : undefined, tategae: !!ent.tategae, srcSiteIndex: si, srcKey: 'entertainments', srcIndex: i })
    }
    if (exp.entertainmentYen && !(exp.entertainments || []).some((e: any) => e.yen)) rows.push({ date, category: 'その他雑経費', siteName, amount: exp.entertainmentYen, note: exp.entertainmentLabel, payee: exp.entertainmentLabel, registrationNumber: exp.entertainmentRegistration, fileUrls: exp.entertainmentUrls?.length ? exp.entertainmentUrls : undefined, tategae: !!exp.entertainmentTategae })
  }
  return applyPayeeFallback(rows)
}

/**
 * 「本日のガソリン代」(daily_reports.gasoline_items) を経費行に平坦化する。
 *
 * ★なぜ共有関数にするか（2026-07-30）:
 *  gasoline_items は sites[] 配下ではなく日報直下なので flattenReportExpenses を通らず、
 *  admin経費管理 / admin日毎集計 / liff経費PDF の3箇所で手組みされていた。
 *  その結果、内容がバラバラになっていた:
 *   - admin経費管理: liters を入れておらず note も空 → **ℓ列と内訳が常に空**（実害・本関数で解消）
 *   - admin日毎集計: category が 'ガソリン代'（他2つは 'ガソリン代（本日）'）＝表記揺れ
 *  1箇所に寄せて同じ行を作る。
 *
 * ★category は 'ガソリン代（本日）' を正とする（表示は expenseDisplayCategory で
 *  距離按分ぶんと同じ「ガソリン代」に揃う）。日毎集計は flatten 側の
 *  'ガソリン代'/'軽油代'（距離按分＝内部原価配賦）を除外してから本関数の行を足すため、
 *  区別が付く名前のほうが安全。
 *
 * ★srcKey='gasolineItems' を付ける（日報直下なので srcSiteIndex は無し）。
 *  liff の経費PDF画面の申請前インライン編集（patchExpenseItem）が書き戻し先を辿るのに使う。
 *  admin 側は参照しないので付いていても無影響。
 */
export function flattenGasolineItems(date: string, gasolineItems: any[] | null | undefined): ExpenseRow[] {
  const rows: ExpenseRow[] = []
  const items = (gasolineItems ?? [])
  for (let gi = 0; gi < items.length; gi++) {
    const g = items[gi]
    const amount = Math.round(Number(g?.yen) || 0)
    if (amount <= 0) continue
    rows.push({
      date,
      category: 'ガソリン代（本日）',
      siteName: '—',                      // 日報レベルの実費＝現場に紐づかない
      amount,
      payee: g.payee || '',
      // 燃料種別が入っていれば内訳に出す。無ければ手入力ラベルを使う
      note: g.fuelType === 'diesel' ? 'ディーゼル' : (g.fuelType === 'regular' ? 'レギュラー' : (g.label || '')),
      registrationNumber: g.registrationNumber || '',
      liters: Number(g.liters) > 0 ? Number(g.liters) : undefined,
      fileUrls: Array.isArray(g.fileUrls) ? g.fileUrls : [],
      tategae: !!g.tategae,
      srcKey: 'gasolineItems',
      srcIndex: gi,
    })
  }
  return rows
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

// ── 現場に紐付かない個人経費（personal_expenses）─────────────────────
//  日報に依存しない独立テーブル。役員・経営者のように日報を出さない人や、
//  出勤しない日に発生した経費を拾うための入れ物（#f4cc3db1）。
//  日報由来の行と同じ ExpenseRow に合流させ、出所は srcKey='personalExpenses' で区別する。

/** personal_expenses の1行（DBのカラム名そのまま） */
export interface PersonalExpenseRecord {
  id: string
  worker_id: string
  date: string
  account_category: string
  amount: number | string
  payee?: string | null
  registration_number?: string | null
  companions?: string | null
  note?: string | null
  file_urls?: string[] | null
  tategae?: boolean | null
}

/**
 * personal_expenses を ExpenseRow に変換する。
 * ★siteName は空文字にする（'現場未設定' にはしない）。
 *  現場別集計で「不明な現場」として現場に紛れ込ませないため（#f4cc3db1 の波及範囲メモ）。
 * ★category は勘定科目をそのまま入れる。account にも同じ値を入れるので
 *  expenseAccountCategory / requiresCompanions がそのまま効く。
 */
export function flattenPersonalExpenses(
  records: PersonalExpenseRecord[] | null | undefined,
  workerNameById?: Record<string, string>,
): ExpenseRow[] {
  const rows: ExpenseRow[] = []
  for (const r of (records ?? [])) {
    const amount = Math.round(Number(r.amount) || 0)
    if (amount <= 0) continue
    rows.push({
      date: r.date,
      category: r.account_category,
      account: r.account_category,
      siteName: '',                                   // 現場に紐付かない＝空（集計側で現場外として扱う）
      amount,
      note: r.note || undefined,
      payee: r.payee || undefined,
      registrationNumber: r.registration_number || undefined,
      companions: r.companions || undefined,
      fileUrls: Array.isArray(r.file_urls) ? r.file_urls : [],
      tategae: !!r.tategae,
      srcKey: 'personalExpenses',
      personalExpenseId: r.id,
      workerName: workerNameById?.[r.worker_id],
    })
  }
  return rows
}

/** その行が現場に紐付かない個人経費か（現場按分・現場別集計から除外する判定に使う） */
export function isPersonalExpenseRow(row: { srcKey?: string }): boolean {
  return row.srcKey === 'personalExpenses'
}

// ── 「その他」と「その他雑経費」の入力統合 ────────────────────────────
//  日報フォームの2セクションは入力欄が完全に同じで、違いは導出される科目だけだった。
//  科目を入力項目にしたことで分ける理由が無くなったので入力は1つに畳む。
//  ★ただし保存先の配列は分けたまま（2026-07-31 ユーザー確定・案B）。
//   現場別集計は entertainments を「接待交際費」列、others を「ホーム」列に集計しており、
//   単純に others へ寄せると**過去と比べられなくなる**（金額が別の列へ移動する）。
//   入力は1本・保存は科目で振り分け、にすることで集計ロジックに一切触らない。

/** その明細が「接待交際費」扱いか（科目の入力値が無ければ生カテゴリから導出） */
function isEntertainmentAccount(item: { account?: string }, fallbackCategory: string): boolean {
  return expenseAccountCategory({ category: fallbackCategory, account: item.account }) === '接待交際費'
}

/**
 * 編集ロード時に entertainments を others に畳んで1本のリストにする。
 * ★科目を明示的に埋めるのが肝: 空のままだと others 側の導出（消耗品費）に化けて、
 *  再保存で entertainments から others へ移動＝現場別集計の列が黙って変わってしまう。
 */
export function mergeOtherExpenses<T extends { account?: string }>(
  others: T[] | null | undefined,
  entertainments: T[] | null | undefined,
): T[] {
  const merged: T[] = [...(others ?? [])].map((o) => ({
    ...o,
    account: o.account || expenseAccountCategory({ category: 'その他', account: o.account }),
  }))
  for (const e of (entertainments ?? [])) {
    merged.push({
      ...e,
      account: e.account || expenseAccountCategory({ category: 'その他雑経費', account: e.account }),
    })
  }
  return merged
}

/**
 * 保存時に1本のリストを others / entertainments へ振り分ける。
 * 科目=接待交際費 のものだけ entertainments に入れ、それ以外は others。
 * これで現場別集計の「接待交際費」列・「ホーム」列は今までと同じ値になる。
 */
export function splitOtherExpenses<T extends { account?: string }>(
  items: T[] | null | undefined,
): { others: T[]; entertainments: T[] } {
  const others: T[] = []
  const entertainments: T[] = []
  for (const it of (items ?? [])) {
    if (isEntertainmentAccount(it, 'その他')) entertainments.push(it)
    else others.push(it)
  }
  return { others, entertainments }
}

// ── 個人経費の月額上限（枠）─────────────────────────────────────
//  #32e93d75（2026-07-31 ユーザー確定回答）。admin の枠設定UI・liff の申請画面・
//  管理側の超過検知が全部ここを通る（判定ロジックを画面ごとに書かない）。

/** テナント既定の月額上限を置く settings のキー（gasoline_rate_per_km と同じ流儀） */
export const PERSONAL_EXPENSE_LIMIT_SETTING_KEY = 'personal_expense_monthly_limit'

/**
 * 経費を寄せる月キー 'YYYY-MM'。
 * ★申請の period_key（半月）ではなく経費の date 基準（2026-07-31 ユーザー確定 2-4）。
 *  月末の領収書を翌月前半に申請しても正しい月の枠を食う。
 */
export function expenseMonthKey(date: string | null | undefined): string {
  return (date ?? '').slice(0, 7)
}

/** 数値として意味のある枠値なら返す。null/undefined/空文字/非数値は「未設定」＝null */
function toLimit(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** settings 行配列からテナント既定の月額上限を解決（未設定なら null＝テナント既定なし） */
export function personalExpenseLimitFromSettings(
  rows: Array<{ key: string; value: any }> | null | undefined,
): number | null {
  const hit = (rows ?? []).find((s) => s.key === PERSONAL_EXPENSE_LIMIT_SETTING_KEY)
  return hit ? toLimit(hit.value) : null
}

export interface MonthlyLimitSources {
  monthOverride?: unknown  // worker_expense_budgets(worker_id, month).limit_amount ＝その月だけの上書き
  workerDefault?: unknown  // workers.default_monthly_expense_limit ＝指定が無い月に毎月効く既定
  tenantDefault?: unknown  // settings['personal_expense_monthly_limit'] ＝テナント既定
}

/**
 * その作業員のその月の枠を解決する。上から順に最初に見つかった値を採用し、
 * どれも未設定なら null＝**枠なし**（＝申請不可。0円の枠とは区別する）。
 */
export function resolveMonthlyLimit(sources: MonthlyLimitSources): number | null {
  return toLimit(sources.monthOverride)
    ?? toLimit(sources.workerDefault)
    ?? toLimit(sources.tenantDefault)
}

/**
 * 個人経費を申請できるか。
 * **権限フラグON かつ 枠が1円以上**（2026-07-31 ユーザー確定「金額が設定されている作業員のみ提出可能」）。
 * フラグ＝「そもそも許すか」、枠＝「いくらまで」の2層。どちらが欠けても入口を出さない。
 */
export function canSubmitPersonalExpense(
  worker: { can_apply_personal_expense?: boolean | null } | null | undefined,
  limit: number | null,
): boolean {
  return !!worker?.can_apply_personal_expense && limit !== null && limit > 0
}

/**
 * その月の消費額。
 * ★承認状態で絞らない＝**未承認・差し戻し中の金額も引当**（2026-07-31 ユーザー確定 2-2）。
 *  承認済みだけを消費とみなすと、前半未承認のうちに後半で満額使えてしまう。
 * ★母数は月合計（half-month の first/second をまたいで累計・同 2-1）。
 */
export function sumMonthlyPersonalExpenses(
  records: Array<{ date: string; amount: number | string; tategae?: boolean }> | null | undefined,
  month: string,
): number {
  let total = 0
  for (const r of (records ?? [])) {
    if (expenseMonthKey(r.date) !== month) continue
    // 会社支払い（個人立替ではない＝tategae===false）は「個人の使用額」に入れない（#32）。
    // 個人使用額＝個人が立て替えた分。tategae 未指定(null/undefined)は従来どおり計上（明示的な会社支払いのみ除外）。
    if (r.tategae === false) continue
    total += Math.round(Number(r.amount) || 0)
  }
  return total
}

export interface BudgetUsage {
  month: string
  limit: number | null   // null＝枠なし
  used: number
  remaining: number      // 枠なしなら 0
  isOver: boolean        // 超過しているか（★警告用。ブロックはしない）
  hasBudget: boolean
}

/**
 * 枠の消費状況。
 * ★超過は **警告のみでブロックしない**（2026-07-31 ユーザー確定 2-3）。
 *  目的は「なんで超えてんの？」を検知することで、立替の実費登録を止めることではない。
 */
export function computeBudgetUsage(
  records: Array<{ date: string; amount: number | string; tategae?: boolean }> | null | undefined,
  month: string,
  limit: number | null,
): BudgetUsage {
  const used = sumMonthlyPersonalExpenses(records, month)
  const hasBudget = limit !== null
  return {
    month,
    limit,
    used,
    remaining: hasBudget ? Math.max(0, (limit as number) - used) : 0,
    isOver: hasBudget && used > (limit as number),
    hasBudget,
  }
}
