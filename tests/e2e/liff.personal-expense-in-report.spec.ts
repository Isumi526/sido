// ============================================================
//  liff.personal-expense-in-report.spec.ts
//  日報から個人経費（現場に紐づかない経費）を出せるようにする（2026-09-04 運用者GO）。
//  出所（2026-08 議事録）:
//   「ゆくゆくはこの日報送信の中に組み込みたい」
//   「個人経費枠が与えられているユーザーに関しては…個人経費の申請も一括できるかな」
//
//  ★このspecが守るもの
//   - 枠を持たない人には出さない（入口を開けない）
//   - 枠を持つ人には出て、日報送信で personal_expenses に登録される
//   - 既存の個人経費ページ／月額枠と同じデータに入る（別テーブルを作らない）
//   - 月末の日付範囲バグの再発防止（9月など30日の月で明細が消えない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, todayJST, useDevWorker, ensureDevWorker, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const PAYEE = `E2E個人経費_${TS}`
// ★この spec 専用の作業員で動く（useDevWorker と同じキー）。枠の付け外しを
//  他の作業員・他specに波及させないため、共有の dev-user-id は触らない。
const WORKER_KEY = 'pe-in-report'
const DEV_LINE_UID = `dev-user-${WORKER_KEY}`

let workerId = ''

async function setBudget(canApply: boolean, limit: number | null) {
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ can_apply_personal_expense: canApply, default_monthly_expense_limit: limit }),
  })
}

test.beforeAll(async () => {
  const w = await ensureDevWorker(WORKER_KEY)
  workerId = w.workerId
})

test.afterAll(async () => {
  await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  await setBudget(false, null).catch(() => {})   // 専用作業員なので既定（枠なし）へ戻す
})

test('★枠を持たない作業員には、日報に個人経費セクションを出さない', async ({ page }) => {
  await setBudget(false, null)
  await useDevWorker(page, 'pe-in-report')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })
  await page.waitForTimeout(1200)   // 枠の取得（EF）を待つ
  await expect(page.getByTestId('pe-section'), '★枠が無い人には入口を開けない').toHaveCount(0)
})

test('★枠を持つ作業員は、日報から個人経費を出せて既存の枠に反映される', async ({ page }) => {
  await setBudget(true, 50000)
  await useDevWorker(page, 'pe-in-report')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  const section = page.getByTestId('pe-section')
  await expect(section, '★枠を持つ人には出る').toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('pe-budget'), '月額枠の使用状況が出る').toContainText('50,000')

  await page.getByTestId('pe-add-row').click()
  await page.getByTestId('pe-amount-0').fill('3200')
  await page.getByTestId('pe-payee-0').fill(PAYEE)
  await page.getByTestId('pe-account-0').selectOption('車両費')
  await page.waitForTimeout(300)

  // 稼働なしでも個人経費だけ出せる（休みの日の経費を締め出さない）
  const workSel = page.locator('select').filter({ has: page.locator('option', { hasText: '稼働なし' }) }).first()
  await workSel.selectOption('off')
  await page.waitForTimeout(400)
  await expect(section, '★稼働なしの日でも個人経費は出せる').toBeVisible()

  await page.locator('[data-testid="omission-confirm"]').check().catch(() => {})
  await page.locator('[data-testid="report-submit"]').click()
  await expect(page.locator('.state-title'), '日報が送信できる').toBeVisible({ timeout: 20000 })

  // ★既存の personal_expenses に入る（別テーブルを作らない＝既存ページ・枠・PDFがそのまま効く）
  await expect.poll(async () => {
    const rows = await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}&select=amount,account_category,tategae`)
    return rows?.length ?? 0
  }, { timeout: 15000 }).toBe(1)

  const [saved] = await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}&select=amount,account_category`)
  expect(Number(saved.amount)).toBe(3200)
  expect(saved.account_category).toBe('車両費')
})

test('★30日の月でも個人経費の明細と枠が消えない（月末の日付範囲バグの再発防止）', async () => {
  // 以前は `${month}-31` で上限を指定していたため、4/6/9/11月と2月は
  // 存在しない日付になりクエリが落ちて「0件・使用額¥0」に見えていた。
  // 枠が¥0に見えると上限チェックが素通りするため、金額に効く不具合だった。
  await setBudget(true, 50000)
  const accountId = await getAccountId()
  const target = `${todayJST().slice(0, 4)}-09-15`   // 9月＝30日の月
  await restSrv('personal_expenses', {
    method: 'POST',
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: target,
      account_category: '車両費', amount: 1500, payee: PAYEE, tategae: true,
    }),
  })

  const res = await fetch(`${SUPABASE_URL}/functions/v1/personal-expense-submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: 'state', month: target.slice(0, 7), dev_line_user_id: DEV_LINE_UID }),
  })
  const json = await res.json()
  expect(json.ok, '★30日の月でもエラーにならない').toBe(true)
  expect(json.items.length, '★30日の月でも明細が返る（0件に化けない）').toBeGreaterThan(0)
})
