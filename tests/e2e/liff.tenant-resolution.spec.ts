// マルチテナント「1デプロイで全テナント」実行時解決の回帰テスト。
//  env(NUXT_PUBLIC_ACCOUNT_SLUG)は 'test' 固定だが、別テナント(sample-construction)の作業員でログインすると
//  ログインの会社（JWT の account_slug）でテナントが解決され、env(test) ではなく所属テナントが採用されることを検証する（AC2 の核）。
//  既存の test テナントは env と一致するため resolvedSlug==env＝回帰しない（下の回帰テストで担保）。
import { test, expect } from './liff-test'
import { restSrv, ACCOUNT_SLUG, loginLiffAs } from './helpers'

// ★2026-09-27（RLS第2段B）: 以前は LINE 経路（ログイン無し＋?dev_line_uid）で line_user_id → users から
//  テナントが決まることを見ていた。第2段Bで公開キーの読みを閉じたので LINE 経路は身元を引けない
//  （本番の作業員は全員メールログイン・LINE 経路の利用は直近30日で0）。今はログインの JWT（account_slug）で
//  テナントが決まることを見る。env は 'test' 固定のまま、別テナントの作業員でログインすると自テナントになること。
const OTHER_SLUG = ACCOUNT_SLUG === 'test' ? 'sample-construction' : 'test'
const LINE_UID = 'e2e-tenant-b-line-uid'
let otherWorkerId = ''

test.beforeAll(async () => {
  // 別テナント(sample-construction)の account を取得
  const accs = await restSrv(`accounts?slug=eq.${encodeURIComponent(OTHER_SLUG)}&select=id,slug`)
  const acc = accs?.[0]
  if (!acc) throw new Error(`account not found: ${OTHER_SLUG}`)

  // 作業員（無ければ作成・あれば再利用）
  let wid = (await restSrv(
    `workers?account_id=eq.${acc.id}&name=eq.${encodeURIComponent('E2E TenantB Worker')}&select=id`,
  ))?.[0]?.id
  if (!wid) {
    const w = await restSrv('workers', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: acc.id, name: 'E2E TenantB Worker', role: 'site', unit_price: 20000, active: true, sort_order: 999 }),
    })
    wid = w?.[0]?.id
  }

  otherWorkerId = wid
  // users 行（作業員アプリの身元解決が worker_id から引く）
  await restSrv('users?on_conflict=line_user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      line_user_id: LINE_UID, account_id: acc.id, worker_id: wid,
      real_name: 'E2E TenantB Worker', worker_role: 'site', is_approved: true,
    }),
  })
})

test('AC2: 別テナントの作業員でログインすると、env ではなくログインの会社（JWT）に解決される', async ({ page }) => {
  await loginLiffAs(page, otherWorkerId)
  await page.goto('/')
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  // ブランド表示(.app-brand-name = resolvedSlug 由来) が env(test) ではなく自テナント(sample-construction)
  await expect(page.locator('.app-brand-name')).toHaveText(OTHER_SLUG.toUpperCase(), { timeout: 20000 })
})

test('回帰: 既定のログイン（Worker 01・testテナント）は test に解決される', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.app-brand-name')).toHaveText(ACCOUNT_SLUG.toUpperCase(), { timeout: 20000 })
})
