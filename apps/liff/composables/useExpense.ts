// ============================================================
//  apps/liff / composables/useExpense.ts
//  経費申請データの CRUD 操作
// ============================================================
import type { ExpenseUser, ExpenseItem, ExpenseItemInput } from '~/types'

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

function loadUserCache(lineUserId: string): ExpenseUser | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(USER_CACHE_PREFIX + lineUserId)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: ExpenseUser; ts: number }
    if (Date.now() - ts > USER_CACHE_TTL) { localStorage.removeItem(USER_CACHE_PREFIX + lineUserId); return null }
    return data
  } catch { return null }
}

function saveUserCache(user: ExpenseUser) {
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
  const supabase = useSupabase()

  /**
   * LINE userId でユーザーを取得（未登録なら null）
   * localStorage キャッシュあり → Supabase は初回・期限切れ時のみ問い合わせ
   */
  async function getUser(lineUserId: string): Promise<ExpenseUser | null> {
    const cached = loadUserCache(lineUserId)
    if (cached) return cached

    const { data, error } = await supabase
      .from('expense_users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .maybeSingle()

    if (error) { console.error('[useExpense] getUser:', error); return null }
    if (data)  saveUserCache(data)
    return data
  }

  /** ユーザー登録（既存なら本名・ロールを更新して返す） */
  async function registerUser(lineUserId: string, realName: string, workerRole: 'factory' | 'site'): Promise<ExpenseUser> {
    const { data, error } = await supabase
      .from('expense_users')
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
   * 日報データをSupabaseに保存（管理画面・履歴用）
   * 同じ user_id + date がある場合は上書き（upsert）
   */
  async function saveReport(
    lineUserId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string }
  ): Promise<void> {
    const user = await getUser(lineUserId)
    if (!user) throw new Error('ユーザーが登録されていません')

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

    if (error) throw error
  }

  return { getUser, registerUser, addItem, getItems, deleteItem, saveReport }
}
