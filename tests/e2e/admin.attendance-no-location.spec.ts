// ============================================================
//  admin.attendance-no-location.spec.ts
//  出退勤ログに「位置なし」の印と理由を出す（2026-10-02 設計「入力の手間を減らす」I-2）。
//  承認はしない（確認事項4=A）。見て分かるようにするだけ。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const REASON = `E2E位置なし理由_${Date.now()}`
let logId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const w = (await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`))[0]
  const rows = await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    worker_id: w.id, type: 'checkin', agreed_rule_texts: [], location_missing_reason: REASON,
  }) })
  logId = rows[0].id
})
test.afterAll(async () => {
  if (logId) await restSrv(`attendance_logs?id=eq.${logId}`, { method: 'DELETE' }).catch(() => {})
})

test('★位置が取れずに理由を書いた打刻は「位置なし」と理由が出る', async ({ page }) => {
  await page.goto('/attendance', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: REASON })
  await expect(row, '理由が出る').toBeVisible({ timeout: 15000 })
  await expect(row.getByTestId('log-no-location')).toHaveText('位置なし')
  await expect(row.locator('.location-link'), '地図のリンクは出ない').toHaveCount(0)
})
