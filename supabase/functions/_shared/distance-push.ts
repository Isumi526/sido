// ============================================================
//  _shared/distance-push.ts
//  距離超過の申請が日報に入った時、承認者の端末へ「承認のお願い」を送る（A-4・2026-10-02）。
//
//  ★距離超過は日報の保存（save-daily-report）・期限内の編集（report-edit-log の即反映）・
//   承認された日報の反映（applyPending）の3か所で日報に入る。どこでも「保存の前後で新しく承認待ちに
//   なったものだけ」を送る（同じ申請で2回送らない）。
//  ★best-effort: 送れなくても保存は成功させる（通知の失敗で日報が保存できないのが一番困る）。
//  ★宛先は承認者全員から申請者本人を除く（やることの一覧と同じ規則・_shared/distance-approval.ts）。
// ============================================================
import { newPendingOverages } from './distance-approval.ts'
import { DISTANCE_FIELD_LABELS } from './distance-overage.gen.ts'
import { pushToApprovers, appUrl } from './approver-push.ts'

export async function pushNewDistanceOverages(svc: any, accountId: string, rep: {
  reportId: string | null
  userId: string | null
  date: string
  prevSites: unknown
  nextSites: unknown
}): Promise<void> {
  try {
    if (!rep.reportId) return
    const fresh = newPendingOverages(rep.prevSites, rep.nextSites)
    if (!fresh.length) return
    let workerId: string | null = null
    let name = ''
    if (rep.userId) {
      const { data: u } = await svc.from('users').select('worker_id, real_name').eq('id', rep.userId).eq('account_id', accountId).maybeSingle()
      workerId = (u?.worker_id as string) ?? null
      name = (u?.real_name as string) ?? ''
      if (workerId) {
        const { data: w } = await svc.from('workers').select('name').eq('id', workerId).maybeSingle()
        name = (w?.name as string) || name
      }
    }
    const what = [...new Set(fresh.map(p => DISTANCE_FIELD_LABELS[p.field]))].join('・')
    const r = await pushToApprovers(svc, accountId, {
      title: '距離超過の承認のお願い',
      body: `${name || '作業員'}さん（${rep.date}・${what}）`,
      url: appUrl(`/approvals/distance/${rep.reportId}`),
      tag: `distance-overage-${rep.reportId}`,
      excludeWorkerId: workerId,
    })
    if (r.skipped && r.skipped !== 'no_target' && r.skipped !== 'no_subscription') console.warn('[distance-push] skipped:', r.skipped)
  } catch (e) {
    console.error('[distance-push] failed (保存は成功):', e)
  }
}
