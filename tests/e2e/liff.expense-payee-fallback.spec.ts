// ============================================================
//  liff.expense-payee-fallback.spec.ts
//  経費申請書を客先フォーマットに統一(内容列廃止/使用車追加/品名マッピング)＋支払先フォールバック。
//  列: 日付 / 支払先 / 登録番号 / 品名 / ℓ / 現場名 / 使用車 / 金額
//  検証:
//   - その他(payee空・label=会社名) → 支払先に会社名が昇格(fallback)。品名=「その他」。
//   - 電車代 → 品名=「交通費」(マッピング)。
//   - 駐車代(現場に車両CX8) → 品名=「P代」・使用車=CX8。
//   - 高速代(payee空・ETCカードのみ) → 支払先には昇格しない(誤昇格防止)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, FEAT_EXP_DATE } from './global-setup'

const PERIOD_LABEL = (() => { const [, m] = FEAT_EXP_PERIOD.split('-'); return `${parseInt(m, 10)}月後半` })()
const TS = Date.now()
const TOKEN = `E2E経費統一_${TS}`
const VENDOR = `FB商店_${TS}`

// 列: 1日付 2支払先 3登録番号 4品名 5ℓ 6現場名 7使用車 8金額
const C_PAYEE = 'td:nth-child(2)'
const C_CAT = 'td:nth-child(4)'
const C_VEHICLE = 'td:nth-child(7)'

test.describe('経費 統一フォーマット(内容廃止/使用車/品名/支払先fallback)', () => {
  let uid = ''

  test.beforeAll(async () => {
    uid = (await getDevUserId())!
    const accountId = await getAccountId()
    await rest(`expense_settlements?user_id=eq.${uid}&period_key=eq.${FEAT_EXP_PERIOD}`, { method: 'DELETE' }).catch(() => {})
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: FEAT_EXP_DATE, is_working: true, note: TOKEN,
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: {
            vehicles: [{ vehicleName: 'CX8' }],                 // 現場の使用車
            others: [{ label: VENDOR, yen: 1234 }],             // payee無し＝支払先に昇格
            trains: [{ label: '東京→品川', yen: 320, payee: 'JR東海' }], // 品名→交通費
            parkings: [{ yen: 500, payee: 'タイムズ' }],         // 品名→P代・使用車=CX8
            highways: [{ etcCard: 'カード⑨', yen: 2000 }],       // payee空・ETC＝支払先に昇格しない
          },
        }],
      }),
    })
  })

  test.afterAll(async () => {
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${FEAT_EXP_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('内容廃止・支払先fallback・品名マッピング・使用車が客先フォーマットで出る', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    // 内容列が無い（ヘッダに「内　容」が無い）
    await expect(page.locator('.expense-table thead')).not.toContainText('内　容')
    await expect(page.locator('.expense-table thead')).toContainText('使用車')

    // その他: 支払先に会社名が昇格・品名=その他
    const otherRow = page.locator('.expense-table tbody tr', { hasText: 'その他' }).first()
    await expect(otherRow).toBeVisible({ timeout: 10000 })
    await expect(otherRow.locator(C_PAYEE)).toContainText(VENDOR)

    // 電車代 → 品名=交通費
    const trainRow = page.locator('.expense-table tbody tr', { hasText: 'JR東海' }).first()
    await expect(trainRow.locator(C_CAT)).toHaveText('交通費')

    // 駐車代 → 品名=P代・使用車=CX8
    const pkRow = page.locator('.expense-table tbody tr', { hasText: 'タイムズ' }).first()
    await expect(pkRow.locator(C_CAT)).toHaveText('P代')
    await expect(pkRow.locator(C_VEHICLE)).toHaveText('CX8')

    // 高速代(ETCカード) → 支払先には昇格しない
    const hwRow = page.locator('.expense-table tbody tr', { hasText: '高速代' }).first()
    await expect(hwRow.locator(C_PAYEE)).not.toContainText('カード⑨')
  })
})
