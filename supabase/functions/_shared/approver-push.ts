// ============================================================
//  _shared/approver-push.ts
//  承認者（管理者・現場責任者）の端末へ「承認待ち」を Web Push で届ける（A-3・2026-09-24）。
//
//  ★なぜ要るか: 2026-09-23 お客様報告。残業申請の通知はメール1通きりで、締切前申請の36%が
//   翌日以降の承認だった。メールより気づきやすい端末通知を、承認者がふだん使っている
//   作業員アプリ(LIFF・ホーム画面に追加された PWA)に出す。タップで管理画面の承認ページが開く。
//
//  ★購読は approver_push_subscriptions（人単位）。現場チャットの push_subscriptions（現場単位）とは別。
//  ★配信は best-effort。失敗しても呼び出し元の処理（申請・リマインドメール）は成立させる。
//  ★VAPID 鍵が無い環境では何もしない（send-site-chat-push と同じ）。
//  ★送る時点で「まだ承認者か」を引き直す。購読後に権限が外れた人・退職した人には送らない。
// ============================================================
import webpush from 'https://esm.sh/web-push@3.6.7'
import { APPROVER_ROLES } from './caller-identity.ts'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     ?? ''

export type ApproverPush = {
  title: string
  body: string
  /** 通知タップで開くURL（管理画面の承認ページ等・絶対URL） */
  url: string
  /** 同じ種類の通知をまとめる（連投で積み上がらない） */
  tag: string
  /** この作業員の端末には送らない（申請者本人が承認者でもある時） */
  excludeWorkerId?: string | null
}

export async function pushToApprovers(
  svc: any, accountId: string, msg: ApproverPush,
): Promise<{ sent: number; pruned: number; targets: number; skipped?: string }> {
  try {
    const { data: subs } = await svc.from('approver_push_subscriptions')
      .select('id, endpoint, p256dh, auth, worker_id').eq('account_id', accountId)
    if (!subs?.length) return { sent: 0, pruned: 0, targets: 0, skipped: 'no_subscription' }

    // ★今も有効な承認者だけ（購読した後に権限が外れた・退職した人へは送らない）
    const workerIds = [...new Set((subs as any[]).map(s => s.worker_id))]
    const { data: ws } = await svc.from('workers').select('id')
      .eq('account_id', accountId).eq('active', true)
      .in('permission_role', APPROVER_ROLES).in('id', workerIds)
    const allowed = new Set(((ws ?? []) as any[]).map(w => w.id))
    const targets = (subs as any[]).filter(s =>
      allowed.has(s.worker_id) && (!msg.excludeWorkerId || s.worker_id !== msg.excludeWorkerId))
    if (!targets.length) return { sent: 0, pruned: 0, targets: 0, skipped: 'no_target' }
    // ★宛先の絞り込みを鍵の確認より先にやる＝鍵が無い環境（ローカル・E2E）でも「誰に送る予定か」を検証できる
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) return { sent: 0, pruned: 0, targets: targets.length, skipped: 'no_vapid' }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag })
    let sent = 0
    const dead: string[] = []
    await Promise.all(targets.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
      } catch (e: any) {
        // 404/410 は購読が失効している＝以後送っても無駄なので掃除する
        const code = e?.statusCode
        if (code === 404 || code === 410) dead.push(s.id)
        else console.warn('[approver-push] 配信失敗:', code, e?.message)
      }
    }))
    if (dead.length) await svc.from('approver_push_subscriptions').delete().in('id', dead)
    return { sent, pruned: dead.length, targets: targets.length }
  } catch (e) {
    console.error('[approver-push]', e)
    return { sent: 0, pruned: 0, targets: 0, skipped: 'error' }
  }
}

/** 管理画面の承認ページの絶対URL（ADMIN_URL 未設定なら空＝通知はタップしても何も開かない） */
export function adminUrl(path: string): string {
  const base = (Deno.env.get('ADMIN_URL') ?? '').replace(/\/+$/, '')
  return base ? `${base}${path}` : ''
}
