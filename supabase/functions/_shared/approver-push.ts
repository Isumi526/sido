// ============================================================
//  _shared/approver-push.ts
//  承認者（管理者・役員/経理・現場責任者）の端末へ「承認待ち」を Web Push で届ける（A-3・2026-09-24）。
//
//  ★2026-09-27（A-1）: 送る仕組みは _shared/worker-push.ts に一般化した（購読＝worker_push_subscriptions・全員）。
//   ここは「承認者を宛先にして、種類＝承認のお願い（approval）で送る」薄い入口。承認のお願いをオフにした人には届かない。
//  ★送る時点で「まだ承認者か」を引き直す。購読後に権限が外れた人・退職した人には送らない。
// ============================================================
import { pushToWorkers, approverWorkerIds, type PushResult } from './worker-push.ts'

export type ApproverPush = {
  title: string
  body: string
  /** 通知タップで開くURL（作業員アプリと同じドメインの絶対URL） */
  url: string
  /** 同じ種類の通知をまとめる（連投で積み上がらない） */
  tag: string
  /** この作業員の端末には送らない（申請者本人が承認者でもある時） */
  excludeWorkerId?: string | null
}

export async function pushToApprovers(svc: any, accountId: string, msg: ApproverPush): Promise<PushResult> {
  const ids = await approverWorkerIds(svc, accountId, msg.excludeWorkerId)
  return pushToWorkers(svc, accountId, ids, { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, kind: 'approval' })
}

/** 管理画面の承認ページの絶対URL（ADMIN_URL 未設定なら空＝通知はタップしても何も開かない） */
export function adminUrl(path: string): string {
  const base = (Deno.env.get('ADMIN_URL') ?? '').replace(/\/+$/, '')
  return base ? `${base}${path}` : ''
}

/**
 * プッシュ通知の押し先: 作業員アプリと**同じドメイン**の管理画面（<作業員アプリ>/admin/...）。
 *
 * ★2026-09-27（設計「承認をやることで完結＋通知の統一」A-0・暫定）: 通知は作業員アプリ（ホーム画面に追加した PWA）に届く。
 *  押し先を別ドメインの管理画面（ADMIN_URL）にすると、作業員アプリの中にログインしていない管理画面が開き、
 *  ログアウトしたように見えた（2026-09-27 実機）。作業員アプリのドメインの /admin/* は管理画面へ中継済み
 *  （apps/liff/vercel.json の rewrites）で、同じドメインなら Supabase のログインを共有する＝ログインしたまま開く。
 *  メールのリンクは PC で開く前提なので adminUrl() のまま。A-2 で作業員アプリ内の承認画面に切り替えたら不要になる。
 */
export function appAdminUrl(path: string): string {
  const app = (Deno.env.get('PUBLIC_APP_URL') ?? Deno.env.get('LIFF_URL') ?? '').replace(/\/+$/, '')
  return app ? `${app}/admin${path}` : adminUrl(path)
}
