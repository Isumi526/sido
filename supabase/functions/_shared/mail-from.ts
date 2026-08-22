// ============================================================
//  _shared/mail-from.ts
//  差出人（メール表示名）のフォールバック解決（#45・2026-08-22）。
//  各メールヘルパは settings.company_name を表示名に使うが、未設定のテナントでは
//  空になり "onboarding@resend.dev" だけの素っ気ない差出人になっていた。
//  company_name が空のときは accounts.name（社名）にフォールバックする。
//  ※呼び出し側は `(cn?.value || '').trim() || await resolveAccountName(svc, accountId)`
//    の形で使う＝company_name が設定済みなら追加クエリは走らない（短絡）。
// ============================================================

// accounts.name を返す（無ければ空文字）。svc は service-role クライアント。
export async function resolveAccountName(svc: any, accountId: string): Promise<string> {
  if (!accountId) return ''
  const { data: acc } = await svc.from('accounts').select('name').eq('id', accountId).maybeSingle()
  return (acc?.name || '').trim()
}
