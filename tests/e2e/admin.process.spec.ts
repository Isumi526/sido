// ============================================================
//  admin.process.spec.ts
//  工程管理（エクセル準拠ガント）: 現場を選び、1現場に複数工程を一括追加
//  →カレンダーにガント表示＋DB永続。1:nの一括エディタを検証。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E工程現場_${TS}`
const TASK = `内装ボード_${TS}`
const TASK2 = `解体_${TS}`

test.describe('工程管理', () => {
  let siteId = ''
  test.afterAll(async () => {
    if (siteId) await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('1現場に複数工程を一括追加→ガント表示・DB永続', async ({ page }) => {
    const accountId = await getAccountId()
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = s[0].id

    await page.goto('/process', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('工程管理')
    await page.locator('.header-actions select').selectOption({ label: SITE })

    // 一括エディタを開く
    await page.locator('.btn-add').click()
    const modal = page.locator('.editor-modal')
    await expect(modal).toBeVisible()

    // 1件目
    const row1 = modal.locator('.ed-row').nth(0)
    await row1.locator('.ed-name').fill(TASK)
    await row1.locator('input[type="date"]').nth(0).fill('2026-07-01')
    await row1.locator('input[type="date"]').nth(1).fill('2026-07-10')
    await row1.locator('.ed-progress').fill('40')

    // 行を追加して2件目（＝1現場に複数工程をまとめて）
    await modal.locator('.btn-addrow').click()
    const row2 = modal.locator('.ed-row').nth(1)
    await row2.locator('.ed-name').fill(TASK2)
    await row2.locator('input[type="date"]').nth(0).fill('2026-07-12')
    await row2.locator('input[type="date"]').nth(1).fill('2026-07-20')
    await row2.locator('.ed-progress').fill('100')

    await modal.locator('.btn-save').click()
    await expect(modal).toBeHidden()

    // 両方ガントに出る
    await expect(page.locator('.g-row', { hasText: TASK })).toContainText('40%')
    await expect(page.locator('.g-row', { hasText: TASK2 })).toContainText('100%')

    // DB永続（2件）
    const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name,progress,start_date&order=sort_order`)
    expect(rows.length).toBe(2)
    const names = rows.map((r: any) => r.name)
    expect(names).toContain(TASK)
    expect(names).toContain(TASK2)

    // 再読込で保持
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.header-actions select').selectOption({ label: SITE })
    await expect(page.locator('.g-row', { hasText: TASK })).toBeVisible()
    await expect(page.locator('.g-row', { hasText: TASK2 })).toBeVisible()
  })
})
