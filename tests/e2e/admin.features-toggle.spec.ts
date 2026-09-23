// ============================================================
//  admin.features-toggle.spec.ts
//  「使う機能」（settings.feature.* ・2026-09-19 B-0）
//   - 未設定＝車両・道具は ON（既定）。設定で OFF にするとメニューから消え、URL直打ちも / へ戻される
//   - 設定画面の「使う機能」で ON/OFF でき、settings と operation_logs に残る
//   - 道具管理 OFF のテナントは EF(tools) が 403 feature_disabled を返す（QR直リンク対策）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

let accountId = ''
async function setFeature(settingKey: string, value: boolean | null) {
  if (value === null) { await restSrv(`settings?account_id=eq.${accountId}&key=eq.${encodeURIComponent(settingKey)}`, { method: 'DELETE' }).catch(() => {}); return }
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: settingKey, value: String(value), label: 'E2E' }),
  })
}
async function getFeature(settingKey: string): Promise<string | null> {
  const r = await restSrv(`settings?account_id=eq.${accountId}&key=eq.${encodeURIComponent(settingKey)}&select=value`)
  return r?.[0]?.value ?? null
}

test.describe('使う機能（テナント単位の ON/OFF）', () => {
  test.beforeAll(async () => { accountId = await getAccountId() })
  test.afterAll(async () => {
    await setFeature('feature.vehicles', null)
    await setFeature('feature.tools', null)
  })

  test('未設定＝車両・道具メニューは出る（既定ON）', async ({ page }) => {
    await setFeature('feature.vehicles', null); await setFeature('feature.tools', null)
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list a[href="/vehicles"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.nav-list a[href="/tools"]')).toBeVisible()
  })

  test('★OFF にするとメニューから消え、URL直打ちも / へ戻される', async ({ page }) => {
    await setFeature('feature.vehicles', false); await setFeature('feature.tools', false)
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.nav-list a[href="/vehicles"]')).toHaveCount(0)
    await expect(page.locator('.nav-list a[href="/tools"]')).toHaveCount(0)
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/tools', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/$/)
  })

  test('設定画面の「使う機能」で切り替えられ、settings と操作ログに残る', async ({ page }) => {
    await setFeature('feature.vehicles', false)
    await restSrv(`operation_logs?target_type=eq.settings&summary=eq.feature.vehicles`, { method: 'DELETE' }).catch(() => {})
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const box = page.getByTestId('features-box')
    await expect(box).toBeVisible({ timeout: 15000 })
    await expect(box.getByTestId('feature-row-estimate')).toBeVisible()
    await expect(box.getByTestId('feature-row-rooms')).toBeVisible()
    const toggle = box.getByTestId('toggle-feature-vehicles')
    await expect(toggle).toContainText('OFF')
    await toggle.click()
    await expect(toggle).toContainText('ON')
    await expect.poll(() => getFeature('feature.vehicles'), { timeout: 15000 }).toBe('true')
    // 同じ画面のメニューにも即反映
    await expect(page.locator('.nav-list a[href="/vehicles"]')).toBeVisible()
    await expect.poll(async () => (await restSrv(`operation_logs?target_type=eq.settings&summary=eq.feature.vehicles&select=action`))?.length ?? 0, { timeout: 15000 }).toBeGreaterThan(0)
  })

  test('★在庫管理はベータ（既定OFF）: 行を消すとメニューに出ず URL直打ちも / へ、ONで戻る', async ({ page }) => {
    // 在庫①〜④（2026-09-19 レビュー決定）: ③④が揃うまで SEED 以外に見せない。global-setup は E2E のためにONにしている
    await setFeature('feature.inventory', null)
    try {
      await page.goto('/', { waitUntil: 'networkidle' })
      await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('.nav-list a[href="/inventory"]')).toHaveCount(0)
      await page.goto('/inventory', { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/\/$/)
    } finally {
      await setFeature('feature.inventory', true)   // ★必ず戻す（admin.inventory / liff.inventory* が落ちる）
    }
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list a[href="/inventory"]')).toBeVisible({ timeout: 15000 })
  })

  test('★見積Excel連携は個別対応（既定OFF・E-1）: 行を消すと見積ONでもメニューに出ず URL直打ちも / へ、ONで戻る', async ({ page }) => {
    await setFeature('estimate_excel_enabled', null)
    try {
      await page.goto('/', { waitUntil: 'networkidle' })
      await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('.nav-list a[href="/estimate-masters"]'), '標準の見積メニューは出たまま').toBeVisible()
      await expect(page.locator('.nav-list a[href="/estimate-excel"]')).toHaveCount(0)
      await page.goto('/estimate-excel', { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/\/$/)
    } finally {
      await setFeature('estimate_excel_enabled', true)   // ★必ず戻す（admin.estimate-excel* が落ちる）
    }
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list a[href="/estimate-excel"]')).toBeVisible({ timeout: 15000 })
  })

  test('道具管理 OFF のテナントは EF(tools) が 403 を返す', async () => {
    await setFeature('feature.tools', false)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tools`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bases', dev_line_user_id: 'dev-user-id' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('feature_disabled')
    await setFeature('feature.tools', null)
    const ok = await fetch(`${SUPABASE_URL}/functions/v1/tools`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bases', dev_line_user_id: 'dev-user-id' }),
    })
    expect(ok.status).toBe(200)
  })
})
