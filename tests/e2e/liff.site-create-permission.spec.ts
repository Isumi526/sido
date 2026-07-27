// ============================================================
//  liff.site-create-permission.spec.ts
//  現場の新規作成を権限者(admin/office/site_manager)のみに制限する。
//   - 職人(permission_role='worker') には「＋ 新しい現場を登録する」の選択肢を出さない。
//   - 権限者(site_manager 以上)には従来どおり出す。
//  ※ UIを隠すだけでなく書き込み側(useMaster.saveSite / useExpense.registerNewSites)でも
//    弾いている（REST直叩き・古いバンドル・下書き復元で通り得るため）。
//  Notion: 38e0ff81c56b81c79001eb926c900cdd
// ============================================================
import { execSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, DB_URL, getAccountId, restSrv } from './helpers'

const ADD_NEW_SITE = '新しい現場を登録'
const WORKER_NAME = 'E2E職人(現場作成不可)'
const EMAIL = 'siteperm.worker.e2e@example.com'
const PASS  = 'siteperm-worker-1234'

// 現場名セレクト（「テスト現場A」を含む select）
const siteSelect = (page: any) =>
  page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // permission_role='worker' の専用作業員（冪等）
  let wid = (await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(WORKER_NAME)}&select=id`))?.[0]?.id
  if (!wid) {
    wid = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: WORKER_NAME, role: 'site', permission_role: 'worker', unit_price: 20000, active: true, sort_order: 998 }),
    }))?.[0]?.id
  } else {
    await restSrv(`workers?id=eq.${wid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: 'worker' }) })
  }
  if (!wid) throw new Error('E2E職人の作成に失敗')

  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch(() => {})
  execSync(
    `psql "${DB_URL}" -v ON_ERROR_STOP=1 ` +
    `-c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || ` +
    `jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${wid}','role','worker'), ` +
    `email_confirmed_at=coalesce(email_confirmed_at,now()) where email='${EMAIL}'" ` +
    `-c "update workers set auth_user_id=(select id from auth.users where email='${EMAIL}') where id='${wid}'"`,
    { stdio: 'ignore' },
  )
})

test('AC: 職人(worker)には「新しい現場を登録する」の選択肢が出ない', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill(PASS)
  await page.getByTestId('login-submit').click()
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })

  await page.goto('/report', { waitUntil: 'networkidle' })
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 15000 })

  const sel = siteSelect(page)
  await expect(sel).toBeVisible({ timeout: 15000 })
  // 既存現場は選べる（＝セレクト自体は機能している）
  const opts = await sel.locator('option').allTextContents()
  expect(opts.some(o => o.includes('テスト現場A')), '既存現場は選択できる').toBe(true)
  // ★ 新規作成の選択肢は出ない
  expect(opts.some(o => o.includes(ADD_NEW_SITE)), `職人に新規作成の選択肢が出てはいけない: ${JSON.stringify(opts)}`).toBe(false)
})

test('AC: 権限者(site_manager)には「新しい現場を登録する」の選択肢が出る', async ({ page }) => {
  // 既定の storageState は LINE devモード（dev-user-id = Worker 01 = site_manager）
  await page.goto('/report', { waitUntil: 'networkidle' })
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 15000 })

  const sel = siteSelect(page)
  await expect(sel).toBeVisible({ timeout: 15000 })
  const opts = await sel.locator('option').allTextContents()
  expect(opts.some(o => o.includes(ADD_NEW_SITE)), `権限者には新規作成の選択肢が出る: ${JSON.stringify(opts)}`).toBe(true)
})
