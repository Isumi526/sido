// ============================================================
//  liff.expense-payer-choice.spec.ts
//  経費の支払元を「個人で立替」「会社のカード」の二択で明示する。
//
//  ★経緯: これまで tategae(boolean) のチェックボックス1つで、
//   「未チェック＝会社払い」が暗黙の了解だった＝どちらの意味か分からない。
//
//  ★ユーザーの念押し「今までのデータの整合性が崩れないように」に対して、
//   **保存形式(tategae の true/false)は一切変えず、見せ方だけ二択にした**。
//   ここではその「保存形式が変わっていないこと」も併せて固定する
//   （列を増やす/意味を変えると16ファイルの消費箇所と過去データに波及するため）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const TS = Date.now()
const DATE = '2026-10-24'

let uid = ''
let accountId = ''

test.beforeAll(async () => {
  uid = (await getDevUserId())!
  accountId = await getAccountId()
})

test.afterEach(async () => {
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
})

/** その他経費を1件だけ持つ日報を作る（tategae を指定して既存データを再現する） */
async function seedReport(tategae: boolean) {
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: DATE, is_working: true, note: 'E2E支払元',
      sites: [{
        siteName: 'テスト現場B', workers: [], subcontractors: [],
        expenses: {
          vehicles: [], parkings: [], highways: [], trains: [], hotels: [], entertainments: [],
          others: [{ label: `E2E資材_${TS}`, yen: 2000, tategae, fileUrls: [] }],
        },
      }],
    }),
  })
}

/** seed した「その他」経費の明細カード（現場0の1件目）を返す */
async function otherExpenseCard(page: import('@playwright/test').Page) {
  const card = page.getByTestId('other-item-0-0')
  await expect(card, 'seedした経費の明細が復元される').toBeVisible({ timeout: 15000 })
  return card
}

async function savedTategae(): Promise<boolean> {
  const rows = await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}&select=sites`)
  return !!rows?.[0]?.sites?.[0]?.expenses?.others?.[0]?.tategae
}

test('AC1★: 支払元が二択で出る（チェック1つの暗黙表現をやめる）', async ({ page }) => {
  await seedReport(false)
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })

  const company = page.getByTestId('payer-company').first()
  const personal = page.getByTestId('payer-personal').first()
  await expect(company, '「会社のカード」の選択肢がある').toBeVisible({ timeout: 15000 })
  await expect(personal, '「個人で立替」の選択肢がある').toBeVisible()
  // ラジオ＝どちらか一方しか選べない（チェックボックスの「未チェック=会社払い」を脱する）
  await expect(company).toHaveAttribute('type', 'radio')
  await expect(personal).toHaveAttribute('type', 'radio')
})

test('AC2★: 既存の tategae=false は「会社のカード」として復元される', async ({ page }) => {
  await seedReport(false)
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })

  const card = await otherExpenseCard(page)
  await expect(card.getByTestId('payer-company'), 'false は会社払い').toBeChecked()
  await expect(card.getByTestId('payer-personal')).not.toBeChecked()
})

test('AC2★: 既存の tategae=true は「個人で立替」として復元される', async ({ page }) => {
  await seedReport(true)
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })

  const card = await otherExpenseCard(page)
  // ★ここが「過去データの意味が変わらない」の本体
  await expect(card.getByTestId('payer-personal'), 'true は個人立替').toBeChecked()
  await expect(card.getByTestId('payer-company')).not.toBeChecked()
})

test('AC3★: 選び直すと保存され、保存形式は tategae(boolean) のまま', async ({ page }) => {
  await seedReport(false)
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })

  const card = await otherExpenseCard(page)
  expect(await savedTategae(), '変更前は会社払い').toBe(false)

  await card.getByTestId('payer-personal').check()
  await page.getByTestId('edit-reason').fill(`E2E支払元変更_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()

  // ★編集は承認制なので daily_reports はまだ変わらない。保留の payload で確認する
  await expect.poll(async () => {
    const p = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}&select=payload`)
    return p?.[0]?.payload?.sites?.[0]?.expenses?.others?.[0]?.tategae ?? null
  }, { timeout: 20000 }).toBe(true)

  // 列を増やさずブール値のまま＝過去データ・16の消費箇所に波及しない
  const p = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}&select=payload`)
  const item = p[0].payload.sites[0].expenses.others[0]
  expect(typeof item.tategae, '保存形式は boolean のまま').toBe('boolean')
  expect(item.payer, '新しい列を増やしていない').toBeUndefined()

  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
})
