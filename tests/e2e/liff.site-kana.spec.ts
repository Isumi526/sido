// ============================================================
//  liff.site-kana.spec.ts
//  LIFF 日報フォームの現場選択リストが読み仮名の50音順で並ぶ
//   - AC3: 現場optionが name_kana 昇順で並ぶ（名前順ではなく仮名順）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
// 仮名順と名前順が逆（A: 名前zzz/仮名あ, B: 名前aaa/仮名わ）→ A が先に並べば仮名順の証明
const A_NAME = `E2ELZ_zzz_${TS}`
const A_KANA = `あ_${TS}`
const B_NAME = `E2ELA_aaa_${TS}`
const B_KANA = `わ_${TS}`

test.describe('LIFF：現場選択リストの50音順', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: accountId, name: A_NAME, name_kana: A_KANA, active: true },
        { account_id: accountId, name: B_NAME, name_kana: B_KANA, active: true },
      ]),
    })
  })

  test.afterAll(async () => {
    for (const n of [A_NAME, B_NAME]) {
      await rest(`sites?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('AC3: 現場optionが仮名順（あ→わ）で並ぶ', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })

    // 現場の select（'テスト現場A' を含む）。master fetch完了を待つ
    const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
    await expect(siteSelect).toBeVisible({ timeout: 15000 })
    await expect(siteSelect.locator('option', { hasText: A_NAME })).toHaveCount(1, { timeout: 15000 })

    const opts = await siteSelect.locator('option').allInnerTexts()
    const iA = opts.findIndex(o => o.includes(A_NAME))
    const iB = opts.findIndex(o => o.includes(B_NAME))
    expect(iA, 'A optionが存在').toBeGreaterThanOrEqual(0)
    expect(iB, 'B optionが存在').toBeGreaterThanOrEqual(0)
    expect(iA).toBeLessThan(iB)
  })
})
