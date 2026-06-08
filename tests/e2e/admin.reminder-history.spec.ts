// ============================================================
//  admin.reminder-history.spec.ts
//  リマインド実行履歴(reminder_logs)の閲覧
//   - AC1: /reminder-history に履歴が新しい順で表示される（結果/未送信/受信者/種別）
//   - AC2: 履歴ゼロ時は「まだ実行履歴がありません」を表示
//  ※ reminder_logs は RLS 無効テーブル。anonキーで直接 seed/後始末する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const R_OLD = `E2E古い結果_${TS}`
const R_NEW = `E2E新しい結果_${TS}`

test.describe('リマインド履歴', () => {
  let accountId = ''

  test.afterAll(async () => {
    if (accountId) {
      await rest(`reminder_logs?account_id=eq.${accountId}&result=like.E2E*${TS}`, { method: 'DELETE' }).catch(() => {})
      await rest(`reminder_logs?result=eq.${encodeURIComponent(R_OLD)}`, { method: 'DELETE' }).catch(() => {})
      await rest(`reminder_logs?result=eq.${encodeURIComponent(R_NEW)}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('AC1: 履歴が新しい順・各列付きで表示される', async ({ page }) => {
    accountId = await getAccountId()
    await rest('reminder_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: accountId, executed_at: '2026-06-01T08:00:00+09:00', target_date: '2026-05-31', result: R_OLD, unsubmitted_count: 3, recipients_count: 2, manual: false },
        { account_id: accountId, executed_at: '2026-06-07T08:00:00+09:00', target_date: '2026-06-06', result: R_NEW, unsubmitted_count: 0, recipients_count: 1, manual: true },
      ]),
    })

    await page.goto('/reminder-history', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('リマインド履歴')

    const newRow = page.locator('tr', { hasText: R_NEW })
    const oldRow = page.locator('tr', { hasText: R_OLD })
    await expect(newRow).toBeVisible({ timeout: 10000 })
    await expect(oldRow).toBeVisible()

    // 種別・カウント列
    await expect(newRow).toContainText('手動')
    await expect(oldRow).toContainText('自動')
    await expect(newRow.locator('td.num').first()).toHaveText('0')   // 未送信
    await expect(oldRow.locator('td.num').first()).toHaveText('3')

    // 新しい順（R_NEW が R_OLD より上）
    const texts = await page.locator('tbody tr td.result').allInnerTexts()
    const iNew = texts.findIndex(t => t.includes(R_NEW))
    const iOld = texts.findIndex(t => t.includes(R_OLD))
    expect(iNew).toBeGreaterThanOrEqual(0)
    expect(iOld).toBeGreaterThanOrEqual(0)
    expect(iNew).toBeLessThan(iOld)
  })

  test('AC2: 履歴ゼロのアカウントでは空メッセージ', async ({ page }) => {
    // test アカウントの履歴を空にして検証（このテストはAC1の後始末前に走らないよう独立シードを消す）
    const accId = await getAccountId()
    await rest(`reminder_logs?account_id=eq.${accId}`, { method: 'DELETE' }).catch(() => {})
    await page.goto('/reminder-history', { waitUntil: 'networkidle' })
    await expect(page.locator('.empty')).toContainText('まだ実行履歴がありません')
  })
})
