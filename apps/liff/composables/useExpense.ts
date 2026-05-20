// ============================================================
//  composables/useExpense.ts
//  経費申請データの CRUD 操作
// ============================================================
import type { User, ExpenseItem, ExpenseItemInput, ExpenseRow } from '~/types'

// ---------- 期間キーユーティリティ ----------

/** 日付文字列(YYYY-MM-DD)から期間キーを計算 */
export function getPeriodKey(date: string): string {
  const day = parseInt(date.split('-')[2], 10)
  const yearMonth = date.substring(0, 7)
  return `${yearMonth}-${day <= 15 ? 'first' : 'second'}`
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
  const halfLabel = half === 'first' ? `前半（1〜15日）` : `後半（16日〜末日）`
  return `${year}年${parseInt(month, 10)}月 ${halfLabel}`
}

/** 過去6期分の期間キーを新しい順で返す */
export function recentPeriodKeys(): string[] {
  const keys: string[] = []
  const today = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(today)
    d.setDate(1)
    // 前の月を取得するために月を操作
    const halfOffset = Math.floor(i / 2)
    const isFirst    = i % 2 === (today.getDate() <= 15 ? 0 : 1)
    d.setMonth(today.getMonth() - halfOffset)
    const ym   = d.toISOString().substring(0, 7)
    const half = isFirst ? 'first' : 'second'
    keys.push(`${ym}-${half}`)
  }
  // 重複を除去して返す
  return [...new Set(keys)]
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

  /**
   * LINE userId でユーザーを取得（未登録なら null）
   * localStorage キャッシュあり → Supabase は初回・期限切れ時のみ問い合わせ
   */
  async function getUser(lineUserId: string): Promise<User | null> {
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
    if (!user) throw new Error('ユーザーが登録されていません')

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
    if (!accountId) throw new Error('accountId取得失敗')

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

    if (error) throw new Error('代理ユーザー作成失敗: ' + error.message)
    return created.id
  }

  /**
   * 日報データをSupabaseに保存（user_id直接指定版）
   */
  async function saveReportById(
    userId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string }
  ): Promise<void> {
    const accountId = await getAccountId()
    const { error } = await supabase
      .from('daily_reports')
      .upsert(
        {
          user_id:    userId,
          date:       report.date,
          is_working: report.isWorking,
          sites:      report.sites,
          note:       report.note ?? null,
          account_id: accountId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,date' }
      )
    if (error) {
      console.error('[saveReportById] upsertエラー:', error.message)
      throw error
    }
  }

  /**
   * 日報データをSupabaseに保存（管理画面・履歴用）
   * 同じ user_id + date がある場合は上書き（upsert）
   */
  async function saveReport(
    lineUserId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string }
  ): Promise<void> {
    console.log('[saveReport] 開始 lineUserId=', lineUserId)

    const user = await getUser(lineUserId)
    console.log('[saveReport] getUser結果=', user ? `id:${user.id} name:${user.real_name}` : 'null')
    if (!user) throw new Error('ユーザーが登録されていません')

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

    const [year, month, half] = periodKey.split('-')
    const dateFrom = half === 'first' ? `${year}-${month}-01` : `${year}-${month}-16`
    const lastDay  = new Date(parseInt(year), parseInt(month), 0).getDate()
    const dateTo   = half === 'first' ? `${year}-${month}-15` : `${year}-${month}-${String(lastDay).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, sites')
      .eq('user_id', user.id)
      .eq('is_working', true)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })

    if (error) { console.error('[useExpense] getExpenseRowsFromReports:', error); return [] }

    // 燃料単価をsettingsテーブルから取得（なければデフォルト値）
    const { getAccountId: getAid } = useAccount()
    const aid = await getAid()
    const { data: settingsData } = await supabase.from('settings').select('key, value').eq('account_id', aid)
    const settingsMap  = Object.fromEntries((settingsData ?? []).map((s: any) => [s.key, Number(s.value)]))
    const gasolineRate = settingsMap['gasoline_rate_per_km'] ?? 23
    const dieselRate   = settingsMap['diesel_rate_per_km']   ?? 20

    const rows: ExpenseRow[] = []
    for (const rep of (data ?? [])) {
      for (const site of (rep.sites as any[])) {
        const siteName = site.siteName === '__other__' ? (site.customSiteName || '') : (site.siteName || '')
        const exp      = site.expenses || {}

        // ファイルURLを最初の行だけに添付するためのヘルパー
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
          if (veh.distanceKm) rows.push({ date: rep.date, category: 'ガソリン代', siteName, amount: Math.round(veh.distanceKm * gasolineRate), liters: veh.distanceKm, note: veh.vehicleName, fileUrls: takeVehicleUrls() })
          if (veh.dieselKm)   rows.push({ date: rep.date, category: '軽油代',    siteName, amount: Math.round(veh.dieselKm   * dieselRate),   liters: veh.dieselKm,   note: veh.vehicleName, fileUrls: takeVehicleUrls() })
          if (veh.parkingYen) rows.push({ date: rep.date, category: '駐車代',    siteName, amount: veh.parkingYen, fileUrls: takeVehicleUrls() })
          if (veh.highwayYen) rows.push({ date: rep.date, category: '高速代',    siteName, amount: veh.highwayYen, note: veh.etcCard || '', fileUrls: takeVehicleUrls() })
        }
        for (const tr of (exp.trains || [])) {
          if (tr.yen) rows.push({ date: rep.date, category: '電車代', siteName, amount: tr.yen, note: tr.label, fileUrls: takeTrainUrls() })
        }
        if (exp.hotelYen)     rows.push({ date: rep.date, category: '宿泊費', siteName, amount: exp.hotelYen,     note: exp.hotelName,     registrationNumber: exp.hotelRegistration,     fileUrls: exp.hotelUrls?.length     ? exp.hotelUrls     : undefined })
        if (exp.leopalaceYen) rows.push({ date: rep.date, category: '宿泊費', siteName, amount: exp.leopalaceYen, note: exp.leopalaceName, registrationNumber: exp.leopalaceRegistration, fileUrls: exp.leopalaceUrls?.length ? exp.leopalaceUrls : undefined })
        for (const ot of (exp.others || [])) {
          if (ot.yen) rows.push({ date: rep.date, category: 'その他', siteName, amount: ot.yen, note: ot.label, registrationNumber: ot.registrationNumber, fileUrls: takeOtherUrls() })
        }
        if (exp.entertainmentYen) rows.push({ date: rep.date, category: 'その他雑経費', siteName, amount: exp.entertainmentYen, note: exp.entertainmentLabel, registrationNumber: exp.entertainmentRegistration, fileUrls: exp.entertainmentUrls?.length ? exp.entertainmentUrls : undefined })
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

    // 今日の日付をローカルタイムゾーンで取得（toISOString はUTCになるため使わない）
    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    // 開始日〜今日の送信済み日付を一括取得
    const { data: reports, error: reportsError } = await supabase
      .from('daily_reports')
      .select('date')
      .eq('user_id', user.id)
      .gte('date', startDate)
      .lte('date', today)

    console.log('[getNextUnsubmittedDate] today=', today, 'submittedCount=', reports?.length, 'error=', reportsError?.message)

    const submittedDates = new Set((reports ?? []).map((r: any) => r.date as string))

    // 開始日から順に走査（純粋な文字列加算でタイムゾーン問題を回避）
    let cursor = startDate
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

  /** 日報一覧を取得（新しい順） */
  async function getReports(lineUserId: string, limit = 60): Promise<any[]> {
    const user = await getUser(lineUserId)
    if (!user) return []
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, is_working, sites, note, updated_at')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(limit)
    if (error) { console.error('[useExpense] getReports:', error); return [] }
    return data ?? []
  }

  /** 特定日の日報を1件取得 */
  async function getReport(lineUserId: string, date: string): Promise<any | null> {
    const user = await getUser(lineUserId)
    if (!user) return null
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, is_working, sites, note')
      .eq('user_id', user.id)
      .eq('date', date)
      .maybeSingle()
    if (error) { console.error('[useExpense] getReport:', error); return null }
    return data
  }

  return { getUser, registerUser, addItem, getItems, deleteItem, saveReport, saveReportById, findOrCreateProxyUser, getExpenseRowsFromReports, getReports, getReport, getNextUnsubmittedDate, clearUserCache }
}
