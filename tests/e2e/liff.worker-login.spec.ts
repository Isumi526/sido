// Phase 2a: LIFF の email/password ログイン → Supabaseセッション確立 → ホーム表示。
// 既存LINE経路は無改変（このテストはセッション経路のみ検証）。
// ※ 認証ユーザは GoTrue signup（ローカルで動作）で用意し、app_metadata(account_slug/worker_id/role)
//   と workers.auth_user_id を psql で付与（本番では edge worker-auth-setup が同じ状態を作る）。
import { execSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, DB_URL, getAccountId, restSrv } from './helpers'
import { SEED_WORKER } from './global-setup'

const EMAIL = 'worker01.login.e2e@example.com'
const PASS = 'worker-login-1234'

test.beforeAll(async () => {
  // 1) GoTrue signup で email/pw ユーザを作成（既存なら無視）
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch(() => {})

  // 2) 対象 worker（test account の SEED_WORKER）
  const accountId = await getAccountId()
  const w = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const workerId = w?.[0]?.id
  if (!workerId) throw new Error('seed worker not found')

  // 3) app_metadata（account_slug/worker_id/role）付与 ＋ workers.auth_user_id 紐付け（本番は edge が行う）
  try {
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${workerId}','role','worker'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${EMAIL}'"`,
      { stdio: 'ignore' },
    )
    execSync(
      `psql "${DB_URL}" -c "update workers set auth_user_id = (select id from auth.users where email='${EMAIL}') where id='${workerId}'"`,
      { stdio: 'ignore' },
    )
  } catch (e) { console.warn('[e2e] worker auth seed 失敗:', String(e)) }
})

test('AC: email/password で LIFF ログイン → ホームが表示される（LINE誘導なし）', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill(PASS)
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  // ★ worker解決導線: email/pwセッションでも「自分=作業員」が解決され、
  //   読み込み中で止まらない／registerに飛ばない（本番バグの回帰防止）
  // ホーム画面のユーザーカードは削除済み(2026-07-20)のため、ハンバーガードロワーの
  // 表示名で解決を確認する(同じ currentUser?.real_name を参照)。
  await page.locator('.app-hamburger').click()
  await expect(page.locator('.drawer-name')).toContainText(SEED_WORKER, { timeout: 20000 })
})

test('AC: users行が無い email/pw作業員もログインで users行が作成される（日報がuser_id付きで保存される前提）', async ({ page }) => {
  const accountId = await getAccountId()
  // 専用worker（無ければ作成・あれば再利用）→ users行を消して「users行なし」状態にする（冪等）
  let wid = (await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent('E2E NoUserWorker')}&select=id`))?.[0]?.id
  if (!wid) {
    const created = await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: 'E2E NoUserWorker', role: 'site', unit_price: 20000, active: true, sort_order: 999 }) })
    wid = created?.[0]?.id
  }
  // users行の DELETE は daily_reports.user_id の FK(ON DELETE制約なし)で失敗しうる。
  // restSrv の DELETE は .catch で握りつぶされ「消えたつもり」になり得るため、
  // 前回ローカル実行の残留行があっても本テストが非冪等にならないよう、
  // 参照行(daily_reports)を先に片付けてから users 行を消す（psqlで確実に実行・エラーは可視化）。
  try {
    execSync(
      `psql "${DB_URL}" -v ON_ERROR_STOP=1 -c "delete from daily_reports where user_id in (select id from users where worker_id='${wid}')" -c "delete from users where worker_id='${wid}'"`,
      { stdio: 'ignore' },
    )
  } catch (e) { console.warn('[e2e] E2E NoUserWorker の残留users行クリーンアップ失敗:', String(e)) }
  const email = 'nouser.worker.e2e@example.com'
  const pass = 'nouser-worker-1234'
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) }).catch(() => {})
  execSync(`psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${wid}','role','worker'), email_confirmed_at=coalesce(email_confirmed_at,now()) where email='${email}'"`, { stdio: 'ignore' })
  execSync(`psql "${DB_URL}" -c "update workers set auth_user_id=(select id from auth.users where email='${email}') where id='${wid}'"`, { stdio: 'ignore' })

  // 事前: users行なし
  const before = await restSrv(`users?worker_id=eq.${wid}&select=id`)
  expect(before?.length ?? 0).toBe(0)

  // ログイン → ホーム
  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(pass)
  await page.getByTestId('login-submit').click()
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })

  // 事後: users行が作成される（resolve()のinsertは非同期＝pollで待つ）。
  // account/worker が一致＝日報が user_id 付きで正しく保存できる。
  await expect.poll(
    async () => (await restSrv(`users?worker_id=eq.${wid}&select=id`))?.[0]?.id ?? null,
    { timeout: 15000 },
  ).toBeTruthy()
  const after = await restSrv(`users?worker_id=eq.${wid}&select=id,account_id,worker_id`)
  expect(after[0].account_id).toBe(accountId)
  expect(after[0].worker_id).toBe(wid)
})

test('クエリパラメータでID/PASSが揃っていれば自動ログインしてホームへ（デモURL用）', async ({ page }) => {
  await page.goto(`/login?email=${encodeURIComponent(EMAIL)}&pass=${PASS}`)
  // 事前入力＋自動ログイン → ホームへ着地（別作業員でログイン中でも submit が切替）
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
})

// ── 回帰: クロステナント（JWTのworker_id claimが別テナントのworkers行を指す）──
//  useCurrentUser の email/pw 分岐が workers を account_id でスコープせず id だけで引いていたため、
//  他テナントの worker が解決され、その account_id で users 行が作られていた。結果 daily_reports が
//  「account_id=現テナント / user_id=別テナントのuser」というねじれた状態で保存される
//  （2026-06〜07 に本番で実害2件＝シードの日報がdemo/hiromokkouのuserを指していた）。
//  修正後は「このテナントの作業員ではない」＝解決不能(null)が正しい挙動。
test('AC: JWTのworker_idが別テナントのworkerを指す場合、解決されず users 行も作られない', async ({ page }) => {
  const accountId = await getAccountId()
  const OTHER_SLUG = 'e2e-other-tenant'
  const email = 'crosstenant.worker.e2e@example.com'
  const pass  = 'crosstenant-1234'

  // 別テナント（account）とその worker を用意（冪等）
  execSync(
    `psql "${DB_URL}" -v ON_ERROR_STOP=1 ` +
    `-c "insert into accounts (name, slug) values ('E2E別テナント','${OTHER_SLUG}') on conflict (slug) do nothing" ` +
    `-c "insert into workers (account_id, name, role, unit_price, active, sort_order) ` +
    `select id, 'E2E別テナント作業員', 'site', 20000, true, 999 from accounts where slug='${OTHER_SLUG}' ` +
    `and not exists (select 1 from workers w2 join accounts a2 on a2.id=w2.account_id ` +
    `where a2.slug='${OTHER_SLUG}' and w2.name='E2E別テナント作業員')"`,
    { stdio: 'ignore' },
  )
  const otherWorkerId = execSync(
    `psql "${DB_URL}" -At -c "select w.id from workers w join accounts a on a.id=w.account_id ` +
    `where a.slug='${OTHER_SLUG}' and w.name='E2E別テナント作業員' limit 1"`,
  ).toString().trim()
  expect(otherWorkerId, '別テナントのworkerが用意できていること').toBeTruthy()

  // ★ ねじれの再現: account_slug は「今のテナント」、worker_id は「別テナントのworker」
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  }).catch(() => {})
  execSync(
    `psql "${DB_URL}" -v ON_ERROR_STOP=1 ` +
    `-c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || ` +
    `jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${otherWorkerId}','role','worker'), ` +
    `email_confirmed_at=coalesce(email_confirmed_at,now()) where email='${email}'" ` +
    `-c "delete from users where worker_id='${otherWorkerId}'"`,
    { stdio: 'ignore' },
  )

  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(pass)
  await page.getByTestId('login-submit').click()
  await page.waitForTimeout(6000)   // resolve() が走り切るのを待つ（作られるなら作られている頃）

  // ★ 別テナントのworkerに対する users 行が作られていないこと（修正前はここで1行できていた）
  const leaked = await restSrv(`users?worker_id=eq.${otherWorkerId}&select=id,account_id`)
  expect(leaked?.length ?? 0, `別テナントworkerのusers行が作られてはいけない: ${JSON.stringify(leaked)}`).toBe(0)

  // 現テナント側にも、この worker を名乗る行は無い
  const inCurrent = await restSrv(`users?account_id=eq.${accountId}&worker_id=eq.${otherWorkerId}&select=id`)
  expect(inCurrent?.length ?? 0).toBe(0)
})

test('誤ったパスワードはログイン失敗を表示する', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill('wrong-password')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 15000 })
})
