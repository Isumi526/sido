// ============================================================
//  admin.process-multisite-import.spec.ts
//  工程表インポート(複数現場・AC1-3)：1ファイルに複数現場が混在した工程表Excelを取り込み、
//  各タスクが「抽出された現場名」で正しい現場に振り分けられて保存される（＝全タスクが1現場に
//  誤紐付けされるバグの修正）。マージ規則は A(上書き)/追加 をレビュー画面で選択。
//  ※ test-process-excel-import EF が実Geminiで site_name を抽出する（temperature=0で決定的）。
//  fixtures/process-multisite.xlsx = 現場列で「E2E現場アルファ/E2E現場ベータ」を明示した最小サンプル。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { rest, restSrv, getAccountId, ensureResponsibleWorkerId } from './helpers'

const SITE_A = 'E2E現場アルファ'
const SITE_B = 'E2E現場ベータ'
let siteAId = ''
let siteBId = ''

async function ensureSite(accountId: string, name: string, respWorkerId: string): Promise<string> {
  const found = await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
  if (found?.[0]?.id) return found[0].id
  return (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name, active: true, responsible_worker_id: respWorkerId }) }))[0].id
}

test.describe('工程表インポート（複数現場）', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const resp = await ensureResponsibleWorkerId(accountId)
    siteAId = await ensureSite(accountId, SITE_A, resp)
    siteBId = await ensureSite(accountId, SITE_B, resp)
    // クリーンスレート
    await restSrv(`process_tasks?site_id=in.(${siteAId},${siteBId})`, { method: 'DELETE' }).catch(() => {})
  })
  test.afterAll(async () => {
    await restSrv(`process_tasks?site_id=in.(${siteAId},${siteBId})`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${siteBId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('複数現場混在Excelを取込→各タスクが抽出現場名で正しい現場に振り分けられる', async ({ page }) => {
    test.setTimeout(120000)   // 実Geminiコールを含む
    page.on('dialog', (d) => d.accept())   // 取込完了 alert を閉じる

    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.btn-import').click()

    const dt = await page.evaluateHandle((data) => {
      const d = new DataTransfer()
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      d.items.add(new File([bytes], 'process-multisite.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      return d
    }, fs.readFileSync(path.resolve(__dirname, 'fixtures/process-multisite.xlsx')).toString('base64'))
    await page.locator('.import-drop').dispatchEvent('drop', { dataTransfer: dt })

    // 解析完了→レビュー表に2現場が出る
    await expect(page.locator('[data-testid="import-review"]')).toBeVisible({ timeout: 60000 })
    const rows = page.locator('.import-table tbody tr')
    await expect(rows).toHaveCount(2, { timeout: 5000 })

    // 各行の抽出現場名に応じて取込先を明示選択（auto-matchの揺れを排除）
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      const nameText = (await rows.nth(i).locator('td').first().innerText()).trim()
      const target = nameText.includes('アルファ') ? siteAId : nameText.includes('ベータ') ? siteBId : ''
      if (target) await rows.nth(i).locator('select').first().selectOption(target)
    }

    await page.locator('[data-testid="import-run"]').click()
    await expect(page.locator('.import-modal')).toBeHidden({ timeout: 15000 })

    // ★各タスクが正しい現場に紐づく（全タスクが1現場に寄らない）。process_tasks はRLS(authenticated)のため service role で読む。
    const aTasks = await restSrv(`process_tasks?site_id=eq.${siteAId}&select=name`)
    const bTasks = await restSrv(`process_tasks?site_id=eq.${siteBId}&select=name`)
    expect(aTasks.length, 'アルファに2工程').toBe(2)
    expect(bTasks.length, 'ベータに2工程').toBe(2)
    const aNames = aTasks.map((t: any) => t.name).join(',')
    const bNames = bTasks.map((t: any) => t.name).join(',')
    expect(aNames).toContain('解体')
    expect(bNames).toContain('配線')
  })
})
