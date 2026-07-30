// ============================================================
//  admin.expense-account-category.spec.ts
//  勘定科目（科目）列の検証（2026-07-30 列統一）:
//   - 明細に account が入っていればそれを表示（例: 会議費）
//   - 無ければカテゴリから自動導出（その他雑経費→接待交際費 / その他→消耗品費）
//  データは REST で直接投入（liff入力UIの select は liff E2E ではなくデータ経路で担保）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NOTE = 'E2E科目列' + TS

test.describe('経費 勘定科目列', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    // 2026-09-20（クリーンな月）: 科目明示あり/なしの雑経費＋その他
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: u[0].id, date: '2026-09-20', is_working: true, note: NOTE,
        sites: [{ siteName: 'E2E科目現場', expenses: {
          entertainments: [
            { yen: 1000, label: 'E2E会食', payee: 'E2E料亭', account: '会議費' },
            { yen: 2000, label: 'E2E手土産', payee: 'E2E菓子店' },
          ],
          others: [{ yen: 500, label: 'E2Eテープ', payee: 'E2Eホームセンター' }],
        } }] }) })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('日毎集計: account入力値が優先され、未入力はカテゴリから導出される', async ({ page }) => {
    // ?ym= で直接遷移（月送りクリックのループは月末31日に既知バグで月を飛ばすため使わない。
    //  バグは expenses-daily.vue の shiftMonth 由来・別チケットで記録済み・本specの検証対象外）
    await page.goto('/expenses-daily?ym=2026-09', { waitUntil: 'networkidle' })
    const rowOf = (payee: string) => page.locator('table tbody tr', { hasText: payee }).first()
    await expect(rowOf('E2E料亭')).toBeVisible({ timeout: 15000 })
    await expect(rowOf('E2E料亭'), '入力された科目を表示').toContainText('会議費')
    await expect(rowOf('E2E菓子店'), '雑経費の既定は接待交際費').toContainText('接待交際費')
    await expect(rowOf('E2Eホームセンター'), 'その他の既定は消耗品費').toContainText('消耗品費')
  })
})
