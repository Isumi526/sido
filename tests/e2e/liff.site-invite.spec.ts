// ============================================================
//  liff.site-invite.spec.ts
//  現場管理者(責任者)は現場設定画面から現場へユーザーを招待(site_shares追加)できる。
//  責任者でないユーザーには招待UIが出ないことも合わせて検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { rest, restSrv, getAccountId, grantSiteShare, SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, DB_URL } from './helpers'

// 共有の付与/解除は site_shares への書き込み。anon からの書き込みは塞いだ（P0・権限ロック）ので、
// 本番と同じ email/password ログイン（＝authenticated）でUIを操作する。
// LIFF の開発モードは LINE 経路の再現＝anon なので、そのままでは書き込めない（仕様どおり）。
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
const SITE_MANAGED = `E2E招待検証現場(責任者)_${TS}`
const SITE_OTHER = `E2E招待検証現場(責任者でない)_${TS}`
const CANDIDATE_NAME = `E2E招待候補_${TS}`
let managedSiteId = ''
let otherSiteId = ''
let myWorkerId = ''
let candidateUserId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  myWorkerId = users[0].worker_id

  // email/password ログイン用ユーザーを用意し、自分(myWorkerId)に紐付ける（本番は edge が行う）
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASS }),
  }).catch(() => {})
  try {
    execSync(`psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${myWorkerId}','role','worker'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${LOGIN_EMAIL}'"`, { stdio: 'ignore' })
    execSync(`psql "${DB_URL}" -c "update workers set auth_user_id = (select id from auth.users where email='${LOGIN_EMAIL}') where id='${myWorkerId}'"`, { stdio: 'ignore' })
  } catch (e) { console.warn('[e2e] site-invite worker auth seed 失敗:', String(e)) }

  managedSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_MANAGED, active: true, responsible_worker_id: myWorkerId,
  }) }))[0].id
  // 招待候補となるユーザー(このaccountの他ユーザー)。この候補workerをotherSiteの責任者にする
  // ことで「自分は責任者でない現場」を作る(自分がresponsible_worker_idに一致しない状態)。
  const candidateWorker = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CANDIDATE_NAME, role: 'site', active: true,
  }) }))[0]
  candidateUserId = (await rest('users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, worker_id: candidateWorker.id, real_name: CANDIDATE_NAME, is_approved: true,
  }) }))[0].id
  otherSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OTHER, active: true, responsible_worker_id: candidateWorker.id,
  }) }))[0].id
  // 自分は責任者ではないが、閲覧はできるようsite_sharesで共有登録(招待UIが出ないことの検証用)
  await grantSiteShare(otherSiteId)
})
test.afterAll(async () => {
  await restSrv(`site_shares?site_id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_shares?site_id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`users?id=eq.${candidateUserId}`, { method: 'DELETE' }).catch(() => {})
  const candidateWorker = await rest(`workers?name=eq.${encodeURIComponent(CANDIDATE_NAME)}&select=id`)
  if (candidateWorker?.[0]?.id) await restSrv(`workers?id=eq.${candidateWorker[0].id}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場責任者には招待UIが表示され、ユーザーを選ぶとsite_sharesに追加される', async ({ page }) => {
  await loginAsWorker(page)   // 書き込みを伴うので authenticated で操作する
  await page.goto(`/sites/${managedSiteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="site-invite-block"]')).toBeVisible({ timeout: 10000 })

  await page.locator('.invite-toggle-btn').click()
  const row = page.locator('[data-testid="site-invite-row"]', { hasText: CANDIDATE_NAME })
  await expect(row).toBeVisible({ timeout: 10000 })
  // LINE風UI(2026-07-20〜): ネイティブcheckboxは視覚的に隠し、右の丸インジケータをクリックで
  // トグルする(labelで包まれているためインジケータクリックでも下のinputが連動する)。
  const checkbox = row.locator('input[type="checkbox"]')
  await row.locator('.invite-indicator').click()
  await expect(checkbox).toBeChecked()

  await expect.poll(async () => {
    const rows = await restSrv(`site_shares?site_id=eq.${managedSiteId}&user_id=eq.${candidateUserId}&select=id`)
    return rows.length
  }, { timeout: 10000 }).toBe(1)

  // チェックを外すとsite_sharesから削除される
  await row.locator('.invite-indicator').click()
  await expect(checkbox).not.toBeChecked()
  await expect.poll(async () => {
    const rows = await restSrv(`site_shares?site_id=eq.${managedSiteId}&user_id=eq.${candidateUserId}&select=id`)
    return rows.length
  }, { timeout: 10000 }).toBe(0)
})

test('現場責任者でない現場では招待UIの代わりに読み取り専用メンバー一覧が表示される(2026-07-20)', async ({ page }) => {
  await page.goto(`/sites/${otherSiteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.app-title')).toContainText(SITE_OTHER, { timeout: 10000 })
  await expect(page.locator('[data-testid="site-invite-block"]')).toHaveCount(0)

  const readonly = page.locator('[data-testid="site-members-readonly"]')
  await expect(readonly).toBeVisible({ timeout: 10000 })
  await readonly.locator('.invite-toggle-btn').click()
  await expect(readonly.locator('.invite-row-readonly')).toHaveCount(1)
  // 読み取り専用: チェックボックス(招待/解除操作)は無い
  await expect(readonly.locator('input[type="checkbox"]')).toHaveCount(0)
})

test('現場チャットのヘッダータイトルに現場名(メンバー数)が表示され、現場アイコンタップで現場設定画面へ遷移できる(2026-07-20 IA刷新)', async ({ page }) => {
  await page.goto(`/site-chat/${managedSiteId}`, { waitUntil: 'networkidle' })
  // 現時点の責任者(自分)のみ共有登録は無いが、責任者自身がmembersに入るため(1)表示
  await expect(page.locator('.app-title')).toContainText(`${SITE_MANAGED}(1)`, { timeout: 10000 })

  await page.locator('[data-testid="site-icon-link"]').click()
  await expect(page).toHaveURL(new RegExp(`/sites/${managedSiteId}\\?from=chat$`), { timeout: 10000 })
  // チャット経由の遷移では現場一覧/チャットへの導線は冗長なので非表示になる
  await expect(page.locator('.back-link')).toHaveCount(0)
  await expect(page.locator('[data-testid="site-chat-link"]')).toHaveCount(0)
})
