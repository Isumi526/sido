// ============================================================
//  リマインドEF トリガー認可（punch-reminder / daily-reminder / schedule-notify(remind) / faq-generate 共通）
//
//  通るのは次の2つだけ:
//   1) 共有シークレット（x-reminder-secret ヘッダ == REMINDER_TRIGGER_SECRET env）… cron。全社が対象
//   2) 承認者の JWT（APPROVER_ROLES）… 管理画面からの手動実行。対象は**その人の会社だけ**
//      （呼び出し側は scopeAccountId で会社を絞り、body の account_slug は無視する）
//  シークレット未設定でも通さない（fail-closed）。
//
//  ★2026-09-25 締めた（出所: 2026-09-24 残業リマインド実装中に発見）:
//   以前は「auth.getUser が通れば誰でも」通し、シークレット未設定なら全通しだった。
//   本番の auth.users は全員メールログイン＝ログインできる作業員なら誰でも、
//   account_slug を付けずに叩いて**全テナント分**のリマインドを発火できた。
//  ※ --no-verify-jwt デプロイのため、in-code でトリガー認可を行う（第三者のURL直叩きを防ぐ）。
// ============================================================
import { resolveApprover, APPROVER_ROLES } from './caller-identity.ts'

export type ReminderAuth =
  | { ok: false }
  /** scopeAccountId: null = cron（全社）／ string = 承認者の手動実行（その会社だけ） */
  | { ok: true; scopeAccountId: string | null }

/** 長さ・内容で早抜けしない比較（シークレットの推測を時間差で絞らせない） */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/**
 * @param svc service_role クライアント（承認者の身元を RLS を跨いで引き直すため）
 * @param opts.allowApprover false なら cron（共有シークレット）だけを通す
 */
export async function authorizeReminderTrigger(
  req: Request,
  svc: any,
  opts: { allowApprover?: boolean } = {},
): Promise<ReminderAuth> {
  const secret = Deno.env.get('REMINDER_TRIGGER_SECRET') ?? ''
  const provided = req.headers.get('x-reminder-secret') ?? ''
  if (secret && provided && safeEqual(provided, secret)) return { ok: true, scopeAccountId: null }

  if (opts.allowApprover === false) return { ok: false }
  const approver = await resolveApprover(svc, req.headers.get('Authorization') ?? '')
  if (!approver || !APPROVER_ROLES.includes(approver.role)) return { ok: false }
  return { ok: true, scopeAccountId: approver.accountId }
}
