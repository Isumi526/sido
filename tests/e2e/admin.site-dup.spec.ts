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
