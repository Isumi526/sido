// ============================================================
//  admin.estimate-builder-edit.spec.ts
//  【見積ビルダー】案件名のインライン編集 ／ 明細のドラッグ並び替え
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PROJ = `編集案件_${TS}`
const RENAMED = `改名案件_${TS}`

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  for (const name of [PROJ, RENAMED]) {
    const ps = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}&select=id`).catch(() => [])
    for (const p of ps ?? []) await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('案件名をインライン編集できる', async ({ page }) => {
  const accountId = await getAccountId()
  const proj = (await restSrv('estimate_projects', { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, name: PROJ }) }))[0]
  await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })

  await page.locator('[data-testid="project-select"]').click()        // クリックで編集モード
  await page.locator('[data-testid="project-name-input"]').fill(RENAMED)
  await page.locator('[data-testid="project-name-input"]').press('Enter')

  await expect.poll(async () => {
    const ps = await restSrv(`estimate_projects?id=eq.${proj.id}&select=name`)
    return ps?.[0]?.name ?? null
  }, { timeout: 10000 }).toBe(RENAMED)
  await expect(page.locator('[data-testid="project-select"]')).toContainText(RENAMED)
})

test('明細をドラッグで並び替えできる', async ({ page }) => {
  const accountId = await getAccountId()
  // 改名済みの案件を開く（前テストでRENAMEDに）
  const ps = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(RENAMED)}&select=id`)
  await page.goto(`/estimate-builder?project=${ps[0].id}`, { waitUntil: 'networkidle' })

  await page.locator('[data-testid="add-row"]').click()
  await page.locator('[data-testid="item-name-0"]').fill('AAA')
  await page.locator('[data-testid="add-row"]').click()
  await page.locator('[data-testid="item-name-1"]').fill('BBB')

  // 1行目(AAA)のハンドルを2行目(BBB)へドラッグ → 並びが [BBB, AAA] に
  await page.locator('[data-testid="item-drag-0"]').dragTo(page.locator('[data-testid="item-drag-1"]'))
  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue('BBB')
  await expect(page.locator('[data-testid="item-name-1"]')).toHaveValue('AAA')
})
