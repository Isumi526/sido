// ============================================================
//  admin.site-estimates-ownership.spec.ts
//  「現場管理者の所有権モデル」Step2-1: 見積書を「自分の現場なら見せる」に緩める
//  （2026-07-31 ユーザー方針・Q3確定・2026-09-08 実装）
//
//  Step1（admin.site-owner-rls.spec.ts）は sites テーブルの RLS＝「書けるか」を見た。
//  こちらは UI の出し分け＝「見えるか」を見る。判定は lib/features.ts の
//  canViewEstimatesForSite()（経営系ロール or 自分が責任者の現場）。
//
//  ★Q3 の原文は「他人の現場は金額・見積書を見せない」。所有軸モデルの中核は
//   その裏返しで「"自分の" 現場に限ってはオーナー同等にフル閲覧可」。
//   よって site_manager でも 自分の現場なら見積が見え／他人の現場では見えない、が正。
//
//  ★セットアップの組み立ては admin.site-owner-rls.spec.ts と同型（spec 間で import すると
//   相手の test まで登録されてしまうため、共有しているのは helpers の下位部品だけ）。
// ============================================================
import { test, expect } from '@playwright/test'
import {
  SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG,
  getAccountId, restSrv, authAdmin,
  enableEstimateFeature, restoreEstimateFeature,
} from './helpers'

const TS = Date.now()

// 見積もり機能は既定OFF（settings.estimate_feature_enabled）。フラグOFFだと
// canViewEstimatesForSite は誰に対しても false を返す＝ロールの検証にならないので、
// このspecの間だけONにして終わったら戻す（admin.site-manager-menu.spec.ts と同じ作法）。
test.beforeAll(enableEstimateFeature)
test.afterAll(restoreEstimateFeature)

type Fixture = {
  accountId: string
  authUserId: string
  workerId: string
  ownSiteId: string
  otherSiteId: string
  email: string
  password: string
}

async function makeFixture(): Promise<Fixture> {
  const accountId = await getAccountId()
  const email = `e2e-smest-${TS}@example.com`
  const password = 'e2e-smest-pass-1234'

  const res = await authAdmin('admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { account_slug: ACCOUNT_SLUG } }),
  })
  if (!res.ok) throw new Error(`auth user作成失敗: ${res.status} ${await res.text()}`)
  const { id: authUserId } = await res.json()

  const [worker] = await restSrv('workers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: `E2E見積所有_${TS}`, role: 'site',
      permission_role: 'site_manager', auth_user_id: authUserId, active: true,
    }),
  })

  // 自分が責任者の現場／責任者が他人（null＝未設定）の現場。Q4 のとおり未設定は
  // site_manager から見て「自分のではない」側に落ちる。
  const [ownSite] = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E見積_自分の現場_${TS}`, active: true, responsible_worker_id: worker.id }),
  })
  const [otherSite] = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E見積_他人の現場_${TS}`, active: true, responsible_worker_id: null }),
  })

  return { accountId, authUserId, workerId: worker.id, ownSiteId: ownSite.id, otherSiteId: otherSite.id, email, password }
}

async function cleanup(f: Fixture) {
  await restSrv(`sites?id=in.(${f.ownSiteId},${f.otherSiteId})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${f.workerId}`, { method: 'DELETE' }).catch(() => {})
  await authAdmin(`admin/users/${f.authUserId}`, { method: 'DELETE' }).catch(() => {})
}

async function loginAs(page: any, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('login-id').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
}

test.describe('現場管理者は「自分の現場」の見積書だけ見える', () => {
  // 作業員アカウントでログインするため、保存済みadmin認証は使わない
  test.use({ storageState: { cookies: [], origins: [] } })

  let f: Fixture
  test.beforeAll(async () => { f = await makeFixture() })
  test.afterAll(async () => { if (f) await cleanup(f) })

  test('★自分が責任者の現場では、現場詳細に「見積・注文」タブが出る', async ({ page }) => {
    await loginAs(page, f.email, f.password)
    await page.goto(`/sites/${f.ownSiteId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('tab-docs'), '自分の現場なら見積タブが出る').toBeVisible({ timeout: 15000 })
  })

  test('★他人（責任者未設定）の現場では、「見積・注文」タブが出ない', async ({ page }) => {
    await loginAs(page, f.email, f.password)
    await page.goto(`/sites/${f.otherSiteId}`, { waitUntil: 'networkidle' })
    // 画面自体は開ける（閲覧のみ）。タブだけが出ないこと＝取り違えないよう他タブの存在も確かめる
    await expect(page.getByTestId('tab-overview')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('tab-docs'), '他人の現場では見積タブを出さない').toHaveCount(0)
  })

  test('★現場マスタのモーダル: 自分の現場では見積書セクションが出て、他人の現場では出ない', async ({ page }) => {
    await loginAs(page, f.email, f.password)
    await page.goto('/sites', { waitUntil: 'networkidle' })

    // ★現場名リンクは /sites/:id へ遷移する。モーダルを開くのは行末の「編集」ボタン。
    //  ※Step2-3（他人の現場は閲覧のみ）が入ったら、他人の行では「編集」が出なくなる想定。
    //    その時はこのテストの後半を「編集ボタンが無い」に読み替える必要がある。
    const ownRow = page.locator('tr', { hasText: `E2E見積_自分の現場_${TS}` })
    await ownRow.getByRole('button', { name: '編集' }).click()
    await expect(page.getByTestId('site-estimates-field'), '自分の現場なら見積書セクションが出る').toBeVisible({ timeout: 15000 })

    // モーダルを閉じてから次を開く（開きっぱなしだと行がクリックできない）
    await page.reload({ waitUntil: 'networkidle' })
    const otherRow = page.locator('tr', { hasText: `E2E見積_他人の現場_${TS}` })
    await otherRow.getByRole('button', { name: '編集' }).click()
    // モーダル自体は開くこと（開かないと「出ない」の意味が変わる）を先に確かめる
    await expect(page.getByTestId('site-responsible-select')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('site-estimates-field'), '他人の現場では出さない').toHaveCount(0)
  })

  test('オーナー(admin)は従来どおり両方見える（緩めた側で壊していないこと）', async ({ page }) => {
    // 既定の admin storageState を使わず、明示的に admin でログインし直す
    const { ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS } = await import('./helpers')
    await loginAs(page, ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS)
    for (const id of [f.ownSiteId, f.otherSiteId]) {
      await page.goto(`/sites/${id}`, { waitUntil: 'networkidle' })
      await expect(page.getByTestId('tab-docs'), 'adminは責任者に関係なく見える').toBeVisible({ timeout: 15000 })
    }
  })
})
