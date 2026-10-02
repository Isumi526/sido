// ============================================================
//  _shared/worker-push.ts
//  作業員の端末へ Web Push を送る（設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）。
//
//  ★2026-09-24 に承認者だけ（approver_push_subscriptions）で始めたものを、全員向けに一般化した。
//   購読は worker_push_subscriptions（1端末1行）、種類ごとのオン/オフは worker_notification_prefs（行が無い＝オン）。
//  ★配信は best-effort。失敗しても呼び出し元の処理（申請・リマインド等）は成立させる。
//  ★VAPID 鍵が無い環境（ローカル・E2E）では送らず、宛先の数だけ返す（誰に送る予定かを検証できる）。
//  ★送る時点で在籍中か・その種類をオフにしていないかを引き直す。
//  ★アイコンの数字（badge）は宛先ごとに数えて payload に載せる（Service Worker が setAppBadge する）。
//   アプリのベルと同じ考え方: 未読のお知らせ＋（承認者なら）承認待ちの残業申請。アプリを開けば正確な数に直る。
// ============================================================
import webpush from 'https://esm.sh/web-push@3.6.7'
import { APPROVER_ROLES } from './caller-identity.ts'
import { reportApprovalsFor } from './report-approval.ts'
import { distancePendingItems } from './distance-approval.ts'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     ?? ''

/** 通知の種類（設定ページで種類ごとにオフにできる）。apps/liff の設定ページと揃える */
export const PUSH_KINDS = ['approval', 'my_result', 'schedule', 'reminder', 'chat', 'announcement'] as const
export type PushKind = typeof PUSH_KINDS[number]

export type WorkerPush = {
  title: string
  body: string
  /** 通知タップで開くURL（作業員アプリと同じドメインの絶対URL） */
  url: string
  /** 同じ種類の通知をまとめる（連投で積み上がらない） */
  tag: string
  kind: PushKind
}

export type PushResult = { sent: number; pruned: number; targets: number; skipped?: string }

/** 今も承認者か（在籍中・APPROVER_ROLES）。残業・打刻修正・距離超過の「やること」に出す条件 */
async function isActiveApprover(svc: any, accountId: string, workerId: string): Promise<boolean> {
  const { data: me } = await svc.from('workers').select('permission_role, active')
    .eq('id', workerId).eq('account_id', accountId).maybeSingle()
  return !!me?.active && APPROVER_ROLES.includes((me.permission_role ?? '') as string)
}

/** 承認待ちの残業申請の数（承認者に出す分・自分の申請は数えない） */
export async function overtimePendingCount(svc: any, accountId: string, workerId: string): Promise<number> {
  if (!await isActiveApprover(svc, accountId, workerId)) return 0
  const { count } = await svc.from('overtime_requests').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('status', 'pending').neq('worker_id', workerId)
  return count ?? 0
}

/** 承認待ちの打刻修正の数（A-4。attendance-log の correction-approval-list と同じ規則） */
export async function punchPendingCount(svc: any, accountId: string, workerId: string): Promise<number> {
  if (!await isActiveApprover(svc, accountId, workerId)) return 0
  const { count } = await svc.from('attendance_correction_requests').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('status', 'pending').neq('worker_id', workerId)
  return count ?? 0
}

/** 承認待ちの距離超過の数（A-4。report-distance の approval-list と同じ規則・_shared/distance-approval.ts） */
export async function distancePendingCount(svc: any, accountId: string, workerId: string): Promise<number> {
  if (!await isActiveApprover(svc, accountId, workerId)) return 0
  return (await distancePendingItems(svc, accountId, workerId)).length
}

export type ApprovalBreakdown = { overtime: number; report: number; punch: number; distance: number }

/** 承認待ちの内訳（やることの行ごと）。日報は「今この人が承認/却下できるもの」（_shared/report-approval.ts・A-3） */
export async function approvalPendingBreakdown(svc: any, accountId: string, workerId: string): Promise<ApprovalBreakdown> {
  const [overtime, reports, punch, distance] = await Promise.all([
    overtimePendingCount(svc, accountId, workerId),
    reportApprovalsFor(svc, accountId, workerId).then(r => r.length).catch(() => 0),
    punchPendingCount(svc, accountId, workerId).catch(() => 0),
    distancePendingCount(svc, accountId, workerId).catch(() => 0),
  ])
  return { overtime, report: reports, punch, distance }
}

/** 承認待ちの数（残業申請＋日報＋打刻修正＋距離超過）。やることの数・アイコンの数字に入る */
export async function approvalPendingCount(svc: any, accountId: string, workerId: string): Promise<number> {
  const b = await approvalPendingBreakdown(svc, accountId, workerId)
  return b.overtime + b.report + b.punch + b.distance
}

/** アイコンの数字: 未読のお知らせ（site_document は「やること」側で数えるので除く）＋承認待ち */
export async function badgeCountFor(svc: any, accountId: string, workerId: string): Promise<number> {
  const { count: unread } = await svc.from('schedule_notifications').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null).neq('kind', 'site_document')
  return (unread ?? 0) + await approvalPendingCount(svc, accountId, workerId)
}

export async function pushToWorkers(svc: any, accountId: string, workerIds: string[], msg: WorkerPush): Promise<PushResult> {
  try {
    const ids = [...new Set(workerIds.filter(Boolean))]
    if (!ids.length) return { sent: 0, pruned: 0, targets: 0, skipped: 'no_target' }
    const { data: subs } = await svc.from('worker_push_subscriptions')
      .select('id, endpoint, p256dh, auth, worker_id').eq('account_id', accountId).in('worker_id', ids)
    if (!subs?.length) return { sent: 0, pruned: 0, targets: 0, skipped: 'no_subscription' }

    // ★在籍中の人だけ・その種類をオフにしていない人だけ
    const subWorkers = [...new Set((subs as any[]).map(s => s.worker_id))]
    const [{ data: ws }, { data: off }] = await Promise.all([
      svc.from('workers').select('id').eq('account_id', accountId).eq('active', true).in('id', subWorkers),
      svc.from('worker_notification_prefs').select('worker_id').eq('account_id', accountId)
        .eq('kind', msg.kind).eq('enabled', false).in('worker_id', subWorkers),
    ])
    const active = new Set(((ws ?? []) as any[]).map(w => w.id))
    const muted = new Set(((off ?? []) as any[]).map(p => p.worker_id))
    const targets = (subs as any[]).filter(s => active.has(s.worker_id) && !muted.has(s.worker_id))
    if (!targets.length) return { sent: 0, pruned: 0, targets: 0, skipped: 'no_target' }
    // ★宛先の絞り込みを鍵の確認より先にやる＝鍵が無い環境（ローカル・E2E）でも「誰に送る予定か」を検証できる
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) return { sent: 0, pruned: 0, targets: targets.length, skipped: 'no_vapid' }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    const badges = new Map<string, number>()
    for (const w of new Set(targets.map((s: any) => s.worker_id as string))) {
      badges.set(w, await badgeCountFor(svc, accountId, w).catch(() => 0))
    }
    let sent = 0
    const dead: string[] = []
    await Promise.all(targets.map(async (s: any) => {
      const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, badge: badges.get(s.worker_id) ?? 0 })
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
      } catch (e: any) {
        // 404/410 は購読が失効している＝以後送っても無駄なので掃除する
        const code = e?.statusCode
        if (code === 404 || code === 410) dead.push(s.id)
        else console.warn('[worker-push] 配信失敗:', code, e?.message)
      }
    }))
    if (dead.length) await svc.from('worker_push_subscriptions').delete().in('id', dead)
    return { sent, pruned: dead.length, targets: targets.length }
  } catch (e) {
    console.error('[worker-push]', e)
    return { sent: 0, pruned: 0, targets: 0, skipped: 'error' }
  }
}

/** 今も承認者（在籍中・APPROVER_ROLES）の作業員。申請者本人は除ける */
export async function approverWorkerIds(svc: any, accountId: string, excludeWorkerId?: string | null): Promise<string[]> {
  const { data } = await svc.from('workers').select('id')
    .eq('account_id', accountId).eq('active', true).in('permission_role', APPROVER_ROLES)
  return ((data ?? []) as any[]).map(w => w.id as string).filter(id => !excludeWorkerId || id !== excludeWorkerId)
}
