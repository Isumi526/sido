// ============================================================
//  liff.personal-expense-batch.spec.ts
//  個人経費: 複数領収書をまとめてAI解析 → 並列で一括登録
//   - 複数枚を添付すると「まとめて解析」になり、1枚=1件の下書きに展開される
//   - ★勝手に登録しない（人が確認して「まとめて登録」を押すまでDBに入らない）
//   - 1枚が解析に失敗しても他は止まらず、失敗した枚だけ理由つきで残る
//   - 入力不備（金額なし・接待交際費の同行者名なし）は登録前に止める
//   - まとめて登録すると枚数どおりの件数がDBに入り、二重計上しない
//   - 領収書が無いケースも従来どおり手入力で登録できる（領収書は必須ではない）
//  ※ analyze-receipt は page.route でスタブする（実AIを叩かない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

const TS = Date.now()

// ★ファイルごとに中身を変える。解析は並列に走るので「何番目のリクエストか」では
//   どのファイルの結果か決められない（呼び出し順が保証されない）。中身で引き当てる。
const tag = (name: string) => `RECEIPT-${name}`
const img = (name: string) => ({
  name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(tag(name), 'utf8'),
})

let accountId = ''
let workerId = ''

/**
 * ファイルの中身（RECEIPT-x）で結果を引き当てるスタブ。
 * 値が null の場合は 500 を返し続ける＝解析できなかった枚を再現する。
 *  ★useReceiptAnalysis は失敗すると2秒後に1回リトライするので、
 *    「呼び出し回数で切り替える」実装だとリトライが成功に化けてしまう。
 */
async function stubAnalyze(page: import('@playwright/test').Page, byFile: Record<string, any | null>) {
  await page.route('**/functions/v1/analyze-receipt', async (route) => {
    const body = route.request().postData() ?? ''
    const hit = Object.entries(byFile).find(([name]) =>
      body.includes(Buffer.from(tag(name), 'utf8').toString('base64')))
    const r = hit?.[1] ?? null
    if (r === null) { await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); return }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ storeName: null, label: null, yen: null, invoiceNumber: null, liters: null, account: null, ...r }),
    })
  })
}

/** 領収書のアップロードは対象外なので通す（ストレージを汚さない） */
async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, url: 'https://example.test/receipt.png' }),
    })
  })
}

test.describe('個人経費の複数領収書まとめ登録（liff）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const rows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    workerId = rows[0].id
    // 申請できる状態にする（許可＋枠）。枠が無いと入口ごと出ない
    await restSrv(`workers?id=eq.${workerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_apply_personal_expense: true, default_monthly_expense_limit: 100000 }),
    })
  })

  test.afterEach(async () => {
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`worker_expense_budgets?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test.afterAll(async () => {
    await restSrv(`workers?id=eq.${workerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_apply_personal_expense: false, default_monthly_expense_limit: null }),
    }).catch(() => {})
  })

  test('★複数枚は1枚=1件の下書きになり、押すまで登録されない', async ({ page }) => {
    await stubAnalyze(page, {
      a: { yen: 1200, storeName: `E2E店A_${TS}`, invoiceNumber: 'T1234567890123', label: '駐車場', account: '旅費交通費' },
      b: { yen: 3400, storeName: `E2E店B_${TS}`, invoiceNumber: null, label: '文具', account: '消耗品費' },
    })
    await stubUpload(page)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })

    await page.getByTestId('pe-files').setInputFiles([img('a'), img('b')])
    await page.getByTestId('pe-analyze-batch').click()

    await expect(page.getByTestId('pe-draft'), '1枚=1件').toHaveCount(2, { timeout: 30000 })
    await expect(page.getByTestId('pe-draft-amount').first()).toHaveValue('1200')
    await expect(page.getByTestId('pe-draft-payee').first()).toHaveValue(`E2E店A_${TS}`)

    // ★押すまではDBに入らない
    let rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=id`)
    expect(rows.length, '確認前は登録しない').toBe(0)

    await page.getByTestId('pe-submit-batch').click()
    await expect(page.getByTestId('pe-batch-msg')).toContainText('2件を登録しました', { timeout: 30000 })

    rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=amount,payee&order=amount.asc`)
    expect(rows.length, '枚数どおり登録される').toBe(2)
    expect(rows.map((r: any) => Number(r.amount))).toEqual([1200, 3400])
    await expect(page.getByTestId('pe-draft'), '登録できた分は下書きから消える').toHaveCount(0)
  })

  test('★1枚が解析に失敗しても他は止まらず、失敗した枚だけ理由つきで残る', async ({ page }) => {
    await stubAnalyze(page, {
      c: { yen: 500, storeName: `E2E店C_${TS}`, invoiceNumber: null, label: '', account: '旅費交通費' },
      d: null,   // この1枚だけ解析できない
    })
    await stubUpload(page)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })

    await page.getByTestId('pe-files').setInputFiles([img('c'), img('d')])
    await page.getByTestId('pe-analyze-batch').click()

    await expect(page.getByTestId('pe-draft')).toHaveCount(2, { timeout: 30000 })
    await expect(page.getByTestId('pe-draft-err'), '失敗した枚は理由が出る').toHaveCount(1)
    await expect(page.getByTestId('pe-ai-msg')).toContainText('要入力')

    // 金額が入っていない行があるので、登録前に止まる（黙って1件だけ入れたりしない）
    await page.getByTestId('pe-submit-batch').click()
    await expect(page.getByTestId('pe-batch-msg')).toContainText('入力の不足')
    let rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=id`)
    expect(rows.length, '不備がある間は1件も登録しない').toBe(0)

    // 手で埋めれば2件とも登録できる
    await page.getByTestId('pe-draft-amount').nth(1).fill('800')
    await page.getByTestId('pe-submit-batch').click()
    await expect(page.getByTestId('pe-batch-msg')).toContainText('2件を登録しました', { timeout: 30000 })
    rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=amount&order=amount.asc`)
    expect(rows.map((r: any) => Number(r.amount))).toEqual([500, 800])
  })

  test('接待交際費は同行者名が無いと一括登録できない（現場経費と同じ税務要件）', async ({ page }) => {
    await stubAnalyze(page, {
      e: { yen: 5000, storeName: `E2E居酒屋_${TS}`, invoiceNumber: null, label: '懇親', account: '接待交際費' },
      f: { yen: 700, storeName: `E2E店D_${TS}`, invoiceNumber: null, label: '', account: '旅費交通費' },
    })
    await stubUpload(page)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })

    await page.getByTestId('pe-files').setInputFiles([img('e'), img('f')])
    await page.getByTestId('pe-analyze-batch').click()
    await expect(page.getByTestId('pe-draft')).toHaveCount(2, { timeout: 30000 })

    await expect(page.getByTestId('pe-draft-companions'), '接待交際費の行にだけ出る').toHaveCount(1)
    await page.getByTestId('pe-submit-batch').click()
    await expect(page.getByTestId('pe-batch-msg')).toContainText('入力の不足')
    expect((await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=id`)).length).toBe(0)

    await page.getByTestId('pe-draft-companions').fill('E2E元請け 山田様')
    await page.getByTestId('pe-submit-batch').click()
    await expect(page.getByTestId('pe-batch-msg')).toContainText('2件を登録しました', { timeout: 30000 })
    const rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=companions,account_category&order=amount.desc`)
    expect(rows[0].companions).toBe('E2E元請け 山田様')
  })

  test('領収書が無くても手入力で登録できる（領収書は必須ではない）', async ({ page }) => {
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })

    // 最上部が領収書の入口で、領収書なしの案内が出ている
    await expect(page.getByTestId('pe-receipt-card')).toBeVisible()
    await expect(page.getByTestId('pe-no-receipt-hint')).toContainText('領収書が無い経費')

    await page.getByTestId('pe-amount').fill('460')
    await page.getByTestId('pe-payee').fill(`E2E交通系IC_${TS}`)
    await page.getByTestId('pe-submit').click()
    await expect(page.getByTestId('pe-msg')).toContainText('登録しました', { timeout: 30000 })

    const rows = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=amount,file_urls`)
    expect(rows.length).toBe(1)
    expect(Number(rows[0].amount)).toBe(460)
  })
})
