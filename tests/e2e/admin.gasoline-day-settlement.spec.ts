// ============================================================
//  admin.gasoline-day-settlement.spec.ts
//  ③ 日報レベルの「本日のガソリン代」(daily_reports.gasoline_yen) が立替(gasoline_tategae=true)の時、
//     経費精算(expenses)に日報日の期(前半/後半)の「立替」として計上されることを検証。
//   - 日報の少ないクリーンな月(2026-09)に gasoline_yen=12,345/tategae の日報を投入
//     → /expenses の当該作業員×前半 行の立替・合計に ¥12,345 が乗り、明細に「ガソリン代」が出る（表示はflatten正規化ラベル）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NOTE = 'E2Eガソ日報精算' + TS

test.describe.configure({ mode: 'serial' })

test.describe('日報ガソリン代→経費精算', () => {
  let devUserId = ''
  let workerName = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id,real_name,workers(name)`)
    devUserId = u[0].id
    workerName = u[0].workers?.name ?? u[0].real_name ?? '—'
    // 2026-09-10（前半）: 本日のガソリン代 ¥12,345・立替
    // ★liters と fuelType も入れる（ℓ列・内訳が落ちるバグの回帰防止）
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: devUserId, date: '2026-09-10', is_working: true, note: NOTE,
        gasoline_items: [{ yen: 12345, tategae: true, liters: 40.5, fuelType: 'regular', payee: 'E2Eガソリンスタンド' }], sites: [] }) })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('立替の本日ガソリン代が前半の立替・合計に計上され、明細に出る', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年9月')) {
      await page.locator('.month-nav .btn-nav').nth(1).click()
    }
    const row = page.locator('tr.data-row', { hasText: workerName }).filter({ hasText: '前半' })
    await expect(row).toBeVisible()
    // 立替列（td.num の3番目＝うち立替）に ¥12,345
    await expect(row.locator('td.num').nth(2)).toContainText('12,345')

    await row.click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('ガソリン代')   // 表示ラベルはflatten正規化（ガソリン代（本日）→ガソリン代・main反映済み）
    await expect(modal.locator('.settle-pay')).toContainText('¥12,345')
  })

  // ★2026-07-30 修正の回帰防止:
  //  本日のガソリン代の行は sites[] 配下ではなく日報直下のため flatten を通らず、
  //  3画面で手組みされていた。admin経費管理だけ liters と note を入れておらず、
  //  ℓ列と内訳が常に空になっていた（共有関数 flattenGasolineItems に一本化して解消）。
  test('本日ガソリン行に ℓ と内訳（燃料種別）が出る（経費管理）', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年9月')) {
      await page.locator('.month-nav .btn-nav').nth(1).click()
    }
    await page.locator('tr.data-row', { hasText: workerName }).filter({ hasText: '前半' }).click()
    const gasRow = page.locator('.detail-table tbody tr', { hasText: 'ガソリン代' }).first()
    await expect(gasRow).toBeVisible()
    // ℓ列（品名の次）に給油量が出る。空だと立替の根拠が分からない
    await expect(gasRow, 'ℓが出る').toContainText('40.5')
    await expect(gasRow, '支払先が出る').toContainText('E2Eガソリンスタンド')
    // 2026-07-30 列統一: 科目列（勘定科目・ガソリン系→車両費）とヘッダの統一ラベルが出る
    await expect(gasRow, '科目が勘定科目で出る').toContainText('車両費')
    await expect(page.locator('.detail-table thead'), 'インボイス番号ヘッダ').toContainText('インボイス番号')
    await expect(page.locator('.detail-table thead'), '科目ヘッダ').toContainText('科目')
    await expect(page.locator('.detail-table thead'), '品名ヘッダ').toContainText('品名')
  })

  test('日毎集計でも同じ行に ℓ と内訳が出る（3画面で内容が食い違わない）', async ({ page }) => {
    await page.goto('/expenses-daily', { waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年9月')) {
      await page.locator('.month-nav .btn-nav').nth(1).click()
    }
    // 科目列は勘定科目（ガソリン系→車両費）で出る（2026-07-30 列統一）
    const row = page.locator('table tbody tr', { hasText: 'E2Eガソリンスタンド' }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row, '科目が勘定科目で出る').toContainText('車両費')
    await expect(row, 'ℓが出る').toContainText('40.5')
    await expect(row, '内訳に燃料種別が出る').toContainText('レギュラー')
  })
})
