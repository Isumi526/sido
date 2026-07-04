// ============================================================
//  liff.expense-payee-fallback.spec.ts
//  支払い先(payee)は2026-07-03追加の新カラム。それ以前/未入力の既存データは payee 空で
//  会社名が 内容(label) 側にだけ入り、経費PDF/adminの支払先列が空白になっていた（ズレ/空白）。
//  対策: payee空 かつ vendor系カテゴリ(その他/雑経費/宿泊/電車)は 内容→支払先に昇格して表示。
//  検証: payee空・label=会社名 の「その他」明細が、経費申請書の支払先列に会社名で出る（空白でない）。
//        高速代(note=ETCカード)は昇格しない＝支払先は空・内容にETCカードが残る（誤昇格しない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, FEAT_EXP_DATE } from './global-setup'

const PERIOD_LABEL = (() => { const [, m] = FEAT_EXP_PERIOD.split('-'); return `${parseInt(m, 10)}月後半` })()
const TS = Date.now()
const TOKEN = `E2E支払先FB_${TS}`
const VENDOR = `FB商店_${TS}`

test.describe('経費 支払先フォールバック(payee空→内容昇格)', () => {
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
            vehicles: [], trains: [],
            others: [{ label: VENDOR, yen: 1234 }],        // payee無し＝昇格対象（内容→支払先）
            highways: [{ etcCard: 'カード⑨', yen: 2000 }], // note=ETCカード＝昇格しない
          },
        }],
      }),
    })
  })

  test.afterAll(async () => {
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${FEAT_EXP_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('その他(payee空)は会社名が支払先に昇格・高速代(ETCカード)は昇格しない', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    // 列順: 1=日付 2=支払先(payee) 3=内容(note) 4=登録番号 ...
    // その他の行: 支払先(2列目)=会社名 / 内容(3列目)は空（昇格して重複させない）
    const otherRow = page.locator('.expense-table tbody tr', { hasText: 'その他' }).first()
    await expect(otherRow).toBeVisible({ timeout: 10000 })
    await expect(otherRow.locator('td:nth-child(2)')).toContainText(VENDOR)
    await expect(otherRow.locator('td:nth-child(3)')).not.toContainText(VENDOR)

    // 高速代の行: ETCカードは内容(3列目)に残り、支払先(2列目)には昇格しない（誤昇格防止）
    const hwRow = page.locator('.expense-table tbody tr', { hasText: '高速代' }).first()
    await expect(hwRow).toBeVisible()
    await expect(hwRow.locator('td:nth-child(3)')).toContainText('カード⑨')
    await expect(hwRow.locator('td:nth-child(2)')).not.toContainText('カード⑨')
  })
})
