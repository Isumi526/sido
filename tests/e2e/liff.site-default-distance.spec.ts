// ============================================================
//  liff.site-default-distance.spec.ts
//  現場マスタに「会社からの往復距離(km)」を設定すると、日報でその現場を選んだ時に
//  ガソリン/軽油の往復kmの既定値として自動入力される（2026-09-03・ユーザー確定）:
//   「設定がある現場は日報でデフォルト値として自動入力させる。ただ、手動で編集も
//    可能にして…」
//  ★Step1（登録＋自動入力）のみの範囲。既定値を超える手動入力への理由入力/現場管理者
//   承認の必須化はStep2として別途対応（経費データの消費箇所が多く一度に広げない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, useDevWorker } from './helpers'

const TS = Date.now()
const SITE = `E2E距離既定_${TS}`
const DIST = 42.5
let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const ws = await rest(`workers?account_id=eq.${accountId}&active=eq.true&select=id,permission_role&limit=50`)
  const respWorkerId = (ws.find((w: any) => w.permission_role && w.permission_role !== 'worker') ?? ws[0])?.id
  await rest('sites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId,
      default_distance_km: DIST,
    }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
})

async function openVehicleForSite(page: import('@playwright/test').Page) {
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: SITE }) }).first()
  await siteSelect.selectOption({ label: SITE })
  await page.waitForTimeout(300)

  const expenseField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /^経費$/ }) }).first()
  await expenseField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(300)

  const vehicleField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: "車両" }) }).first()
  await vehicleField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(300)
  return vehicleField
}

test('★現場に既定距離があると、その現場を選んだ時にガソリンの往復kmが自動入力される', async ({ page }) => {
  await useDevWorker(page, 'site-distance')
  const vehicleField = await openVehicleForSite(page)

  const gasInput = vehicleField.locator('.expense-item').filter({ hasText: 'ガソリン' }).locator('input').first()
  await expect(gasInput).toHaveValue(String(DIST), { timeout: 10000 })
})

test('★自動入力された距離は手動で上書きできる（自動入力に固定されない）', async ({ page }) => {
  await useDevWorker(page, 'site-distance')
  const vehicleField = await openVehicleForSite(page)

  const gasInput = vehicleField.locator('.expense-item').filter({ hasText: 'ガソリン' }).locator('input').first()
  await expect(gasInput).toHaveValue(String(DIST), { timeout: 10000 })

  await gasInput.fill('99')
  await page.waitForTimeout(200)
  await expect(gasInput, '★手動編集した値が既定値に戻されない').toHaveValue('99')
})

test('既定距離が未設定の現場では、ガソリン欄は空のまま（無関係な値を入れない）', async ({ page }) => {
  await useDevWorker(page, 'site-distance')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  // 既定距離を持たない現場（テスト現場A・他specでも使われている固定シード）を選ぶ
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  const expenseField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /^経費$/ }) }).first()
  await expenseField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(300)
  const vehicleField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: "車両" }) }).first()
  await vehicleField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(300)

  const gasInput = vehicleField.locator('.expense-item').filter({ hasText: 'ガソリン' }).locator('input').first()
  await expect(gasInput).toHaveValue('')
})
