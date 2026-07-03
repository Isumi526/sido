// ============================================================
//  composables/useExpense.ts
//  経費申請データの CRUD 操作
// ============================================================
import type { User, ExpenseItem, ExpenseItemInput, ExpenseRow } from '~/types'
import { useI18n } from 'vue-i18n'
import { gt } from '~/utils/i18n-global'
import { flattenReportExpenses, ratesFromSettings } from './expense-flatten.gen'

// ---------- 期間キーユーティリティ ----------

/** 日付文字列(YYYY-MM-DD)から期間キーを計算 */
export function getPeriodKey(date: string): string {
  const day = parseInt(date.split('-')[2], 10)
  const yearMonth = date.substring(0, 7)
  return `${yearMonth}-${day <= 15 ? 'first' : 'second'}`
}

/** timestamptz(UTC) → JST基準の 'YYYY-MM-DD'（ユーザー登録日を暦日に変換） */
export function jstDateOf(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 現在の期間キーを返す */
export function getCurrentPeriodKey(): string {
  const today = new Date()
  const day   = today.getDate()
  const ym    = today.toISOString().substring(0, 7)
  return `${ym}-${day <= 15 ? 'first' : 'second'}`
}

/** 期間キーを表示用ラベルに変換 (例: '2026-05-first' → '2026年5月 前半') */
export function periodLabel(key: string): string {
  const [year, month, half] = key.split('-')
  const halfLabel = half === 'first' ? gt('expense.periodFirstHalf') : gt('expense.periodSecondHalf')
  return gt('expense.periodLabel', { year, month: parseInt(month, 10), half: halfLabel })
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

/**
 * 締切アラートの表示期間内か（ホームバナー用）。
 * first（前半）: 15日 〜 18日10:00 / second（後半）: 翌月1日 〜 翌月3日10:00（JST）
 */
export function isInDeadlineAlertWindow(periodKey: string, now: Date = new Date()): boolean {
  const [y, m, half] = periodKey.split('-')
  const year = Number(y), month = Number(m)
  let start: Date
  if (half === 'first') {
    start = new Date(`${y}-${String(month).padStart(2, '0')}-15T00:00:00+09:00`)
  } else {
    const nm = month === 12 ? 1 : month + 1
    const ny = month === 12 ? year + 1 : year
    start = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00+09:00`)
  }
  const t = now.getTime()
  return t >= start.getTime() && t <= deadlineForPeriod(periodKey).getTime()
}

/** 締切を表示用に整形（例: '6月3日(火) 10:00'） */
export function deadlineLabel(periodKey: string): string {
  const d = deadlineForPeriod(periodKey)
  const wdKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  const wd = gt(`expense.weekday.${wdKeys[d.getDay()]}`)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return gt('expense.deadlineLabel', { month: d.getMonth() + 1, day: d.getDate(), weekday: wd, time })
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

/**
 * 直近3か月分の期間キーを新しい順で返す（各月 後半→前半）。
 * 例: 2026-06-second, 2026-06-first, 2026-05-second, 2026-05-first, ...
 */
export function recentPeriodKeys(): string[] {
  const keys: string[] = []
  const today = new Date()
  for (let i = 0; i < 3; i++) {
    const d  = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    keys.push(`${ym}-second`, `${ym}-first`)   // 後半→前半（新しい順）
  }
  return keys
}

// ---------- ユーザーキャッシュ（localStorage） ----------
// LIFF init 後に毎回 Supabase を叩くのを避けるため1時間キャッシュする

const USER_CACHE_TTL = 60 * 60 * 1000 // 1時間

function getCacheKey(lineUserId: string): string {
  // account slug をキーに含めてアカウント間のキャッシュ混在を防ぐ
  const slug = typeof useRuntimeConfig !== 'undefined'
    ? ((useRuntimeConfig().public as any).accountSlug as string) || 'sample-construction'
    : 'sample-construction'
  return `app_eu_${slug}_${lineUserId}`
}

function loadUserCache(lineUserId: string): User | null {
  if (import.meta.server) return null
  try {
    const key = getCacheKey(lineUserId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: User; ts: number }
    if (Date.now() - ts > USER_CACHE_TTL) { localStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function saveUserCache(user: User) {
  if (import.meta.server) return
  try {
    localStorage.setItem(getCacheKey(user.line_user_id), JSON.stringify({ data: user, ts: Date.now() }))
  } catch { /* quota超過は無視 */ }
}

function clearUserCache(lineUserId: string) {
  if (import.meta.server) return
  try { localStorage.removeItem(getCacheKey(lineUserId)) } catch {}
}

// ---------- composable ----------

export const useExpense = () => {
  // コンポーザブル初期化時（同期フェーズ）に一度だけ取得してクロージャで共有
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { t } = useI18n()

  /**
   * LINE userId でユーザーを取得（未登録なら null）
   * localStorage キャッシュあり → Supabase は初回・期限切れ時のみ問い合わせ
   */
  async function getUser(lineUserId: string): Promise<User | null> {
    // email/pw（Supabase認証）セッションは line_user_id を持たない → 単一ソース useCurrentUser で解決。
    // （users 行が無ければ作成して id 付きで返す＝日報/履歴が正しく保存される。line_user_id 検索はしない）
    const { authMode, workerId } = useLiff()
    if (authMode.value === 'password' && workerId.value) {
      return await useCurrentUser().resolve()
    }

    const cached = loadUserCache(lineUserId)

    const accountId = await getAccountId()

    // キャッシュがある場合：Supabaseで存在確認してから返す（削除済み・account_id不一致を検出）
    if (cached) {
      const { data: check } = await supabase
        .from('users')
        .select('id, updated_at')
        .eq('line_user_id', lineUserId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!check) {
        // DBに存在しない（削除済みorアカウント不一致）→ キャッシュ破棄して未登録扱い
        clearUserCache(lineUserId)
        return null
      }
      if (check.updated_at === cached.updated_at) return cached
      // updated_at が変わっていたらキャッシュ破棄して DB から再取得
      clearUserCache(lineUserId)
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) { console.error('[useExpense] getUser:', error); return null }
    if (data)  saveUserCache(data)
    return data
  }

  /**
   * ユーザー登録
   * - workerId が渡された場合 → 既存作業員に紐づけ
   * - null の場合 → workerName/workerRole で workers に新規作成してから紐づけ
   */
  async function registerUser(
    lineUserId: string,
    workerIdOrNull: string | null,
    workerName: string,
    workerRole: 'factory' | 'site',
  ): Promise<User> {

    let workerId = workerIdOrNull

    const accountId = await getAccountId()

    // 新規作業員の場合は workers テーブルに作成
    if (!workerId) {
      const { data: newWorker, error: workerError } = await supabase
        .from('workers')
        .upsert(
          { name: workerName, role: workerRole, unit_price: 0, active: true, account_id: accountId },
          { onConflict: 'name,account_id' }
        )
        .select('id')
        .single()
      if (workerError) throw workerError
      workerId = newWorker.id
      // マスタキャッシュをクリアして次回取得時に新作業員が反映されるようにする
      if (import.meta.client) localStorage.removeItem('app_master_cache')
    }

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          line_user_id: lineUserId,
          worker_id:    workerId,
          real_name:    workerName,   // 後方互換のため残す
          worker_role:  workerRole,   // 後方互換のため残す
          account_id:   accountId,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'line_user_id' }
      )
      .select()
      .single()

    if (error) throw error
    saveUserCache(data)
    return data
  }

  /** 経費明細を追加 */
  async function addItem(lineUserId: string, item: ExpenseItemInput): Promise<ExpenseItem> {
    const user = await getUser(lineUserId)
    if (!user) throw new Error(t('expense.userNotRegistered'))

    const { data, error } = await supabase
      .from('expense_items')
      .insert({ ...item, user_id: user.id })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /** 期間を指定して経費明細を取得 */
  async function getItems(lineUserId: string, periodKey: string): Promise<ExpenseItem[]> {
    const user = await getUser(lineUserId)
    if (!user) return []

    const { data, error } = await supabase
      .from('expense_items')
      .select('*')
      .eq('user_id', user.id)
      .eq('period_key', periodKey)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) { console.error('[useExpense] getItems:', error); return [] }
    return data ?? []
  }

  /** 経費明細を削除 */
  async function deleteItem(id: string): Promise<void> {
    const { error } = await supabase
      .from('expense_items')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  /**
   * 代理入力対象（LINE未登録）の usersレコードを取得または作成して user_id を返す
   */
  async function findOrCreateProxyUser(
    workerId: string,
    workerName: string,
    workerRole: 'factory' | 'site'
  ): Promise<string> {
    const accountId = await getAccountId()
    if (!accountId) throw new Error(t('expense.accountIdFailed'))

    // worker_id で既存ユーザーを検索
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('account_id', accountId)
      .eq('worker_id', workerId)
      .maybeSingle()

    if (existing) return existing.id

    // 存在しなければ作成（line_user_id は null）
    const { data: created, error } = await supabase
      .from('users')
      .insert({
        account_id:  accountId,
        worker_id:   workerId,
        real_name:   workerName,
        worker_role: workerRole,
        line_user_id: null,
      })
      .select('id')
      .single()

    if (error) throw new Error(t('expense.proxyUserCreateFailed', { message: error.message }))
    return created.id
  }

  /**
   * 日報データをSupabaseに保存（user_id直接指定版）
   */
  // 保存前に File[] を除去（JSONB に File をそのまま入れると [{}] のゴミになるため）。
  //  *Files トップレベルキーと、明細ごとに files を持つ parkings/highways の files を落とす。*Urls は残す。
  function sanitizeSitesForStorage(sites: any[]): any[] {
    const FILE_KEYS = ['vehicleFiles','trainFiles','hotelFiles','leopalaceFiles','otherFiles','entertainmentFiles','garbagePhotos']
    return (sites ?? []).map((site: any) => {
      const exp = { ...(site?.expenses ?? {}) }
      for (const k of FILE_KEYS) delete exp[k]
      const stripItemFiles = (items: any[] | undefined) =>
        Array.isArray(items) ? items.map(({ files, ...rest }: any) => rest) : items
      if (exp.parkings) exp.parkings = stripItemFiles(exp.parkings)
      if (exp.highways) exp.highways = stripItemFiles(exp.highways)
      if (exp.trains)   exp.trains   = stripItemFiles(exp.trains)
      if (exp.others)   exp.others   = stripItemFiles(exp.others)
      if (exp.entertainments) exp.entertainments = stripItemFiles(exp.entertainments)
      if (exp.hotels)         exp.hotels         = stripItemFiles(exp.hotels)
      return { ...site, expenses: exp }
    })
  }

  // 日報の現場名を現場マスタ(sites)へ確実に登録する。
  //  「その他/新規現場」は __other__ なので customSiteName を採用。trim・空・__other__ は除外。
  //  既存現場は onConflict + ignoreDuplicates で no-op（active/name_kana/sort_order を壊さない）。
  //  日報保存と同じ経路で必ず await されるため、ブラウザ側 saveSite の取りこぼしを補う保険。
  //  失敗しても日報保存は妨げない（best-effort・ログのみ）。
  async function registerNewSites(accountId: string | null, sites: any[]): Promise<void> {
    if (!accountId || !Array.isArray(sites) || sites.length === 0) return
    const names = new Set<string>()
    for (const s of sites) {
      if (s?.siteName === '__unset__') continue   // 現場未設定はマスタ登録しない（あとで紐付け）
      const raw  = s?.siteName === '__other__' ? s?.customSiteName : s?.siteName
      const name = (raw ?? '').trim()
      if (name && name !== '__other__') names.add(name)
    }
    if (names.size === 0) return
    const rows = [...names].map(name => ({ name, account_id: accountId }))
    const { error } = await supabase
      .from('sites')
      .upsert(rows, { onConflict: 'name,account_id', ignoreDuplicates: true })
    if (error) console.error('[saveReportById] 現場マスタ登録に失敗:', error.message)
  }

  async function saveReportById(
    userId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; isBusinessTrip?: boolean; gasolineItems?: any[] }
  ): Promise<void> {
    const accountId = await getAccountId()
    // 本日のガソリン代（明細リスト）：金額のある明細だけを保存（_id は除去）
    const gasItems = (report.gasolineItems ?? [])
      .filter((it: any) => Number(it?.yen) > 0)
      .map((it: any) => ({
        yen: Math.round(Number(it.yen) || 0),
        payee: it.payee?.trim() || null,
        registrationNumber: it.registrationNumber?.trim() || null,
        tategae: !!it.tategae,
        fileUrls: Array.isArray(it.fileUrls) ? it.fileUrls : [],
      }))
    const { error } = await supabase
      .from('daily_reports')
      .upsert(
        {
          user_id:    userId,
          date:       report.date,
          is_working: report.isWorking,
          sites:      sanitizeSitesForStorage(report.sites as any[]),
          note:       report.note ?? null,
          leave_type: report.leaveType ?? null,
          is_business_trip: report.isBusinessTrip ?? false,
          // 日報レベルの「本日のガソリン代」（実費・複数給油対応）。現場に紐づかないため report 直下に持つ。
          gasoline_items: gasItems,
          account_id: accountId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,date' }
      )
    if (error) {
      console.error('[saveReportById] upsertエラー:', error.message)
      throw error
    }
    // 日報が保存できたら、その現場名を現場マスタへ登録（新規現場がプルダウンに確実に出るように）
    await registerNewSites(accountId, report.sites as any[])
  }

  /**
   * 日報データをSupabaseに保存（管理画面・履歴用）
   * 同じ user_id + date がある場合は上書き（upsert）
   */
  async function saveReport(
    lineUserId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; isBusinessTrip?: boolean; gasolineItems?: any[] }
  ): Promise<void> {
    console.log('[saveReport] 開始 lineUserId=', lineUserId)

    const user = await getUser(lineUserId)
    console.log('[saveReport] getUser結果=', user ? `id:${user.id} name:${user.real_name}` : 'null')
    if (!user) throw new Error(t('expense.userNotRegistered'))

    await saveReportById(user.id, report)
    console.log('[saveReport] 保存成功 date=', report.date)
  }

  /**
   * 期間内の日報データから経費行を集計（月次PDF用）
   * daily_reports.sites (JSONB) を展開してカテゴリ別に平坦化する
   */
  async function getExpenseRowsFromReports(lineUserId: string, periodKey: string): Promise<ExpenseRow[]> {
    const user = await getUser(lineUserId)
    if (!user) return []
    return getExpenseRowsFromReportsById(user.id, periodKey)
  }

  async function getExpenseRowsFromReportsById(userId: string, periodKey: string): Promise<ExpenseRow[]> {
    const [year, month, half] = periodKey.split('-')
    const dateFrom = half === 'first' ? `${year}-${month}-01` : `${year}-${month}-16`
    const lastDay  = new Date(parseInt(year), parseInt(month), 0).getDate()
    const dateTo   = half === 'first' ? `${year}-${month}-15` : `${year}-${month}-${String(lastDay).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, sites, gasoline_items')
      .eq('user_id', userId)
      .eq('is_working', true)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })

    if (error) { console.error('[useExpense] getExpenseRowsFromReports:', error); return [] }

    // 燃料単価をsettingsから解決（単一ソース ratesFromSettings）
    const { getAccountId: getAid } = useAccount()
    const aid = await getAid()
    const { data: settingsData } = await supabase.from('settings').select('key, value').eq('account_id', aid)
    const rates = ratesFromSettings(settingsData as any)

    // 平坦化は単一ソース flattenReportExpenses（admin と共有・shared/expense-flatten.ts）
    const rows: ExpenseRow[] = []
    for (const rep of (data ?? [])) {
      // 経費PDF＝作業員への精算書。車両の距離按分「ガソリン代/軽油代」(distanceKm×単価)は
      //  実費でなく現場別集計(内部原価)への配賦なので**精算書には載せない**。実費は下の「本日のガソリン代」で載る。
      rows.push(...flattenReportExpenses(rep.date, rep.sites as any[], rates)
        .filter(r => r.category !== 'ガソリン代' && r.category !== '軽油代'))
      // 日報レベルの「本日のガソリン代」（複数給油・実費）も明細に含める（admin 経費精算と整合）
      for (const g of ((rep as any).gasoline_items ?? [])) {
        const gasYen = Math.round(Number(g?.yen) || 0)
        if (gasYen <= 0) continue
        const urls = Array.isArray(g.fileUrls) ? g.fileUrls : []
        rows.push({ date: rep.date, category: 'ガソリン代（本日）', siteName: '—', payee: g.payee || '', amount: gasYen, note: '', registrationNumber: g.registrationNumber || '', fileUrls: urls, tategae: !!g.tategae } as ExpenseRow)
      }
    }
    return rows
  }

  /**
   * サービス開始日から今日までで、最初の未送信日を返す。
   * 全日送信済みなら null を返す。
   * service_start_date が未設定なら null を返す。
   */
  async function getNextUnsubmittedDate(lineUserId: string): Promise<string | null> {
    const accountId = await getAccountId()

    // service_start_date を settings から取得（複数行対応で limit(1) を使用）
    const { data: settingRows } = await supabase
      .from('settings')
      .select('value')
      .eq('account_id', accountId)
      .eq('key', 'service_start_date')
      .limit(1)

    const startDate = settingRows?.[0]?.value
    console.log('[getNextUnsubmittedDate] accountId=', accountId, 'startDate=', startDate)
    if (!startDate) return 'NOT_CONFIGURED'  // startDate未設定は通常動作に戻す

    const user = await getUser(lineUserId)
    console.log('[getNextUnsubmittedDate] user=', user?.id)
    if (!user) return null

    // 起点 = max(service_start_date, 作業員登録日, 日報提出開始日)。これより前の日付は未送信扱いしない。
    // 作業員マスタ登録日(workers.created_at)で統一。worker_id 経由で取得し、無ければ users.created_at にフォールバック。
    // report_start_date（日報提出開始日・任意）が設定されていれば、それ以降のみ未送信対象にする。
    let regSrc: string | null | undefined = (user as any).created_at
    let reportStartDate: string | null = null
    if ((user as any).worker_id) {
      const { data: w } = await supabase.from('workers').select('created_at, report_start_date').eq('id', (user as any).worker_id).maybeSingle()
      if ((w as any)?.created_at) regSrc = (w as any).created_at
      reportStartDate = (w as any)?.report_start_date ?? null
    }
    const regDate = jstDateOf(regSrc)
    let effStart = startDate
    if (regDate && regDate > effStart) effStart = regDate
    if (reportStartDate && reportStartDate > effStart) effStart = reportStartDate

    // 今日の日付をローカルタイムゾーンで取得（toISOString はUTCになるため使わない）
    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    // 起点〜今日の送信済み日付を一括取得
    const { data: reports, error: reportsError } = await supabase
      .from('daily_reports')
      .select('date')
      .eq('user_id', user.id)
      .gte('date', effStart)
      .lte('date', today)

    console.log('[getNextUnsubmittedDate] today=', today, 'effStart=', effStart, 'submittedCount=', reports?.length, 'error=', reportsError?.message)

    const submittedDates = new Set((reports ?? []).map((r: any) => r.date as string))

    // 起点から順に走査（純粋な文字列加算でタイムゾーン問題を回避）
    let cursor = effStart
    while (cursor <= today) {
      if (!submittedDates.has(cursor)) {
        console.log('[getNextUnsubmittedDate] next=', cursor)
        return cursor
      }
      // 日付を1日進める
      const d = new Date(cursor + 'T12:00:00') // 正午指定でタイムゾーンのズレを防ぐ
      d.setDate(d.getDate() + 1)
      cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    console.log('[getNextUnsubmittedDate] all submitted')
    return null  // null = 全送信済み
  }

  /**
   * DBユーザーIDで直接未送信日を検索（代理入力用）
   * getNextUnsubmittedDate の userID版
   */
  async function getNextUnsubmittedDateById(userId: string): Promise<string | null> {
    const accountId = await getAccountId()

    const { data: settingRows } = await supabase
      .from('settings')
      .select('value')
      .eq('account_id', accountId)
      .eq('key', 'service_start_date')
      .limit(1)

    const startDate = settingRows?.[0]?.value
    if (!startDate) return 'NOT_CONFIGURED'

    // 起点 = max(service_start_date, 作業員登録日, 日報提出開始日)。これより前の日付は未送信扱いしない。
    // 作業員マスタ登録日(workers.created_at)で統一。無ければ users.created_at にフォールバック。
    // report_start_date（日報提出開始日・任意）が設定されていれば、それ以降のみ未送信対象にする。
    const { data: urow } = await supabase
      .from('users')
      .select('created_at, worker_id')
      .eq('id', userId)
      .maybeSingle()
    let regSrc: string | null | undefined = (urow as any)?.created_at
    let reportStartDate: string | null = null
    if ((urow as any)?.worker_id) {
      const { data: w } = await supabase.from('workers').select('created_at, report_start_date').eq('id', (urow as any).worker_id).maybeSingle()
      if ((w as any)?.created_at) regSrc = (w as any).created_at
      reportStartDate = (w as any)?.report_start_date ?? null
    }
    const regDate = jstDateOf(regSrc)
    let effStart = startDate
    if (regDate && regDate > effStart) effStart = regDate
    if (reportStartDate && reportStartDate > effStart) effStart = reportStartDate

    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const { data: reports } = await supabase
      .from('daily_reports')
      .select('date')
      .eq('user_id', userId)
      .gte('date', effStart)
      .lte('date', today)

    const submittedDates = new Set((reports ?? []).map((r: any) => r.date as string))

    let cursor = effStart
    while (cursor <= today) {
      if (!submittedDates.has(cursor)) return cursor
      const d = new Date(cursor + 'T12:00:00')
      d.setDate(d.getDate() + 1)
      cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    return null  // null = 全送信済み
  }

  /** 日報一覧を取得（新しい順） */
  async function getReports(lineUserId: string, limit = 60): Promise<any[]> {
    const user = await getUser(lineUserId)
    if (!user) return []
    return getReportsById(user.id, limit)
  }

  /** 日報一覧をDBユーザーIDで取得（代理入力用） */
  async function getReportsById(userId: string, limit = 60): Promise<any[]> {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, is_working, leave_type, is_business_trip, sites, note, updated_at')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit)
    if (error) { console.error('[useExpense] getReportsById:', error); return [] }
    return data ?? []
  }

  /** 特定日の日報を1件取得 */
  async function getReport(lineUserId: string, date: string): Promise<any | null> {
    const user = await getUser(lineUserId)
    if (!user) return null
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, is_working, leave_type, is_business_trip, sites, note, gasoline_items')
      .eq('user_id', user.id)
      .eq('date', date)
      .maybeSingle()
    if (error) { console.error('[useExpense] getReport:', error); return null }
    return data
  }

  /** 特定日の日報をDBユーザーIDで取得（代理入力用） */
  async function getReportByUserId(userId: string, date: string): Promise<any | null> {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, is_working, leave_type, is_business_trip, sites, note, gasoline_items')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()
    if (error) { console.error('[useExpense] getReportByUserId:', error); return null }
    return data
  }

  // ---------- 月次精算（申請/差し戻し） ----------

  /** 指定 user の精算行を period で取得（無ければ null） */
  async function getSettlement(userId: string, periodKey: string): Promise<any | null> {
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .maybeSingle()
    if (error) { console.error('[useExpense] getSettlement:', error); return null }
    return data
  }

  /** 複数 period 分の精算をまとめて取得（ホーム/一覧用） */
  async function getSettlements(userId: string, periodKeys: string[]): Promise<any[]> {
    if (!periodKeys.length) return []
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .in('period_key', periodKeys)
    if (error) { console.error('[useExpense] getSettlements:', error); return [] }
    return data ?? []
  }

  /**
   * 経費申請: status を 申請中 にし、PDFパスを記録する。
   * 再申請（差し戻し後）でも notified_at を null クリアして1回だけ再送できるようにする。
   */
  async function applySettlement(userId: string, periodKey: string, pdfPath: string | null): Promise<any> {
    const accountId = await getAccountId()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('expense_settlements')
      .upsert(
        {
          account_id: accountId, user_id: userId, period_key: periodKey,
          status: '申請中', applied_at: now, pdf_path: pdfPath,
          reject_reason: null, rejected_at: null, notified_at: null, updated_at: now,
        },
        { onConflict: 'account_id,user_id,period_key' }
      )
      .select()
      .single()
    if (error) throw error
    return data
  }

  return { getUser, registerUser, addItem, getItems, deleteItem, saveReport, saveReportById, findOrCreateProxyUser, getExpenseRowsFromReports, getExpenseRowsFromReportsById, getReports, getReportsById, getReport, getReportByUserId, getNextUnsubmittedDate, getNextUnsubmittedDateById, clearUserCache, getSettlement, getSettlements, applySettlement }
}
