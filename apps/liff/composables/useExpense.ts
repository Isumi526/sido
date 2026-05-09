// ============================================================
//  apps/liff / composables/useExpense.ts
//  経費申請データの CRUD 操作
// ============================================================
import type { User, ExpenseItem, ExpenseItemInput } from '~/types'

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

const USER_CACHE_PREFIX = 'sido_eu_'
const USER_CACHE_TTL    = 60 * 60 * 1000 // 1時間

function loadUserCache(lineUserId: string): User | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(USER_CACHE_PREFIX + lineUserId)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: User; ts: number }
    if (Date.now() - ts > USER_CACHE_TTL) { localStorage.removeItem(USER_CACHE_PREFIX + lineUserId); return null }
    return data
  } catch { return null }
}

function saveUserCache(user: User) {
  if (import.meta.server) return
  try {
    localStorage.setItem(USER_CACHE_PREFIX + user.line_user_id, JSON.stringify({ data: user, ts: Date.now() }))
  } catch { /* quota超過は無視 */ }
}

function clearUserCache(lineUserId: string) {
  if (import.meta.server) return
  try { localStorage.removeItem(USER_CACHE_PREFIX + lineUserId) } catch {}
}

// ---------- composable ----------

export const useExpense = () => {
  /**
   * LINE userId でユーザーを取得（未登録なら null）
   * localStorage キャッシュあり → Supabase は初回・期限切れ時のみ問い合わせ
   */
  async function getUser(lineUserId: string): Promise<User | null> {
    const cached = loadUserCache(lineUserId)
    if (cached) return cached

    const supabase = useSupabase()
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .maybeSingle()

    if (error) { console.error('[useExpense] getUser:', error); return null }
    if (data)  saveUserCache(data)
    return data
  }

  /** ユーザー登録（既存なら本名・ロールを更新して返す） */
  async function registerUser(lineUserId: string, realName: string, workerRole: 'factory' | 'site'): Promise<User> {
    const supabase = useSupabase()
    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          line_user_id: lineUserId,
          real_name:    realName,
          worker_role:  workerRole,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'line_user_id' }
      )
      .select()
      .single()

    if (error) throw error
    saveUserCache(data)  // 登録・更新時にキャッシュ更新
    return data
  }

  /** 経費明細を追加 */
  async function addItem(lineUserId: string, item: ExpenseItemInput): Promise<ExpenseItem> {
    const user = await getUser(lineUserId)
    if (!user) throw new Error('ユーザーが登録されていません')

    const supabase = useSupabase()
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

    const supabase = useSupabase()
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
    const supabase = useSupabase()
    const { error } = await supabase
      .from('expense_items')
      .delete()
      .eq('id', id)

    if (error) throw error
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

    const supabase = useSupabase()
    const { error } = await supabase
      .from('daily_reports')
      .upsert(
        {
          user_id:    user.id,
          date:       report.date,
          is_working: report.isWorking,
          sites:      report.sites,
          note:       report.note ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,date' }
      )

    if (error) {
      console.error('[saveReport] upsertエラー code=', error.code, 'message=', error.message)
      throw error
    }
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

    const supabase = useSupabase()
    const { data, error } = await supabase
      .from('daily_reports')
      .select('date, sites')
      .eq('user_id', user.id)
      .eq('is_working', true)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })

    if (error) { console.error('[useExpense] getExpenseRowsFromReports:', error); return [] }

    const rows: ExpenseRow[] = []
    for (const rep of (data ?? [])) {
      for (const site of (rep.sites as any[])) {
        const siteName = site.siteName === '__other__' ? (site.customSiteName || '') : (site.siteName || '')
        const exp      = site.expenses || {}

        for (const veh of (exp.vehicles || [])) {
          if (veh.distanceKm) rows.push({ date: rep.date, category: 'ガソリン代', siteName, amount: 0,              liters: veh.distanceKm, note: veh.vehicleName })
          if (veh.dieselKm)   rows.push({ date: rep.date, category: '軽油代',    siteName, amount: 0,              liters: veh.dieselKm,   note: veh.vehicleName })
          if (veh.parkingYen) rows.push({ date: rep.date, category: '駐車代',    siteName, amount: veh.parkingYen })
          if (veh.highwayYen) rows.push({ date: rep.date, category: '高速代',    siteName, amount: veh.highwayYen, note: veh.etcCard || '' })
        }
        for (const tr of (exp.trains || [])) {
          if (tr.yen) rows.push({ date: rep.date, category: '電車代', siteName, amount: tr.yen, note: tr.label })
        }
        if (exp.hotelYen)         rows.push({ date: rep.date, category: '宿泊費',     siteName, amount: exp.hotelYen,         note: exp.hotelName })
        if (exp.leopalaceYen)     rows.push({ date: rep.date, category: '宿泊費',     siteName, amount: exp.leopalaceYen,     note: exp.leopalaceName })
        for (const ot of (exp.others || [])) {
          if (ot.yen) rows.push({ date: rep.date, category: 'その他', siteName, amount: ot.yen, note: ot.label })
        }
        if (exp.entertainmentYen) rows.push({ date: rep.date, category: 'その他雑経費', siteName, amount: exp.entertainmentYen, note: exp.entertainmentLabel })
      }
    }
    return rows
  }

  return { getUser, registerUser, addItem, getItems, deleteItem, saveReport, getExpenseRowsFromReports, clearUserCache }
}
