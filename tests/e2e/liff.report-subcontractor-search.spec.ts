// ============================================================
//  liff.report-subcontractor-search.spec.ts
//  日報の協力業者の選択に絞り込みの欄を付ける（2026-09-30 シード要望11「使わない業者が多すぎて探すのが大変」）。
//
//  ★守ること:
//   1. 業者が多い時（8社を超える）だけ、選択欄の上に絞り込みの欄が出る。少ない時（現場に紐付けた業者だけ）は出ない
//   2. 名前でも読み仮名でも探せる。カタカナ/ひらがなの違いは無視する
//   3. 何も当たらない時は「該当する業者がありません」
//   4. 選んだ業者は、絞り込みを変えても消えない
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, useDevWorker } from './helpers'

const TS = Date.now()
const SITE = `E2E絞込現場_${TS}`
const HIT = `E2E山田内装_${TS}`
const HIT_KANA = `やまだないそう${TS}`
const OTHERS = Array.from({ length: 9 }, (_, i) => `E2E絞込業者${String(i + 1).padStart(2, '0')}_${TS}`)
let siteId = ''
const subIds: string[] = []

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, status: 'in_progress' }),
  }))[0].id
  const rows = [{ name: HIT, name_kana: HIT_KANA }, ...OTHERS.map(n => ({ name: n, name_kana: null }))]
  for (const r of rows) {
    subIds.push((await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, active: true, ...r }),
    }))[0].id)
  }
})
test.afterAll(async () => {
  if (subIds.length) await restSrv(`subcontractors?id=in.(${subIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  if (siteId) await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('★業者が多い時だけ絞り込みの欄が出て、名前・読み仮名（カタカナでも）で探せる。選んだ業者は消えない', async ({ page }) => {
  await useDevWorker(page, 'report')
  await page.goto('/report', { waitUntil: 'networkidle' })
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 15000 })

  // 業者の紐付けが1社だけの現場では、絞り込みの欄は出ない
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: SITE }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  if (!(await page.locator('[data-testid^="sub-select-"]').count())) {
    await page.getByRole('button', { name: '業者を追加' }).first().click()
  }
  await expect(page.locator('[data-testid^="sub-select-"]').first()).toBeVisible()
  await expect(page.locator('[data-testid^="sub-search-"]'), '業者が少ない時は出さない').toHaveCount(0)

  // 紐付けの無い現場＝全業者が出る → 絞り込みの欄が出る
  await siteSelect.selectOption({ label: SITE })
  const search = page.locator('[data-testid^="sub-search-"]').first()
  const select = page.locator('[data-testid^="sub-select-"]').first()
  await expect(search).toBeVisible({ timeout: 10000 })

  // 読み仮名（ひらがな）で当たる
  await search.fill('やまだないそう' + TS)
  await expect(select.locator('option', { hasText: HIT })).toHaveCount(1)
  await expect(select.locator('option', { hasText: OTHERS[0] }), '当たらない業者は出ない').toHaveCount(0)

  // カタカナで入れても当たる
  await search.fill('ヤマダナイソウ' + TS)
  await expect(select.locator('option', { hasText: HIT })).toHaveCount(1)

  // 名前の一部でも当たる
  await search.fill(`絞込業者03_${TS}`)
  await expect(select.locator('option', { hasText: OTHERS[2] })).toHaveCount(1)
  await expect(select.locator('option', { hasText: HIT })).toHaveCount(0)

  // 何も当たらない
  await search.fill('該当しないはずの語' + TS)
  await expect(select.locator('option', { hasText: '該当する業者がありません' })).toHaveCount(1)

  // 選んだ業者は、絞り込みを変えても消えない
  await search.fill('やまだ' + '')
  await select.selectOption({ label: HIT })
  await search.fill(`絞込業者03_${TS}`)
  await expect(select).toHaveValue(HIT)
  await expect(select.locator('option', { hasText: HIT }), '選択中は残す').toHaveCount(1)
})
