// ============================================================
//  admin.login-log.spec.ts
//  契約対応⑤: 管理画面のログイン成功を operation_logs に残す（別紙2 §4「アクセスの記録」・12か月保存）。
//   https://app.notion.com/p/3dd0ff81c56b815a8380d0222bb5c803
//  ★守ること: 成功だけ記録（action='ログイン'・actor=email・summary=アプリ種別/UA）。パスワードは書かない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS, ADMIN_LOGIN_EMAIL } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })   // 未ログイン状態から始める

test('★admin ログイン成功が operation_logs に残り、失敗は残らない', async ({ page }) => {
  const accountId = await getAccountId()
  const q = `operation_logs?account_id=eq.${accountId}&action=eq.${encodeURIComponent('ログイン')}&actor=eq.${encodeURIComponent(ADMIN_LOGIN_EMAIL)}&select=id,summary&order=created_at.desc`
  const before = (await restSrv(q)).length
  // 失敗（記録されない）
  await page.goto(`/login?id=${ADMIN_LOGIN_ID}&pass=wrong-pass`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  expect((await restSrv(q)).length, '失敗は記録しない').toBe(before)
  // 成功
  await page.goto(`/login?id=${ADMIN_LOGIN_ID}&pass=${ADMIN_LOGIN_PASS}`, { waitUntil: 'networkidle' })
  await expect.poll(async () => (await restSrv(q)).length, { timeout: 15000 }).toBe(before + 1)
  const rows = await restSrv(q)
  expect(rows[0].summary).toMatch(/^admin \//)
  expect(rows[0].summary).not.toContain(ADMIN_LOGIN_PASS)
})
