// ============================================================
//  admin.name-readings.spec.ts
//  読み仮名の未入力の一覧（2026-10-02 設計「見やすさと分かりやすさ」II-3・確認事項5=A）。
//
//  ★守ること:
//   1. 読み仮名の無い現場（失注を除く）・協力業者・作業区分が一覧に出て、その場で入れられる。入れたら一覧から消える
//   2. 漢字は読み仮名として受け付けない
//   3. 作業区分は EF 経由で保存できる（work_categories は直接書けない）
//   4. 新しく現場を登録する時（受注以降）は読み仮名も必須。見積中は今どおり現場名だけで保存できる
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E読み未入力現場_${TS}`
const SITE_LOST = `E2E読み未入力失注_${TS}`
const SUB = `E2E読み未入力業者_${TS}`
const CAT = `E2E読み未入力区分_${TS}`
const NEW_SITE = `E2E読み必須新規_${TS}`
let accountId = ''
let siteId = ''
let lostId = ''
let subId = ''
let catId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const sites = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([
    { account_id: accountId, name: SITE, status: 'ordered', active: true },
    { account_id: accountId, name: SITE_LOST, status: 'lost', active: true },
  ]) })
  siteId = sites.find((s: any) => s.name === SITE).id
  lostId = sites.find((s: any) => s.name === SITE_LOST).id
  subId = (await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, active: true }) }))[0].id
  catId = (await restSrv('work_categories', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: CAT, active: true, sort_order: 999 }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`sites?id=in.(${[siteId, lostId].filter(Boolean).join(',')})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NEW_SITE)}`, { method: 'DELETE' }).catch(() => {})
  if (subId) await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  if (catId) await restSrv(`work_categories?id=eq.${catId}`, { method: 'DELETE' }).catch(() => {})
})

test('★現場: 未入力の一覧に出て、その場で入れると消える（漢字は受け付けない・失注は出ない）', async ({ page }) => {
  await page.goto('/name-readings', { waitUntil: 'networkidle' })
  await page.getByTestId('readings-tab-sites').click()
  await page.getByTestId('readings-search').fill(`_${TS}`)
  const row = page.getByTestId(`readings-row-${siteId}`)
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId(`readings-row-${lostId}`), '失注の現場は出ない').toHaveCount(0)

  await page.getByTestId(`readings-input-${siteId}`).fill('山田')
  await page.getByTestId(`readings-save-${siteId}`).click()
  await expect(page.getByTestId(`readings-error-${siteId}`), '漢字は止める').toBeVisible()
  expect((await restSrv(`sites?id=eq.${siteId}&select=name_kana`))[0].name_kana).toBeNull()

  await page.getByTestId(`readings-input-${siteId}`).fill('やまだないそう')
  await page.getByTestId(`readings-save-${siteId}`).click()
  await expect(row, '入れたら一覧から消える').toHaveCount(0, { timeout: 10000 })
  expect((await restSrv(`sites?id=eq.${siteId}&select=name_kana`))[0].name_kana).toBe('やまだないそう')
})

test('★協力業者と作業区分も入れられる（作業区分は EF 経由）', async ({ page }) => {
  await page.goto('/name-readings', { waitUntil: 'networkidle' })
  await page.getByTestId('readings-search').fill(`_${TS}`)

  await page.getByTestId('readings-tab-subcontractors').click()
  await page.getByTestId(`readings-input-${subId}`).fill('イーツーイーギョウシャ')
  await page.getByTestId(`readings-save-${subId}`).click()
  await expect(page.getByTestId(`readings-row-${subId}`)).toHaveCount(0, { timeout: 10000 })
  expect((await restSrv(`subcontractors?id=eq.${subId}&select=name_kana`))[0].name_kana).toBe('イーツーイーギョウシャ')

  await page.getByTestId('readings-tab-categories').click()
  await page.getByTestId(`readings-input-${catId}`).fill('くぶん')
  await page.getByTestId(`readings-save-${catId}`).click()
  await expect(page.getByTestId(`readings-row-${catId}`)).toHaveCount(0, { timeout: 10000 })
  expect((await restSrv(`work_categories?id=eq.${catId}&select=name_kana`))[0].name_kana).toBe('くぶん')
})

test('★新しく現場を登録する時（受注）は読み仮名が無いと保存できない', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '＋ 追加' }).click()
  const modal = page.locator('.modal-overlay').filter({ hasText: '現場を追加' })
  await expect(modal).toBeVisible()
  await modal.locator('input[placeholder*="○○ビル"]').fill(NEW_SITE)
  await modal.getByTestId('site-modal-status').selectOption('ordered')
  await modal.getByRole('button', { name: '保存', exact: true }).click()
  await expect(modal.locator('.error'), '読み仮名も未入力の必須項目に出る').toContainText('読み仮名')
  expect((await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NEW_SITE)}&select=id`)).length).toBe(0)
})
