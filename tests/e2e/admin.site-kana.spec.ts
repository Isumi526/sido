// ============================================================
//  admin.site-kana.spec.ts
//  現場マスタの読み仮名(name_kana)と50音順並び
//   - AC1: 現場マスタUIで読み仮名を入力・保存でき、再読込後も保持（DBにも反映）
//   - AC2: 読み仮名を設定した現場が現場マスタ一覧で50音順に並ぶ（名前順ではなく仮名順）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()

// 仮名順と名前順が逆になるように仕込む（=並びが仮名で決まることを証明）
//  A: 名前は後ろ(zzz) だが 仮名は先頭(あ)
//  B: 名前は前(aaa)  だが 仮名は末尾(わ)
const A_NAME = `E2EカナZ_zzz_${TS}`
const A_KANA = `あ_${TS}`
const B_NAME = `E2EカナA_aaa_${TS}`
const B_KANA = `わ_${TS}`

let accountId = ''

test.describe('現場マスタ：読み仮名と50音順', () => {
  test.afterAll(async () => {
    for (const n of [A_NAME, B_NAME, `E2E手入力カナ_${TS}`]) {
      await rest(`sites?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('AC1: 読み仮名を入力・保存→再読込後も保持・DB反映', async ({ page }) => {
    const name = `E2E手入力カナ_${TS}`
    const kana = `てすとよみ_${TS}`

    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()

    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    // .input[0]=現場名, [1]=読み仮名
    await modal.locator('.input').nth(0).fill(name)
    await modal.locator('.input').nth(1).fill(kana)
    await modal.locator('.btn-save').click()

    // 一覧に行が出て読み仮名セルに反映
    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row.locator(".kana-sub")).toHaveText(kana)

    // DB反映
    await expect.poll(async () => {
      const r = await rest(`sites?name=eq.${encodeURIComponent(name)}&select=name_kana`)
      return r?.[0]?.name_kana
    }, { timeout: 10000 }).toBe(kana)

    // 再読込後も保持
    await page.reload({ waitUntil: 'networkidle' })
    const row2 = page.locator('tr', { hasText: name })
    await expect(row2.locator(".kana-sub")).toHaveText(kana)
  })

  test('AC2: 読み仮名の50音順で並ぶ（名前順ではない）', async ({ page }) => {
    accountId = await getAccountId()
    await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: accountId, name: A_NAME, name_kana: A_KANA, active: true },
        { account_id: accountId, name: B_NAME, name_kana: B_KANA, active: true },
      ]),
    })

    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('tr', { hasText: A_NAME })).toBeVisible({ timeout: 10000 })

    const names = await page.locator('tbody tr td.name').allInnerTexts()
    const iA = names.findIndex(n => n.includes(A_NAME))
    const iB = names.findIndex(n => n.includes(B_NAME))
    expect(iA, 'A行が存在').toBeGreaterThanOrEqual(0)
    expect(iB, 'B行が存在').toBeGreaterThanOrEqual(0)
    // 仮名: あ < わ なので A が B より上。名前順なら aaa<zzz で B が上になるはず＝仮名順を証明
    expect(iA).toBeLessThan(iB)
  })
})
