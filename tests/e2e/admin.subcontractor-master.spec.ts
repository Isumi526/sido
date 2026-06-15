// ============================================================
//  admin.subcontractor-master.spec.ts
//  下請け業者マスタ拡張（業者マスタ＋担当者複数＋振込口座）
//   AC1: 住所・振込口座を登録 → 再編集で保持される
//   AC2: 担当者を複数登録でき、DBに保存される（注文書/請求の宛先用）
//  ※ トークン認証基盤(AC3)は別途・設計承認後。
//  design: docs/design/subcontractor-detail-search.md（土台: 見積→注文→請求）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

const NAME = `E2E業者マスタ_${Date.now()}`
const ADDR = '東京都新宿区西新宿1-1-1'
const BANK = 'E2E銀行'
const HOLDER = 'カ）E2Eコウム'
const C1 = 'E2E担当太郎'
const C2 = 'E2E担当花子'

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  try {
    const rows = await restSrv(`subcontractors?name=eq.${encodeURIComponent(NAME)}&select=id`)
    for (const r of rows ?? []) {
      await restSrv(`subcontractor_contacts?subcontractor_id=eq.${r.id}`,    { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_edit_logs?subcontractor_id=eq.${r.id}`,   { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_trade_types?subcontractor_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
  } catch { /* ignore */ }
  await restSrv(`subcontractors?name=eq.${encodeURIComponent(NAME)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2: 住所・振込口座・担当者(複数)を登録 → DB保存 & 再編集で保持', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.btn-add').click()
  const modal = page.locator('.modal.wide')
  await expect(modal).toBeVisible()

  await modal.getByPlaceholder('例：○○工務店').fill(NAME)
  await modal.locator('select').first().selectOption('業者')
  await modal.getByPlaceholder('例：東京都新宿区…').fill(ADDR)
  await modal.getByPlaceholder('銀行名（例：○○銀行）').fill(BANK)
  await modal.getByPlaceholder('支店名（例：△△支店）').fill('本店')
  await modal.getByPlaceholder('口座番号').fill('1234567')
  await modal.getByPlaceholder('口座名義（例：カ）○○）').fill(HOLDER)

  // 担当者を2件追加
  await modal.locator('.btn-add-contact').click()
  await modal.locator('.btn-add-contact').click()
  const rows = modal.locator('.contact-row')
  await expect(rows).toHaveCount(2)
  await rows.nth(0).getByPlaceholder('担当者名 *').fill(C1)
  await rows.nth(0).getByPlaceholder('メール').fill('taro@example.com')
  await rows.nth(1).getByPlaceholder('担当者名 *').fill(C2)
  await rows.nth(1).getByPlaceholder('電話').fill('090-0000-0000')

  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden()

  // DBに業者＋担当者2件が保存されている
  const subs = await restSrv(`subcontractors?name=eq.${encodeURIComponent(NAME)}&select=id,address,bank_name,bank_account_holder`)
  expect(subs.length).toBe(1)
  expect(subs[0].address).toBe(ADDR)
  expect(subs[0].bank_name).toBe(BANK)
  expect(subs[0].bank_account_holder).toBe(HOLDER)
  const contacts = await restSrv(`subcontractor_contacts?subcontractor_id=eq.${subs[0].id}&is_deleted=eq.false&select=name,email,phone&order=sort_order`)
  expect(contacts.map((c: any) => c.name)).toEqual([C1, C2])

  // 再編集で保持されている
  const row = page.locator('tr', { hasText: NAME })
  await row.getByRole('button', { name: '編集' }).click()
  const modal2 = page.locator('.modal.wide')
  await expect(modal2.getByPlaceholder('例：東京都新宿区…')).toHaveValue(ADDR)
  await expect(modal2.getByPlaceholder('銀行名（例：○○銀行）')).toHaveValue(BANK)
  await expect(modal2.locator('.contact-row')).toHaveCount(2)
  await expect(modal2.locator('.contact-row').nth(0).getByPlaceholder('担当者名 *')).toHaveValue(C1)
})

test('AC2: 担当者を1件削除して保存 → DBに反映される', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: NAME })
  await row.getByRole('button', { name: '編集' }).click()
  const modal = page.locator('.modal.wide')
  await expect(modal.locator('.contact-row')).toHaveCount(2)

  // 2件目を削除して保存
  await modal.locator('.contact-row').nth(1).locator('.contact-del').click()
  await expect(modal.locator('.contact-row')).toHaveCount(1)
  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden()

  const subs = await restSrv(`subcontractors?name=eq.${encodeURIComponent(NAME)}&select=id`)
  const contacts = await restSrv(`subcontractor_contacts?subcontractor_id=eq.${subs[0].id}&is_deleted=eq.false&select=name`)
  expect(contacts.map((c: any) => c.name)).toEqual([C1])
})
