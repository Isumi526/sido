// ============================================================
//  liff.expense-edit.spec.ts
//  経費申請書(申請前)のインライン編集: 支払い先/内容/登録番号 をその場で修正し、
//  daily_reports.sites JSON の元明細へ書き戻す。保存→DB反映→再読込後も保持。
//  ケース: 電車代(trains[0]・payee/label/registrationNumber を持つ編集可カテゴリ)の
//          支払い先を修正→保存→DBの sites[0].expenses.trains[0].payee が更新される。
//  ※ 未申請(FEAT_EXP_PERIOD=後半・締切未来)のみ編集可(canApply)。申請済みは読み取り専用。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, FEAT_EXP_DATE } from './global-setup'

const PERIOD_LABEL = (() => { const [, m] = FEAT_EXP_PERIOD.split('-'); return `${parseInt(m, 10)}月後半` })()
const TOKEN = `E2E経費編集_${Date.now()}`
const NEW_PAYEE = `修正支払先_${Date.now()}`

test.describe('経費申請書 インライン編集(申請前)', () => {
  let uid = ''

  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    const accountId = await getAccountId()
    // settlement を消して未申請に戻す（canApply=true＝編集可）
    await rest(`expense_settlements?user_id=eq.${uid}&period_key=eq.${FEAT_EXP_PERIOD}`, { method: 'DELETE' }).catch(() => {})
    // 電車代(payee/label/registrationNumber を持つ編集可カテゴリ)を含む日報を seed
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: FEAT_EXP_DATE, is_working: true, note: TOKEN,
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: { vehicles: [], others: [],
            trains: [{ label: '東京→品川', yen: 320, payee: '旧支払先', registrationNumber: 'T1234567890123', fileUrls: [] }] },
        }],
      }),
    })
  })

  test.afterEach(async () => {
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${FEAT_EXP_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('支払い先を修正→保存→daily_reports JSON へ書き戻り再読込後も保持', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    // 電車代の行を品名「交通費」(非編集セル=編集モードでも安定)で特定。編集前は支払先=旧支払先。
    const row = page.locator('.expense-table tbody tr', { hasText: '交通費' })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row).toContainText('旧支払先')  // 編集前の支払先表示

    // 編集モードON（申請前のみ表示される「修正する」）
    await page.getByRole('button', { name: '修正する' }).click()

    // 支払い先(1つ目のcell-edit入力)を修正
    const payeeInput = row.locator('input.cell-edit').first()
    await expect(payeeInput).toBeVisible()
    await payeeInput.fill(NEW_PAYEE)

    // 行の保存ボタン（dirtyで出現）
    await row.locator('.row-save-btn').click()
    await expect(page.locator('.edit-save-msg.ok')).toBeVisible({ timeout: 10000 })

    // ★DBへ書き戻ったか（sites[0].expenses.trains[0].payee）
    const [rep] = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${FEAT_EXP_DATE}&select=sites`)
    expect(rep.sites[0].expenses.trains[0].payee).toBe(NEW_PAYEE)
    // 登録番号・金額は保持（他フィールドを壊していない）
    expect(rep.sites[0].expenses.trains[0].registrationNumber).toBe('T1234567890123')
    expect(rep.sites[0].expenses.trains[0].yen).toBe(320)

    // 再読込後も新値が表示される
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)
    await expect(page.locator('.expense-table tbody tr', { hasText: NEW_PAYEE })).toContainText('交通費')
  })
})
