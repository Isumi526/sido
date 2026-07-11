// ============================================================
//  admin.process-excel-import.spec.ts
//  工程管理(process)の一括エディタで、既存の工程表Excelをドラッグ&ドロップすると
//  AI(Gemini)解析結果が編集可能な行としてエディタに読み込まれ、保存するとDBに
//  永続する（2026-07-11・[[project_sido]]）。
//  fixtures/process-sample.xlsx は「工程名/担当/開始日/終了日」列を持つ最小サンプル
//  （temperature=0・単純で曖昧さの無い1行のため決定的に読み取れる想定）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E工程Excel現場_${TS}`

let siteId = ''

test.describe('工程管理 Excel取込(AI解析)', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const created = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = created[0].id
  })

  test.afterAll(async () => {
    await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('Excelドロップ→AI解析結果がエディタに読み込まれ、保存でDBに永続する', async ({ page }) => {
    test.setTimeout(90000)   // 実Geminiコールを含むため既定30sでは不足しうる
    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.site-select').selectOption(siteId)
    await page.locator('.btn-add').click()
    await expect(page.locator('.editor-modal')).toBeVisible({ timeout: 10000 })
    await page.locator('.editor-modal .ed-site select').selectOption(siteId)

    const filePath = path.resolve(__dirname, 'fixtures/process-sample.xlsx')
    const buffer = fs.readFileSync(filePath)
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer()
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
      const file = new File([bytes], 'process-sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      dt.items.add(file)
      return dt
    }, buffer.toString('base64'))
    await page.locator('.excel-row').dispatchEvent('drop', { dataTransfer })

    // AI解析完了まで待つ（実Geminiコール・temperature=0で決定的）
    await expect(page.locator('.excel-msg')).toBeVisible({ timeout: 45000 })
    await expect(page.locator('.excel-msg.ok')).toBeVisible({ timeout: 1000 })
    await expect(page.locator('.ed-name').first()).toHaveValue('E2Eサンプル工程_AAA', { timeout: 5000 })

    await page.locator('.btn-save').click()
    await expect(page.locator('.editor-modal')).toBeHidden({ timeout: 10000 })
    await expect(page.getByText('E2Eサンプル工程_AAA')).toBeVisible({ timeout: 10000 })
  })
})
