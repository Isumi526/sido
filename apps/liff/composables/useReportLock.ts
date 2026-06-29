// ============================================================
//  useReportLock — 日報・経費の「過去3日ロック」と編集許可申請
//  - ロック窓: 対象日付が「当日含む過去3日」より前（=3日以上前）ならロック対象。
//    （当日／前日／前々日は編集可。4日前以降はロック＝管理者の許可が要る）
//    ※境界はルールブック「当日含む直近3日」に合わせる。LOCK_AFTER_DAYS で一元管理。
//  - ロックは UX/運用ガード（クライアント判定）。daily_reports 自体が anon-writable な
//    現アーキテクチャ上、セキュリティ境界ではない（本番RLS化は別エピック）。
//  - 救済: 作業員が許可を依頼 → 管理者が admin で承認 → その worker×date のみ解除。
//    キーは worker_id（ログイン方式跨ぎで安定）。
// ============================================================
export const LOCK_AFTER_DAYS = 3

function diffDaysFromToday(date: string): number {
  const d = new Date(date + 'T00:00:00').getTime()
  const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00').getTime()
  return Math.floor((today - d) / 86400000)
}

export function useReportLock() {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // 対象日付がロック窓（3日以上前）か。承認の有無は見ない＝表示用の素の判定。
  function isPastLockWindow(date: string | null | undefined): boolean {
    if (!date) return false
    return diffDaysFromToday(date) >= LOCK_AFTER_DAYS
  }

  // 作業員×日付の許可ステータス（none/pending/approved/rejected）。
  async function grantStatus(workerId: string | null | undefined, date: string): Promise<'none' | 'pending' | 'approved' | 'rejected'> {
    if (!workerId || !date) return 'none'
    const accountId = await getAccountId()
    if (!accountId) return 'none'
    const { data } = await supabase
      .from('report_edit_grants')
      .select('status, requested_at')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date)
      .order('requested_at', { ascending: false })
      .limit(1)
    return ((data && data[0]?.status) as any) ?? 'none'
  }

  // 実効ロック判定（提出/編集の直前ガード用）: ロック窓内 かつ 承認されていない。
  async function isLocked(workerId: string | null | undefined, date: string): Promise<boolean> {
    if (!isPastLockWindow(date)) return false
    return (await grantStatus(workerId, date)) !== 'approved'
  }

  // 履歴一覧の同期表示用: その作業員の「承認済み」日付集合を一括取得。
  async function approvedDates(workerId: string | null | undefined): Promise<Set<string>> {
    const set = new Set<string>()
    if (!workerId) return set
    const accountId = await getAccountId()
    if (!accountId) return set
    const { data } = await supabase
      .from('report_edit_grants')
      .select('date')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('status', 'approved')
    for (const r of data ?? []) if ((r as any).date) set.add((r as any).date)
    return set
  }

  // 履歴一覧の同期表示用: date → 最新ステータス のマップ（承認/申請中の表示に使う）。
  async function grantsByDate(workerId: string | null | undefined): Promise<Record<string, 'pending' | 'approved' | 'rejected'>> {
    const map: Record<string, 'pending' | 'approved' | 'rejected'> = {}
    if (!workerId) return map
    const accountId = await getAccountId()
    if (!accountId) return map
    const { data } = await supabase
      .from('report_edit_grants')
      .select('date, status, requested_at')
      .eq('account_id', accountId).eq('worker_id', workerId)
      .order('requested_at', { ascending: true })
    // requested_at 昇順で上書き＝同一dateは最新が残る。
    for (const r of data ?? []) {
      const d = (r as any).date, s = (r as any).status
      if (d && s) map[d] = s
    }
    return map
  }

  // 許可を依頼（pending を作成）。既に pending/approved があれば二重作成しない。
  async function requestGrant(workerId: string | null | undefined, date: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    if (!workerId || !date) return { ok: false, error: 'no-worker-or-date' }
    const accountId = await getAccountId()
    if (!accountId) return { ok: false, error: 'no-account' }
    const { data: existing } = await supabase
      .from('report_edit_grants').select('id, status')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date)
      .in('status', ['pending', 'approved']).limit(1)
    if (existing && existing.length) return { ok: true }
    const { error } = await supabase.from('report_edit_grants').insert({
      account_id: accountId, worker_id: workerId, date, reason: reason || null, status: 'pending',
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  // 誤った申請の取り消し（pending を撤回）。pending のみ削除＝承認済みは消さない。
  async function cancelRequest(workerId: string | null | undefined, date: string): Promise<{ ok: boolean; error?: string }> {
    if (!workerId || !date) return { ok: false, error: 'no-worker-or-date' }
    const accountId = await getAccountId()
    if (!accountId) return { ok: false, error: 'no-account' }
    const { error } = await supabase.from('report_edit_grants').delete()
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date).eq('status', 'pending')
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  return { isPastLockWindow, grantStatus, isLocked, approvedDates, grantsByDate, requestGrant, cancelRequest }
}
