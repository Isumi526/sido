// ============================================================
//  liff.expense-deadline.spec.ts （dev モード）
//  H: 作業員が LIFF ホームで経費申請の締切を把握できる
//  アラート表示期間: first=15日〜18日10:00 / second=翌月1日〜3日10:00（JST）
//  → 実行日に依存しないよう、時計を前半ウィンドウ内(16日)に固定して検証する
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId } from './helpers'

// 前半アラート期間(15〜18日)の内側に固定
const FIXED_NOW = new Date('2026-06-16T09:00:00+09:00')
const FIXED_FIRST = '2026-06-first'

test.describe('経費締切バナー(H)', () => {
  test.beforeEach(async () => {
    // 固定時計の対象期(2026-06-first)の settlement を消し「未申請」にする
    const uid = await getDevUserId()
    if (uid) await rest(`expense_settlements?user_id=eq.${uid}&period_key=eq.${FIXED_FIRST}`, { method: 'DELETE' }).catch(() => {})
  })

  test('アラート期間内: ホームに締切案内が表示される', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto('/', { waitUntil: 'networkidle' })
    const banner = page.locator('.deadline-card')
    await expect(banner).toBeVisible({ timeout: 10000 })
    await expect(banner).toContainText('経費申請')
    await expect(banner).toContainText('締切')
  })

  test('アラート期間外: 締切案内は表示されない', async ({ page }) => {
    // 5日 はどの期のアラート期間にも入らない（前半は15日〜、後半は翌月1日〜）
    await page.clock.setFixedTime(new Date('2026-06-05T09:00:00+09:00'))
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    await expect(page.locator('.deadline-card')).toHaveCount(0)
  })
})
