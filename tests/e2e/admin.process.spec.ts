// ============================================================
//  admin.process.spec.ts
//  工程管理（ガント簡易版）: 現場を選び工程(タスク)を追加→ガント表示＋DB永続。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E工程現場_${TS}`
const TASK = `内装ボード_${TS}`

test.describe('工程管理', () => {
  let siteId = ''
  test.afterAll(async () => {
    if (siteId) await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('現場を選び工程を追加→ガント表示・DB永続', async ({ page }) => {
    const accountId = await getAccountId()
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = s[0].id

    await page.goto('/process', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('工程管理')
    await page.locator('.header-actions select').selectOption({ label: SITE })
    await page.locator('.btn-add').click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await modal.locator('.fld', { hasText: '工程名' }).locator('input').fill(TASK)
    await modal.locator('input[type="date"]').nth(0).fill('2026-07-01')
    await modal.locator('input[type="date"]').nth(1).fill('2026-07-10')
    await modal.locator('input[type="range"]').fill('40')
    await modal.locator('.btn-save').click()
    await expect(modal).toBeHidden()

    // ガントに出る
    const row = page.locator('.g-row', { hasText: TASK })
    await expect(row).toBeVisible()
    await expect(row).toContainText('40%')

    // DB永続
    const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name,progress,start_date,end_date`)
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe(TASK)
    expect(rows[0].progress).toBe(40)
    expect(rows[0].start_date).toBe('2026-07-01')

    // 再読込で保持
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.header-actions select').selectOption({ label: SITE })
    await expect(page.locator('.g-row', { hasText: TASK })).toBeVisible()
  })
})
