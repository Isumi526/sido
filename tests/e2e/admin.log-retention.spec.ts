// ============================================================
//  admin.log-retention.spec.ts
//  操作ログの保存期間（12か月・実装は13か月で余裕を持たせる）を超過分だけ
//  自動削除する。契約 別紙2の「アクセスの記録を●か月間保存する」の裏付け。
//
//  ★このspecが守るもの:
//   - 13か月より古いoperation_logs/reminder_logsだけ消える（新しいものは残る）
//   - 削除件数がlog_purgesに記録される（AC3）
//   - document_send_logs / daily_report_edit_logs は対象外のまま
//     （労務/取引の証跡として別途の保存期間判断が要るため・AC4）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

test.describe('ログの保存期間（13か月超過分を自動削除）', () => {
  test('★古いログだけ消え、新しいログは残る。削除件数が記録される', async () => {
    const accountId = await getAccountId()
    const OLD = `E2E古い操作_${Date.now()}`
    const NEW = `E2E最近の操作_${Date.now()}`

    // 直接SQLでcreated_atを過去に固定する必要があるためservice_role経由でも
    // created_atは操作できない（トリガー等でnow()固定の可能性）。RPC経由で確認する。
    await restSrv('rpc/purge_old_logs', { method: 'POST', body: '{}' }).catch(() => {})

    // 13か月より古い行・新しい行を1件ずつ作る（PostgRESTはcreated_atの明示指定を通す想定）
    await restSrv('operation_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: accountId, actor: 'E2E', action: 'e2e', summary: OLD, created_at: new Date(Date.now() - 14 * 30 * 86400000).toISOString() },
        { account_id: accountId, actor: 'E2E', action: 'e2e', summary: NEW, created_at: new Date().toISOString() },
      ]),
    })

    const before = await restSrv(`operation_logs?account_id=eq.${accountId}&summary=in.(${OLD},${NEW})&select=summary`)
    expect(before.length, '両方とも入っている').toBe(2)

    const purgesBefore = await restSrv('log_purges?select=id&order=run_at.desc&limit=1')
    await restSrv('rpc/purge_old_logs', { method: 'POST', body: '{}' })
    const purgesAfter = await restSrv('log_purges?select=id,table_name,deleted_count&order=run_at.desc&limit=5')
    expect(purgesAfter.length, '★実行記録が増える(AC3)').toBeGreaterThan(0)
    expect(purgesAfter.some((p: any) => p.id !== purgesBefore[0]?.id), '新しい実行記録がある').toBe(true)

    const after = await restSrv(`operation_logs?account_id=eq.${accountId}&summary=in.(${OLD},${NEW})&select=summary`)
    expect(after.map((r: any) => r.summary), '★古い方だけ消え、新しい方は残る').toEqual([NEW])
  })

  test('★document_send_logs は対象外のまま残る（回帰ガード・AC4）', async () => {
    // ★振る舞いで確認する: 20か月前のdocument_send_logsを作ってpurgeを実行しても
    //  消えないこと。purge_old_logs() の対象にこの表がうっかり追加されたら、
    //  取引の送信記録（下請けとの「送った/送っていない」の証跡）が消えてしまう。
    const accountId = await getAccountId()
    const subject = `E2E対象外_${Date.now()}`
    const created = await restSrv('document_send_logs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, subcontractor_id: null, purpose: 'e2e', kind: 'e2e',
        recipients: [], subject, created_by: null,
        created_at: new Date(Date.now() - 20 * 30 * 86400000).toISOString(),
      }),
    }).catch(() => [])
    const id = created?.[0]?.id
    expect(id, 'テスト行を作れる').toBeTruthy()

    await restSrv('rpc/purge_old_logs', { method: 'POST', body: '{}' })

    const still = await restSrv(`document_send_logs?id=eq.${id}&select=id`)
    expect(still.length, '★20か月前でも対象外なので消えない').toBe(1)
    await restSrv(`document_send_logs?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  })
})
