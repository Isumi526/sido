// ============================================================
//  lib/appNotify.ts
//  作業員へのアプリ内通知を1件積む（管理画面から）。
//
//  ★なぜアプリ内通知か（2026-08-14 ユーザー指示）:
//   LINE連携は基本しない方針で、メール通知も見られない前提。
//   この2つしか届け先が無いと、通知は事実上どこにも届かない。
//   アプリを開けば必ず気づける場所（お知らせ一覧）に集約する。
//
//  ★テーブル名は予定通知時代のまま（schedule_notifications）。
//   中身は kind / link_path を持つ汎用インボックス。改名は破壊的なのでしない。
//   詳細は 20260814020000_notifications_generalize.sql を参照。
//
//  ★best-effort。通知に失敗しても本体の処理（承認・差し戻し）は成立している。
//   ここで例外を投げて画面を「失敗しました」にする方が有害なので、
//   戻り値で成否を返すだけにする。
// ============================================================
import { supabase } from './supabase'

export type AppNotifyKind =
  | 'schedule'           // 予定が追加された
  | 'report_reject'      // 日報の編集/提出が差し戻された
  | 'overtime_decision'  // 残業申請が承認/却下された
  | 'expense_reject'     // 経費精算が差し戻された
  | 'chat_mention'       // 現場チャットでメンションされた

export async function notifyWorker(input: {
  accountId: string
  workerId: string
  kind: AppNotifyKind
  title: string
  body?: string | null
  linkPath?: string | null
}): Promise<boolean> {
  if (!input.accountId || !input.workerId) return false
  const { error } = await supabase.from('schedule_notifications').insert({
    account_id: input.accountId,
    worker_id: input.workerId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link_path: input.linkPath ?? null,
  })
  if (error) {
    console.error('[appNotify] 通知を積めませんでした:', error)
    return false
  }
  return true
}

/** users.id から workers.id を引く（通知の宛先は worker_id で持つため） */
export async function workerIdOfUser(accountId: string, userId: string): Promise<string | null> {
  if (!accountId || !userId) return null
  const { data } = await supabase.from('users')
    .select('worker_id').eq('id', userId).eq('account_id', accountId).maybeSingle()
  return (data?.worker_id as string) ?? null
}
