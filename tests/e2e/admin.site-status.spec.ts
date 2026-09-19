// ============================================================
//  admin.site-status.spec.ts
//  現場の5段階ステータス（2026-09-19 A-1・旧 admin.site-deactivate-confirm.spec.ts を置換）
//   - 一覧のタブ＝進行中／完了／失注／すべて（旧URL ?status=inactive は完了タブに読み替え）
//   - ステータス変更はモーダルを挟む（完了→終了日、失注→理由）。キャンセルすると変わらない
//   - 変更すると active がDBトリガで追従し、operation_logs に残る
//   - 戻す操作（完了→着工）もできる（可逆）
//   - その段階の必須項目（住所・工期・責任者）が無い現場は受注に上げられない（編集を促す）
//   - ★システム用バケット行 __unset__ は現場マスタに出さない（2026-08-03 事故の再発防止・従来どおり）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2Eステータス_${TS}`
const BARE = `E2Eステータス名前だけ_${TS}`
const UNSET = '__unset__'
let accountId = ''
let siteId = ''
let bareId = ''
let unsetId = ''
let workerId = ''

async function siteRow(id: string): Promise<{ status: string; active: boolean; period_end: string | null; lost_reason: string | null }> {
  const r = await restSrv(`sites?id=eq.${id}&select=status,active,period_end,lost_reason`)
  return r[0]
}

test.describe('現場の5段階ステータス', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`)
    workerId = w?.[0]?.id ?? null
    // 必須項目が揃った現場（受注・着工に上げられる）
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, status: 'in_progress', location: '名古屋市中区', period_start: '2026-09-01', responsible_worker_id: workerId }),
    }))[0].id
    // 名前だけの現場（見積中）
    bareId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: BARE, status: 'estimating' }),
    }))[0].id
    const found = await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(UNSET)}&select=id`)
    unsetId = found?.[0]?.id ?? (await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: UNSET, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    for (const id of [siteId, bareId]) {
      await restSrv(`operation_logs?target_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`sites?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('DBトリガ: active だけ書く古い経路でも status が追従する（逆も）', async () => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) })
    expect(await siteRow(siteId)).toMatchObject({ status: 'completed', active: false })
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'in_progress' }) })
    expect(await siteRow(siteId)).toMatchObject({ status: 'in_progress', active: true })
  })

  test('★完了にする時はモーダルで終了日を聞く。キャンセルすると変わらない', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'in_progress', period_end: null }) })
    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="site-row-${siteId}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.locator(`[data-testid="site-status-${siteId}"]`)).toHaveText('着工')

    await row.locator(`[data-testid="site-status-select-${siteId}"]`).selectOption('completed')
    const modal = page.locator('[data-testid="site-status-modal"]')
    await expect(modal).toBeVisible()
    await expect(modal, '確認文に現場名が入る').toContainText(SITE)
    await expect(modal.locator('[data-testid="site-status-end-date"]')).toBeVisible()
    await modal.getByRole('button', { name: 'キャンセル' }).click()
    await expect(modal).toHaveCount(0)
    expect((await siteRow(siteId)).status, 'キャンセルしたので着工のまま').toBe('in_progress')
  })

  test('★完了にすると終了日が入り active=false になり、操作ログに残る', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'in_progress', period_end: null }) })
    await restSrv(`operation_logs?target_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})

    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="site-row-${siteId}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator(`[data-testid="site-status-select-${siteId}"]`).selectOption('completed')
    const modal = page.locator('[data-testid="site-status-modal"]')
    await modal.locator('[data-testid="site-status-end-date"]').fill('2026-09-18')
    await modal.locator('[data-testid="site-status-confirm"]').click()

    await expect.poll(async () => (await siteRow(siteId)).status, { timeout: 15000 }).toBe('completed')
    expect(await siteRow(siteId)).toMatchObject({ active: false, period_end: '2026-09-18' })
    // 進行中タブから消え、完了タブに出る
    await expect(row).toHaveCount(0)
    await page.locator('[data-testid="site-tab-completed"]').click()
    await expect(page.locator(`[data-testid="site-status-${siteId}"]`)).toHaveText('完了')

    const logs = await restSrv(`operation_logs?target_id=eq.${siteId}&select=action,summary,target_type`)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0].action).toContain('完了')
    expect(logs[0].summary, '現場名と遷移が残る').toContain(SITE)
    expect(logs[0].target_type).toBe('site')
  })

  test('戻す操作（完了→着工）もできる。旧URL ?status=inactive は完了タブ', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'completed' }) })
    await page.goto('/sites?status=inactive', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="site-row-${siteId}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator(`[data-testid="site-status-select-${siteId}"]`).selectOption('in_progress')
    await page.locator('[data-testid="site-status-confirm"]').click()
    await expect.poll(async () => (await siteRow(siteId)).active, { timeout: 15000 }).toBe(true)
  })

  test('失注にする時は理由を聞き lost_reason に残る', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="site-row-${bareId}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.locator(`[data-testid="site-status-${bareId}"]`)).toHaveText('見積中')
    await row.locator(`[data-testid="site-status-select-${bareId}"]`).selectOption('lost')
    await page.locator('[data-testid="site-status-lost-reason"]').fill('他社が安かった')
    await page.locator('[data-testid="site-status-confirm"]').click()
    await expect.poll(async () => (await siteRow(bareId)).status, { timeout: 15000 }).toBe('lost')
    expect((await siteRow(bareId)).lost_reason).toBe('他社が安かった')
    await page.locator('[data-testid="site-tab-lost"]').click()
    await expect(page.locator(`[data-testid="site-status-${bareId}"]`)).toHaveText('失注')
  })

  test('★住所・工期・責任者の無い現場は受注に上げられない（編集を促す）', async ({ page }) => {
    await restSrv(`sites?id=eq.${bareId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'estimating', lost_reason: null }) })
    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="site-row-${bareId}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator(`[data-testid="site-status-select-${bareId}"]`).selectOption('ordered')
    const warn = page.locator('[data-testid="site-status-missing"]')
    await expect(warn).toBeVisible()
    await expect(warn).toContainText('住所')
    await expect(warn).toContainText('工期')
    await expect(warn).toContainText('責任者')
    await expect(page.locator('[data-testid="site-status-confirm"]'), '変更ボタンは出ない').toHaveCount(0)
    expect((await siteRow(bareId)).status).toBe('estimating')
  })

  test('ステータス一括変更: 選んだ現場をまとめて完了にできる', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'in_progress' }) })
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="site-bulk-status-start"]').click()
    await page.locator(`[data-testid="site-row-${siteId}"] input[type="checkbox"]`).check()
    await page.locator('[data-testid="site-bulk-status-select"]').selectOption('completed')
    await page.locator('[data-testid="site-bulk-status-apply"]').click()
    await page.locator('[data-testid="site-status-confirm"]').click()
    await expect.poll(async () => (await siteRow(siteId)).status, { timeout: 15000 }).toBe('completed')
  })

  test('編集モーダル: 見積中は現場名だけで保存でき、受注に変えると必須項目で止まる', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '＋ 追加' }).click()
    const name = `E2Eステータス新規_${TS}`
    await page.locator('.modal input.input').first().fill(name)
    await page.locator('[data-testid="site-modal-status"]').selectOption('estimating')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => {
      const r = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id,status`)
      return r?.[0]?.status ?? ''
    }, { timeout: 15000 }).toBe('estimating')
    const created = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
    const newId = created[0].id
    try {
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator(`[data-testid="site-row-${newId}"]`).getByRole('button', { name: '編集' }).click()
      await page.locator('[data-testid="site-modal-status"]').selectOption('ordered')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.locator('.modal .error')).toContainText('住所')
      expect((await siteRow(newId)).status, '止まったので見積中のまま').toBe('estimating')
    } finally {
      await restSrv(`operation_logs?target_id=eq.${newId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`sites?id=eq.${newId}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★システム用バケット __unset__ はどのタブにも出ない', async ({ page }) => {
    await restSrv(`sites?id=eq.${unsetId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: true }) })
    for (const tab of ['open', 'completed', 'all']) {
      await page.goto(`/sites?status=${tab}`, { waitUntil: 'networkidle' })
      await expect(page.locator('[data-testid="site-status-tabs"]')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('tbody tr', { hasText: UNSET }), `${tab} タブに出ない`).toHaveCount(0)
    }
  })
})
