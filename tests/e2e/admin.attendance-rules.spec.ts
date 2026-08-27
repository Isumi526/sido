// ============================================================
//  admin.attendance-rules.spec.ts
//  出退勤の確認ルールがアカウント共通になった（2026-08-27 出退勤モデル変更）。
//   - 現場ごとのルール(site_rules)ではなく account_attendance_rules を使う
//   - 現場を選ばずに /site-rules を開けて登録できる（現場スコープが無い）
//   - 登録したルールが打刻画面(LIFF)に出て、同意が打刻に記録される
//     ※ LIFF 側の表示は liff プロジェクトの spec で見る。ここは admin の登録まで。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const RULE = `E2E共通ルール_${TS}`
let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
})
test.afterAll(async () => {
  // ★restSrv(service_role)で消す。anon には SELECT しか無いので rest だと消えず、
  //  残ったルールが他 spec の打刻送信をブロックする（一括実行時だけ落ちる・2026-08-27）。
  await restSrv(`account_attendance_rules?content=eq.${encodeURIComponent(RULE)}`, { method: 'DELETE' }).catch(() => {})
})

test('現場を選ばずに共通ルールを登録でき、一覧に出る', async ({ page }) => {
  await page.goto('/site-rules', { waitUntil: 'networkidle' })
  // ★現場スコープが無い＝ site_id クエリ無しで開けて、現場一覧へ飛ばされない
  await expect(page).toHaveURL(/\/site-rules$/)
  await expect(page.getByTestId('rule-add-open')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('rule-add-open').click()
  await page.locator('.modal textarea').fill(RULE)
  await page.locator('.modal select').selectOption('both')
  await page.locator('.btn-save').click()

  await expect(page.getByTestId('rule-rows')).toContainText(RULE, { timeout: 15000 })

  // DBにもアカウント単位で入る（現場には紐づかない）
  const rows = await rest(`account_attendance_rules?content=eq.${encodeURIComponent(RULE)}&select=account_id,timing`)
  expect(rows.length, '共通ルールが1件入る').toBe(1)
  expect(rows[0].account_id, '自テナントに紐づく').toBe(accountId)
  expect(rows[0].timing).toBe('both')
})
