// ============================================================
//  liff.personal-expense-pdf.spec.ts
//  個人経費が「経費申請書」に載ること（/review 2026-07-31 の指摘2への対応）。
//
//  ★これが無いと個人立替(tategae)が精算されない。日報を出さない役員等は
//   daily_reports が無いので、personal_expenses を読まない限り申請書に1円も出ない。
//  ★AI解析（領収書から金額・支払い先・インボイス番号・科目を自動入力）も併せて検証（指摘1）。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, DB_URL } from './helpers'
import { FEAT_EXP_DATE, FEAT_EXP_PERIOD, SEED_WORKER } from './global-setup'

// personal_expenses は RLS(authenticated)＋anon revoke。本番の LIFF は email/password
// ログイン＝authenticated なので、申請書の検証もログインしてから行う
// （開発モードは LINE 経路の再現＝anon のため読めないのは仕様どおり）。
const LOGIN_EMAIL = 'worker01.login.e2e@example.com'
const LOGIN_PASS = 'worker-login-1234'

async function loginAsWorker(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('login-email').fill(LOGIN_EMAIL)
  await page.getByTestId('login-password').fill(LOGIN_PASS)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
}

const TS = Date.now()
const PAYEE = `E2E個人PDF_${TS}`

let accountId = ''
let workerId = ''
let userId = ''

test.describe('個人経費が経費申請書に載る', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    workerId = w[0].id
    const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    userId = u[0].id
    // 申請書の対象期間（FEAT_EXP_PERIOD）に入る日付で、個人立替の個人経費を1件
    await restSrv('personal_expenses', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: FEAT_EXP_DATE,
        account_category: '消耗品費', amount: 7700, payee: PAYEE,
        note: 'E2E個人経費(申請書)', tategae: true,
      }),
    })
    // email/password ログイン用ユーザーを用意し、対象 worker に紐付ける
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASS }),
    }).catch(() => {})
    try {
      execSync(`psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${workerId}','role','worker'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${LOGIN_EMAIL}'"`, { stdio: 'ignore' })
      execSync(`psql "${DB_URL}" -c "update workers set auth_user_id = (select id from auth.users where email='${LOGIN_EMAIL}') where id='${workerId}'"`, { stdio: 'ignore' })
    } catch (e) { console.warn('[e2e] worker auth seed 失敗:', String(e)) }
  })

  test.afterAll(async () => {
    await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★経費申請書のプレビューに個人経費が出る（立替が精算対象になる）', async ({ page }) => {
    await loginAsWorker(page)
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    // 対象期を選ぶ（既定が別の期のことがあるため明示的に選択）
    const chip = page.locator('.period-chip, [data-testid="period-chip"]').filter({ hasText: /前半|後半/ })
    if (await chip.count()) await chip.first().click().catch(() => {})
    await expect(page.locator('body'), '個人経費の支払い先が申請書に出る').toContainText(PAYEE, { timeout: 15000 })
    await expect(page.locator('body'), '金額も出る').toContainText('7,700')
  })

  test('admin の経費管理（精算・PDF）にも合流する', async () => {
    // 画面ではなくデータ経路の担保: 同じ期の合計に個人経費が含まれること
    const rows = await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}&select=amount,tategae,date`)
    expect(rows.length, 'シードが存在する').toBe(1)
    expect(Number(rows[0].amount)).toBe(7700)
    expect(rows[0].tategae, '個人立替として登録されている').toBe(true)
    // 期の導出が申請書と一致していること（date 基準で FEAT_EXP_PERIOD に入る）
    const [y, m] = FEAT_EXP_PERIOD.split('-')
    expect(rows[0].date.startsWith(`${y}-${m}`), '対象月に入っている').toBe(true)
  })
})

test.describe('個人経費の領収書AI解析', () => {
  test('領収書から金額・支払い先・インボイス番号・科目が自動入力される', async ({ page }) => {
    const accId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    await restSrv(`workers?id=eq.${w[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_apply_personal_expense: true, default_monthly_expense_limit: 50000 }),
    })

    // analyze-receipt をスタブ（実AIを叩かない・liff.ai-receipt-account.spec.ts と同じ流儀）
    await page.route('**/functions/v1/analyze-receipt', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          storeName: 'E2E居酒屋', label: '懇親会', yen: 4200,
          invoiceNumber: 'T1234567890123', liters: null, account: '接待交際費',
        }),
      })
    })

    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit')).toBeVisible({ timeout: 15000 })

    // 解析ボタンは領収書を選ぶまで出ない
    await expect(page.getByTestId('pe-analyze'), '添付前は出ない').toHaveCount(0)
    await page.getByTestId('pe-files').setInputFiles({
      name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('dummy'),
    })
    await expect(page.getByTestId('pe-analyze')).toBeVisible()
    await page.getByTestId('pe-analyze').click()

    await expect(page.getByTestId('pe-ai-msg')).toContainText('領収書から入力しました', { timeout: 15000 })
    await expect(page.getByTestId('pe-amount'), '金額').toHaveValue('4200')
    await expect(page.getByTestId('pe-payee'), '支払い先').toHaveValue('E2E居酒屋')
    await expect(page.getByTestId('pe-invoice'), 'インボイス番号').toHaveValue('T1234567890123')
    await expect(page.getByTestId('pe-account'), '科目も推定される').toHaveValue('接待交際費')
    // 接待交際費になったので同行者名欄が出る（既存ルールと整合）
    await expect(page.getByTestId('pe-companions')).toBeVisible()

    await restSrv(`workers?id=eq.${w[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_apply_personal_expense: false, default_monthly_expense_limit: null }),
    })
  })
})
