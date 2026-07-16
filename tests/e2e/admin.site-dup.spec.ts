// ============================================================
//  admin.site-dup.spec.ts
//  現場マスタ追加時、既存に「似た」現場があれば警告（緊急：重複登録の気づき）
//   - かな表記ゆれ（ひらがな↔カタカナ）でも検知できる
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const EXISTING = `E2Eさくら荘_${TS}`     // 既存（ひらがな）
const TYPED    = `E2Eサクラ荘_${TS}`     // 入力（カタカナ）＝正規化すると一致

test.beforeAll(async () => {
  const accountId = await getAccountId()
  await rest('sites', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, name: EXISTING, active: true }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=like.E2E*${TS}`, { method: 'DELETE' }).catch(() => {})
})

test('現場追加で、かな表記ゆれの既存現場を重複候補として警告する', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場マスタ')

  await page.locator('.btn-add').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()

  // カタカナで入力 → ひらがなの既存現場が重複候補として出る
  await modal.locator('input.input').first().fill(TYPED)
  const warn = modal.locator('.dup-warn')
  await expect(warn).toBeVisible()
  await expect(warn).toContainText(EXISTING)

  // 全く異なる名前なら警告は消える
  await modal.locator('input.input').first().fill(`無関係な現場_${TS}`)
  await expect(modal.locator('.dup-warn')).toHaveCount(0)
})

test('重複候補チップをクリックすると、新規作成をやめて既存の現場を編集する画面に切り替わる(2026-07-16)', async ({ page }) => {
  page.on('dialog', (d) => d.accept())   // formDirtyによる「切り替えますか？」確認を自動承諾

  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.locator('.btn-add').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('h2')).toContainText('現場を追加')

  await modal.locator('input.input').first().fill(TYPED)
  const chip = modal.locator('.similar-site-chip', { hasText: EXISTING })
  await expect(chip).toBeVisible()
  await chip.click()

  // 新規作成モーダルが「編集」モーダルへ切り替わり、既存現場の名前が入っている
  await expect(modal.locator('h2')).toContainText('現場を編集', { timeout: 10000 })
  await expect(modal.locator('input.input').first()).toHaveValue(EXISTING)
})
