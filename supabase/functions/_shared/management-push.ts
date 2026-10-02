// ============================================================
//  _shared/management-push.ts
//  経費精算の申請・在庫の確認待ちが出た時、管理者・役員/経理の端末へ「承認のお願い」を送る
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-5・2026-10-02）。
//
//  ★処理そのものは管理画面（確認事項#2=A）。通知を押すと作業員アプリと同じドメインの管理画面
//   （/admin/...）が開く＝同じログインのまま処理できる（A-0 と同じ仕組み）。
//  ★宛先は管理者・役員/経理だけ（現場責任者は経費精算・在庫の画面を開けない）。申請者本人は除く。
//  ★best-effort: 送れなくても申請・登録は成功させる。結果は呼び出し側が応答に載せて確かめられるよう返す。
// ============================================================
import { pushToManagers, appUrl } from './approver-push.ts'
import type { PushResult } from './worker-push.ts'

function periodLabel(key: string): string {
  const [y, m, half] = key.split('-')
  return `${parseInt(m, 10)}月${half === 'first' ? '前半' : '後半'}（${y}年）`
}

/** 経費精算の申請が届いた（status=申請中）。押すとその月の管理画面の経費精算が開く */
export async function pushExpenseApplication(svc: any, accountId: string, s: {
  settlementId: string
  targetUserId: string
  periodKey: string
}): Promise<PushResult | null> {
  try {
    const { data: u } = await svc.from('users').select('worker_id, real_name, workers(name)')
      .eq('id', s.targetUserId).eq('account_id', accountId).maybeSingle()
    const name = (u as any)?.workers?.name ?? (u as any)?.real_name ?? '作業員'
    const r = await pushToManagers(svc, accountId, {
      title: '経費精算の申請が届きました',
      body: `${name}さん（${periodLabel(s.periodKey)}）・管理画面で処理`,
      url: appUrl(`/admin/expenses?ym=${s.periodKey.slice(0, 7)}`),
      tag: `expense-application-${s.settlementId}`,
      excludeWorkerId: ((u as any)?.worker_id as string) ?? null,
    })
    if (r.skipped && r.skipped !== 'no_target' && r.skipped !== 'no_subscription') console.warn('[management-push] expense skipped:', r.skipped)
    return r
  } catch (e) {
    console.error('[management-push] expense failed (申請は成功):', e)
    return null
  }
}

const KIND_LABEL: Record<string, string> = { in: '入庫', out: '持ち出し', return: '引き上げ' }

/** 在庫の確認待ちが出た（事務が確認する設定の会社）。押すと管理画面の在庫が開く */
export async function pushInventoryPending(svc: any, accountId: string, p: {
  pendingId: string
  workerId: string | null
  workerName: string | null
  kind: string
  qty: number
}): Promise<PushResult | null> {
  try {
    const r = await pushToManagers(svc, accountId, {
      title: '在庫の確認待ちが届きました',
      body: `${p.workerName || '作業員'}さん（${KIND_LABEL[p.kind] ?? p.kind}・${p.qty}）・管理画面で確認`,
      url: appUrl('/admin/inventory'),
      tag: `inventory-pending-${p.pendingId}`,
      excludeWorkerId: p.workerId,
    })
    if (r.skipped && r.skipped !== 'no_target' && r.skipped !== 'no_subscription') console.warn('[management-push] inventory skipped:', r.skipped)
    return r
  } catch (e) {
    console.error('[management-push] inventory failed (登録は成功):', e)
    return null
  }
}
