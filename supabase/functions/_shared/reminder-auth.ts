// ============================================================
//  リマインドEF トリガー認可（daily-reminder / shaken-reminder 共通）
//  - cron 実行: 共有シークレット（x-reminder-secret ヘッダ == REMINDER_TRIGGER_SECRET env）
//  - admin 手動実行: 認証済みユーザーJWT（Authorization: Bearer <user jwt>）
//  - REMINDER_TRIGGER_SECRET 未設定時は後方互換で通す（cron未更新でも止めない・段階移行）
//  ※ --no-verify-jwt デプロイのため、in-code でトリガー認可を行う（第三者のURL直叩きを防ぐ）。
// ============================================================
type AuthClient = { auth: { getUser: (t: string) => Promise<{ data: { user: unknown } | null; error: unknown }> } }

export async function authorizeReminderTrigger(req: Request, supabase: AuthClient): Promise<boolean> {
  const secret = Deno.env.get('REMINDER_TRIGGER_SECRET') ?? ''

  // 1) 共有シークレット（cron が Vault 経由で渡す）
  const provided = req.headers.get('x-reminder-secret') ?? ''
  if (secret && provided && provided === secret) return true

  // 2) 認証済みユーザー（admin 手動実行は Authorization: Bearer <user jwt> を送る）
  const authz = req.headers.get('Authorization') ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token)
      if (!error && data?.user) return true
    } catch { /* 検証失敗は不許可へ */ }
  }

  // 3) シークレット未設定（移行期）→ 後方互換で通す。設定後は cron/admin 以外を 401。
  if (!secret) return true
  return false
}
