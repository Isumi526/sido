// マルチテナント「1デプロイで全テナント」実行時解決の回帰テスト。
//  env(NUXT_PUBLIC_ACCOUNT_SLUG)は 'test' 固定だが、別テナント(sample-construction)の LINE 作業員で
//  アクセスすると line_user_id → users.account_id で実行時にテナントが解決され、
//  env(test) ではなく所属テナント(sample-construction)が採用されることを検証する（AC2 の核）。
//  既存の test テナントは env と一致するため resolvedSlug==env＝回帰しない（下の回帰テストで担保）。
//  ※ dev モードの ?dev_line_uid= は development 限定の検証シーム（本番 LIFF 経路には影響しない）。
import { test, expect } from '@playwright/test'
import { restSrv, ACCOUNT_SLUG } from './helpers'

const OTHER_SLUG = ACCOUNT_SLUG === 'test' ? 'sample-construction' : 'test'
const LINE_UID = 'e2e-tenant-b-line-uid'

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

  // line_user_id 紐付きの users 行を upsert（line_user_id は全アカウント一意＝テナントキー）
  await restSrv('users?on_conflict=line_user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      line_user_id: LINE_UID, account_id: acc.id, worker_id: wid,
      real_name: 'E2E TenantB Worker', worker_role: 'site', is_approved: true,
    }),
  })
})

test('AC2: 別テナントのLINE作業員は env ではなく line_user_id で自テナントに実行時解決される', async ({ page }) => {
  await page.goto(`/?dev_line_uid=${LINE_UID}`)
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  // ブランド表示(.app-brand-name = resolvedSlug 由来) が env(test) ではなく自テナント(sample-construction)
  await expect(page.locator('.app-brand-name')).toHaveText(OTHER_SLUG.toUpperCase(), { timeout: 20000 })
})

test('回帰: 既定devユーザー(testテナント)は従来どおり env(test) に解決される', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.app-brand-name')).toHaveText(ACCOUNT_SLUG.toUpperCase(), { timeout: 20000 })
})
