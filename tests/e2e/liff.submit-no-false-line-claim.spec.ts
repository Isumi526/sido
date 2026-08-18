// ============================================================
//  liff.submit-no-false-line-claim.spec.ts
//  送信完了画面が「LINEグループに通知しました」と嘘をつかない
//
//  ★経緯（2026-08-18 大塚さん「LINEグループに通知してんの？」）:
//   完了画面は**無条件に**「LINEグループに通知しました」と出していた。
//   ところが日報のLINE通知は、クロステナント漏洩（全社共通グループへ送っていた）の
//   対策で封じ込めてあり、本番は全テナント notify_report_enabled=false、
//   さらに LIFF 側も NUXT_PUBLIC_REPORT_LINE_NOTIFY=false で submit-report を呼んでいない。
//   ＝ **1通も飛んでいないのに「通知しました」と表示していた**。
//
//  ★これは「壊れたまま成功したように見える」型の不具合。
//   人は画面を信じるので、通知が来ていないことに誰も気づけない。
//
//  ★このspecが守るもの
//   通知が飛んでいない時に「LINEグループに通知しました」と出さないこと。
//   （飛んだ時に出すことは、通知を実際にONにできる環境が無いのでここでは見ない）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, todayJST } from './helpers'

test('★LINE通知が飛んでいない時に「通知しました」と出さない', async ({ page }) => {
  // 送信枠を自分で確保する（先行specが未送信日を使い切ると「送信済みです」になる）
  const userId = await getDevUserId()
  if (userId) {
    await rest(`daily_reports?user_id=eq.${userId}&date=eq.${todayJST()}`, { method: 'DELETE' }).catch(() => {})
  }

  await page.goto('/report', { waitUntil: 'networkidle' })
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  await page.locator('[data-testid="site-select-0"]').selectOption('テスト現場A')
  await page.waitForTimeout(400)
  await page.locator('.submit-confirm input[type="checkbox"]').check()

  const submit = page.locator('button[type="submit"].btn-submit')
  if (await submit.isDisabled()) {
    test.skip(true, '既知バグ: 送信ボタンが有効化されない（本件とは無関係）')
    return
  }
  await submit.click()

  await expect(page.getByText(/送信完了/)).toBeVisible({ timeout: 20000 })
  // ★ここが本体。通知していないのに通知したと言わない
  await expect(page.getByText('LINEグループに通知しました'),
    '★1通も飛んでいないのに「通知しました」と出してはいけない').toHaveCount(0)
  await expect(page.getByText('日報を送信しました'), '事実だけを出す').toBeVisible()

  // 後始末
  if (userId) {
    await rest(`daily_reports?user_id=eq.${userId}&date=eq.${todayJST()}`, { method: 'DELETE' }).catch(() => {})
  }
})
