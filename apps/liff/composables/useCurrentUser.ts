// ============================================================
//  composables/useCurrentUser.ts
//  「自分＝どの作業員/ユーザーか」をセッション種別に応じて解決する単一ソース。
//   - email/pw（Supabase認証）セッション → workers.auth_user_id（=JWT app_metadata.worker_id）
//     経由で worker を解決。users 行があれば使い、無ければ worker から合成して返す。
//     ★ line_user_id 検索は走らせない（email/pw は line_user_id を持たない＝0行→406→未登録誤判定の元）。
//   - LINE セッションのみ → 従来 line_user_id → users（無改変）。
//   - 同一人物が LINE履歴(users.line_user_id)と email/pw(workers.auth_user_id) 両方を持つ場合も
//     同じ worker_id に解決する（register へ誤誘導しない）。
// ============================================================
import type { User } from '~/types'

export const useCurrentUser = () => {
  const { authMode, workerId, profile } = useLiff()
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // email/pw セッションなら worker_id を返す（それ以外は null）
  function passwordWorkerId(): string | null {
    return authMode.value === 'password' ? (workerId.value ?? null) : null
  }

  async function resolve(): Promise<User | null> {
    const accountId = await getAccountId()
    if (!accountId) return null

    const wid = passwordWorkerId()
    if (wid) {
      // email/pw: worker_id で users を引く。
      const { data: u } = await supabase
        .from('users').select('*').eq('worker_id', wid).eq('account_id', accountId).maybeSingle()
      if (u) return u as User
      // users 行が無い email/pw 作業員 → users 行を作成（id付き＝日報/履歴が正しく保存される）。
      // 合成(id=null)だと daily_reports.user_id=null になり管理画面/履歴に出ないため必ず作る。
      const { data: w } = await supabase
        .from('workers').select('id, name, role, account_id').eq('id', wid).maybeSingle()
      if (!w) return null
      // upsert(onConflict=account_id,worker_id) で「同時解決による重複行」を構造的に防ぐ。
      // 一意 index users_account_worker_uniq（20260620000000）が衝突先。既存行があれば更新して返す。
      const { data: created } = await supabase
        .from('users')
        .upsert(
          { worker_id: w.id, account_id: w.account_id, real_name: w.name, worker_role: w.role, is_approved: true },
          { onConflict: 'account_id,worker_id' },
        )
        .select('*').single()
      if (created) return created as User
      // 万一の競合等で取得できなければ再取得（後方互換のフォールバック）
      const { data: again } = await supabase
        .from('users').select('*').eq('worker_id', wid).eq('account_id', accountId).maybeSingle()
      return (again as User) ?? null
    }

    // LINE: 従来どおり line_user_id → users
    const lineUserId = profile.value?.userId
    if (!lineUserId) return null
    const { data: u } = await supabase
      .from('users').select('*').eq('line_user_id', lineUserId).eq('account_id', accountId).maybeSingle()
    return (u as User) ?? null
  }

  return { resolve, passwordWorkerId }
}
