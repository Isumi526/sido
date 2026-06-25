// ============================================================
//  admin.multitenant.spec.ts
//  マルチテナント：ログインユーザーの app_metadata.account_slug で
//  テナントが決まる（slugのビルド時固定にも、メールのlocal partにも依存しない）。
//   - ログインID(=メールlocal part)と account_slug をわざと別にして、
//     metadata が効いていることを証明する。
//   - 自テナント(tenant2)の現場だけ見え、既定ビルドslug(test)の現場は見えない（分離）。
//  ※ VITE_ACCOUNT_SLUG=test の admin ビルドでも、metadata を持つユーザーは
//     test ではなく自分のテナントに解決される。
//  認証ユーザーは local DB に直接作成（app_metadata を確実に付与するため）。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { rest, ADMIN_LOGIN_PASS } from './helpers'

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const TS    = Date.now()
const SLUG2 = `e2eslug${TS}`                 // テナントの slug（metadata に入れる）
const NAME2 = 'E2EテナントB'
const SITE2 = `E2EテナントB現場_${TS}`
const LOGIN = `e2elogin${TS}`                // ログインID（→ e2elogin...@email.com）。slug とは別物
const EMAIL = `${LOGIN}@email.com`

function runSql(sql: string) {
  const f = `/tmp/e2e-mt-${TS}-${Math.abs(sql.length)}.sql`
  writeFileSync(f, sql)
  try { execSync(`psql "${LOCAL_DB}" -v ON_ERROR_STOP=1 -f ${f}`, { stdio: 'pipe' }) }
  finally { try { unlinkSync(f) } catch { /* noop */ } }
}

let acc2 = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const a = await rest('accounts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: NAME2, slug: SLUG2 }) })
  acc2 = a[0].id
  await rest('sites', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: SITE2, account_id: acc2 }) })
  // app_metadata.account_slug を持つ認証ユーザーを local DB に直接作成
  runSql(`
    with nu as (
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        is_sso_user, is_anonymous
      ) values (
        gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated', '${EMAIL}',
        crypt('${ADMIN_LOGIN_PASS}', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"],"account_slug":"${SLUG2}"}'::jsonb, '{}'::jsonb,
        '','','','', false, false
      ) returning id
    )
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    select id::text, id,
      jsonb_build_object('sub', id::text, 'email', '${EMAIL}', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now() from nu;
  `)
})

test.afterAll(async () => {
  try { runSql(`delete from auth.users where email='${EMAIL}';`) } catch { /* noop */ }
  if (acc2) await rest(`sites?account_id=eq.${acc2}`, { method: 'DELETE' }).catch(() => {})
  await rest(`accounts?slug=eq.${SLUG2}`, { method: 'DELETE' }).catch(() => {})
})

test('app_metadata でテナント解決：ログインID≠slug でも自テナントに解決され分離される', async ({ page }) => {
  // 既定の e2e セッション(storageState)を破棄してログアウト状態にする
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/login')

  // login.vue の placeholder は「ID（@なし）または メール」。前方一致で陳腐化に強くする。
  await page.fill('input[placeholder^="ID"]', LOGIN)
  await page.fill('input[type="password"]', ADMIN_LOGIN_PASS)
  await page.click('button[type="submit"]')

  // ヘッダーは「GENLINKS(固定)＋会社名(account名)」。解決テナントの会社名NAME2がサブに出る
  // （旧: slug大文字をロゴ表示 → GENLINKS固定化＋会社名サブ表示に変更）
  await expect(page.locator('.logo')).toContainText('GENLINKS', { timeout: 15000 })
  await expect(page.locator('.logo')).toContainText(NAME2)

  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.locator('tr', { hasText: SITE2 })).toBeVisible()        // 自テナントの現場は見える
  await expect(page.locator('tr', { hasText: 'テスト現場1' })).toHaveCount(0) // 既定ビルドslug(test)の現場は見えない
})
