// ============================================================
//  admin.worker-name-kana.spec.ts
//  作業員マスタのふりがな(name_kana)＋五十音順表示。
//   - 既存の sites.name_kana（現場マスタ）と同じ設計を作業員マスタへ適用したもの。
//   - ふりがなを保存でき、一覧が name_kana 優先で五十音順に並ぶこと。
//  Notion: 3a50ff81c56b81059d59cd6fbc756403
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

// 漢字の並びとふりがなの並びが逆になる組み合わせにする
//  （漢字順なら 阿部→鈴木、ふりがな順なら すずき(鈴木)→わたなべ(阿部)）
//  ＝ name ではなく name_kana で並んでいることを確実に判定できる。
const W1 = { name: 'E2Eかな_阿部', kana: 'わたなべ' }
const W2 = { name: 'E2Eかな_鈴木', kana: 'すずき' }

test.beforeAll(async () => {
  const accountId = await getAccountId()
  for (const w of [W1, W2]) {
    const found = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(w.name)}&select=id`)
    if (found?.[0]?.id) {
      await restSrv(`workers?id=eq.${found[0].id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name_kana: w.kana, active: true, status: 'active' }),
      })
    } else {
      await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          account_id: accountId, name: w.name, name_kana: w.kana, role: 'site',
          permission_role: 'worker', daily_wage: 20000, hourly_wage: 2000, active: true, status: 'active', sort_order: 990,
        }),
      })
    }
  }
})

test('AC: 一覧が name_kana 優先の五十音順で並び、ふりがなが表示される', async ({ page }) => {
  await page.goto('/workers', { waitUntil: 'networkidle' })
  await page.waitForSelector('.table tbody tr', { timeout: 20000 })

  // ふりがながサブ表示される
  const row1 = page.locator('.table tbody tr', { hasText: W1.name })
  await expect(row1).toBeVisible({ timeout: 15000 })
  await expect(row1.locator('.kana-sub')).toHaveText(W1.kana)

  // 並び順: ふりがな順（すずき < わたなべ）＝ 鈴木 が 阿部 より先に来る。
  // 漢字順（阿部 < 鈴木）なら逆になるので、name_kana で並んでいることの判定になる。
  const names = await page.locator('.table tbody tr td.name').allInnerTexts()
  const idxSuzuki = names.findIndex(t => t.includes(W2.name))
  const idxAbe    = names.findIndex(t => t.includes(W1.name))
  expect(idxSuzuki, `${W2.name} が一覧にある`).toBeGreaterThanOrEqual(0)
  expect(idxAbe, `${W1.name} が一覧にある`).toBeGreaterThanOrEqual(0)
  expect(idxSuzuki, `ふりがな順なら すずき(${W2.name}) が わたなべ(${W1.name}) より前。実際の並び: ${JSON.stringify(names)}`).toBeLessThan(idxAbe)
})

test('AC: 編集画面でふりがなを保存でき、再読込後も保持される', async ({ page }) => {
  const accountId = await getAccountId()
  await page.goto('/workers', { waitUntil: 'networkidle' })
  await page.waitForSelector('.table tbody tr', { timeout: 20000 })

  const row = page.locator('.table tbody tr', { hasText: W2.name })
  await row.getByRole('button', { name: '編集' }).click()

  const kanaInput = page.getByTestId('worker-name-kana')
  await expect(kanaInput).toBeVisible({ timeout: 10000 })
  await expect(kanaInput).toHaveValue(W2.kana)   // 既存値が展開される

  const updated = 'すずきいちろう'
  await kanaInput.fill(updated)
  await page.getByRole('button', { name: /保存|更新/ }).first().click()
  await page.waitForTimeout(2500)

  // DBに保存されている
  const rows = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(W2.name)}&select=name_kana`)
  expect(rows?.[0]?.name_kana, 'ふりがながDBへ保存される').toBe(updated)

  // 元に戻す（後続テスト/再実行のため冪等に）
  await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(W2.name)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name_kana: W2.kana }),
  })
})
