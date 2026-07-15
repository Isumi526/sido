// ============================================================
//  admin.process-gantt-import.spec.ts
//  工程表インポート AC4: 色塗りガントチャート形式(日付が列見出し・工程の稼働日は
//  セルの色塗りで表現)のExcelを取込むと、色塗り→日付ヘッダー突き合わせで
//  開始日/終了日が正しく推定されることを検証する（2026-07-15・[[project_sido]]）。
//  fixtures/process-gantt.xlsx は openpyxl で生成した合成データ(header=2026-08-01〜10・
//  内装ボード工事=08-03〜08-06着色・電気配線工事=08-06〜08-09着色)。実サンプルが未提供のため
//  合成データで検証(グルーミング時の決定・詳細はcommit message参照)。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E工程ガント現場_${TS}`
let siteId = ''

test.describe('工程管理 色塗りガントチャート取込(AI解析・AC4)', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const created = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = created[0].id
  })

  test.afterAll(async () => {
    await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('色塗りガントExcelをドロップすると、色塗り範囲から開始日/終了日を正しく推定してエディタに読み込む', async ({ page }) => {
    test.setTimeout(90000)   // 実Geminiコールを含むため既定30sでは不足しうる
    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.site-select').selectOption(siteId)
    await page.locator('.btn-add').click()
    await expect(page.locator('.editor-modal')).toBeVisible({ timeout: 10000 })
    await page.locator('.editor-modal .ed-site select').selectOption(siteId)

    const filePath = path.resolve(__dirname, 'fixtures/process-gantt.xlsx')
    const buffer = fs.readFileSync(filePath)
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer()
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
      const file = new File([bytes], 'process-gantt.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      dt.items.add(file)
      return dt
    }, buffer.toString('base64'))
    await page.locator('.excel-row').dispatchEvent('drop', { dataTransfer })

    await expect(page.locator('.excel-msg')).toBeVisible({ timeout: 45000 })
    await expect(page.locator('.excel-msg.ok')).toBeVisible({ timeout: 1000 })

    const rows = page.locator('.ed-row')
    await expect(rows).toHaveCount(2, { timeout: 5000 })
    const row0 = rows.nth(0)
    await expect(row0.locator('input.ed-name')).toHaveValue('内装ボード工事')
    await expect(row0.locator('input[title="開始日"]')).toHaveValue('2026-08-03')
    await expect(row0.locator('input[title="終了日"]')).toHaveValue('2026-08-06')
    const row1 = rows.nth(1)
    await expect(row1.locator('input.ed-name')).toHaveValue('電気配線工事')
    await expect(row1.locator('input[title="開始日"]')).toHaveValue('2026-08-06')
    await expect(row1.locator('input[title="終了日"]')).toHaveValue('2026-08-09')

    await page.locator('.btn-save').click()
    await expect(page.locator('.editor-modal')).toBeHidden({ timeout: 10000 })
    await expect(page.getByText('内装ボード工事')).toBeVisible({ timeout: 10000 })
  })
})
