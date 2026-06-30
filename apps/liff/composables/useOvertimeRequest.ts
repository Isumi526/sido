// ============================================================
//  useOvertimeRequest — 残業申請（架空残業対策）
//  - 当日15:00までに「固定終了を超える終了時刻」で残業を申請。管理者が admin で承認。
//    承認された worker×date のみ 日報の終了時刻を固定終了超で入力できる（report.vue が参照）。
//  - キーは worker_id（report_edit_grants/useReportLock と同様・ログイン方式跨ぎで安定）。
//  - 締切は当日15:00固定（全現場一律・曜日/祝日例外なし）。
//  - 金額/集計には触れない（保存済み時刻から workerHours が従来どおり料率算出）。
// ============================================================
export const OVERTIME_DEADLINE_HOUR = 15  // 当日この時刻まで申請可（15:00）

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

export function useOvertimeRequest() {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // 申請可能か: 対象日付が「今日」かつ 現在時刻が 15:00 より前。
  function canRequest(date: string | null | undefined): boolean {
    if (!date) return false
    if (date !== todayStr()) return false
    return new Date().getHours() < OVERTIME_DEADLINE_HOUR
  }

  // worker×date の残業申請ステータス（none/pending/approved/rejected・最新1件）。
  async function status(workerId: string | null | undefined, date: string): Promise<'none' | 'pending' | 'approved' | 'rejected'> {
    if (!workerId || !date) return 'none'
    const accountId = await getAccountId()
    if (!accountId) return 'none'
    const { data } = await supabase
      .from('overtime_requests')
      .select('status, requested_at')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date)
      .order('requested_at', { ascending: false })
      .limit(1)
    return ((data && data[0]?.status) as any) ?? 'none'
  }

  // 残業が承認済みか（report.vue の終了時刻上限解放に使う）。
  async function isApproved(workerId: string | null | undefined, date: string): Promise<boolean> {
    return (await status(workerId, date)) === 'approved'
  }

  // その作業員の「承認済み」残業日付の集合（履歴表示用）。
  async function approvedDates(workerId: string | null | undefined): Promise<Set<string>> {
    const set = new Set<string>()
    if (!workerId) return set
    const accountId = await getAccountId()
    if (!accountId) return set
    const { data } = await supabase
      .from('overtime_requests')
      .select('date')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('status', 'approved')
    for (const r of data ?? []) if ((r as any).date) set.add((r as any).date)
    return set
  }

  // 直近の自分の申請一覧（履歴表示用・新しい順）。
  async function myRecent(workerId: string | null | undefined, limit = 20): Promise<any[]> {
    if (!workerId) return []
    const accountId = await getAccountId()
    if (!accountId) return []
    const { data } = await supabase
      .from('overtime_requests')
      .select('id, date, requested_end_time, reason, status, requested_at')
      .eq('account_id', accountId).eq('worker_id', workerId)
      .order('requested_at', { ascending: false })
      .limit(limit)
    return (data ?? []) as any[]
  }

  // 残業を申請（pending を作成）。当日15:00まで・既に pending/approved があれば二重作成しない。
  async function requestOvertime(
    workerId: string | null | undefined, date: string, requestedEndTime: string | null, reason: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!workerId || !date) return { ok: false, error: 'no-worker-or-date' }
    if (!canRequest(date)) return { ok: false, error: 'deadline-passed' }  // 当日15:00超 or 当日以外
    const accountId = await getAccountId()
    if (!accountId) return { ok: false, error: 'no-account' }
    const { data: existing } = await supabase
      .from('overtime_requests').select('id, status')
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date)
      .in('status', ['pending', 'approved']).limit(1)
    if (existing && existing.length) return { ok: true }
    const { error } = await supabase.from('overtime_requests').insert({
      account_id: accountId, worker_id: workerId, date,
      requested_end_time: requestedEndTime || null, reason: reason || null, status: 'pending',
    })
    // 競合で同時insertされた場合、部分一意index(active_uidx)が弾く＝既に有効申請あり＝成功扱い。
    if (error) {
      if ((error as any).code === '23505') return { ok: true }
      return { ok: false, error: error.message }
    }
    return { ok: true }
  }

  // 誤った申請の取り消し（pending のみ削除＝承認済みは消さない）。
  async function cancelRequest(workerId: string | null | undefined, date: string): Promise<{ ok: boolean; error?: string }> {
    if (!workerId || !date) return { ok: false, error: 'no-worker-or-date' }
    const accountId = await getAccountId()
    if (!accountId) return { ok: false, error: 'no-account' }
    const { error } = await supabase.from('overtime_requests').delete()
      .eq('account_id', accountId).eq('worker_id', workerId).eq('date', date).eq('status', 'pending')
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  return { canRequest, status, isApproved, approvedDates, myRecent, requestOvertime, cancelRequest }
}
