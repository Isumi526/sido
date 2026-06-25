// ============================================================
//  操作ログ 共通基盤: 主要操作を operation_logs に記録する。
//  各機能から logOperation(action, {...}) を呼ぶだけ。失敗しても本体処理は止めない。
// ============================================================
import { supabase } from './supabase'
import { getAccountId } from './account'

export async function logOperation(
  action: string,
  opts?: { targetType?: string; targetId?: string | null; summary?: string },
): Promise<void> {
  try {
    const accountId = await getAccountId()
    const { data } = await supabase.auth.getUser()
    await supabase.from('operation_logs').insert({
      account_id:  accountId,
      actor:       data?.user?.email ?? null,
      action,
      target_type: opts?.targetType ?? null,
      target_id:   opts?.targetId ?? null,
      summary:     opts?.summary ?? null,
    })
  } catch (e) {
    console.error('[logOperation]', e) // ログ記録の失敗は無視（本体を止めない）
  }
}
