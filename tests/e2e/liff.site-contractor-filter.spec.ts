// ============================================================
//  liff.site-contractor-filter.spec.ts （dev モード）
//  日報で元請けを選ぶと、その元請けに紐づく現場だけに現場プルダウンが絞り込まれる。
//   - AC2: 元請け選択→紐づく現場のみ
//   - AC3: 紐づく現場が無い/元請け未選択は全現場（後方互換）
//  紐付き現場と未紐付き現場を1つずつシードして検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const CON   = `E2E元請_${TS}`
const LINKED = `E2E紐付現場_${TS}`
const FREE   = `E2E無紐付現場_${TS}`

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const c = await rest('contractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: CON, active: true, sort_order: 0 }),
  })
  const contractorId = c[0].id
  await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: LINKED, active: true, contractor_id: contractorId }),
  })
  await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: FREE, active: true, contractor_id: null }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=like.E2E*${TS}`, { method: 'DELETE' }).catch(() => {})
  await rest(`contractors?name=eq.${encodeURIComponent(CON)}`, { method: 'DELETE' }).catch(() => {})
})

test('日報: 元請け選択で紐づく現場のみに絞り込まれる', async ({ page }) => {
  // 古いマスタキャッシュを消してからフォームを開く（force fetch される）
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  await page.evaluate(() => localStorage.removeItem('app_master_cache'))
  await page.reload({ waitUntil: 'networkidle' })

  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場セレクト（__other__「新しい現場」optionを持つのが現場select＝安定特定・絞り込み後も不変）
  const siteSelect = page.locator('select.select[required]').filter({ has: page.locator('option[value="__other__"]') }).first()
  await expect(siteSelect).toBeVisible()
  await expect(siteSelect.locator('option', { hasText: LINKED })).toHaveCount(1)
  await expect(siteSelect.locator('option', { hasText: FREE })).toHaveCount(1)

  // 元請けを選択 → 紐づく現場のみに絞り込み（未紐付け現場は消える）
  const conSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: CON }) }).first()
  await conSelect.selectOption({ label: CON })

  await expect(siteSelect.locator('option', { hasText: LINKED })).toHaveCount(1)   // 紐づく現場は残る
  await expect(siteSelect.locator('option', { hasText: FREE })).toHaveCount(0)     // 未紐付け現場は消える
})
