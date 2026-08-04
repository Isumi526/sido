// ============================================================
//  admin.site-deactivate-confirm.spec.ts
//  現場の無効化に確認を挟む（誤操作で黙って消えるのを防ぐ）
//   - 無効化は確認ダイアログを挟み、キャンセルすると有効のまま
//   - 有効化（戻す方向）は確認しない
//   - ★有効/無効の切替を operation_logs に残す（後から「どの現場を消したか」追える）
//   - ★システム用バケット行 __unset__ は現場マスタに出さない（誤操作の直接原因）
//  経緯: 2026-08-03 に誤って __unset__ を無効化し、特定に xmin を見るしかなかった。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E無効化確認_${TS}`
const UNSET = '__unset__'
let accountId = ''
let siteId = ''
let unsetId = ''

test.describe('現場の無効化に確認を挟む', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteId = (await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    // バケット行が無ければ作る（既にあればそれを使う）
    const found = await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(UNSET)}&select=id`)
    unsetId = found?.[0]?.id ?? (await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: UNSET, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`operation_logs?target_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  async function isActive(id: string): Promise<boolean> {
    const r = await rest(`sites?id=eq.${id}&select=active`)
    return !!r?.[0]?.active
  }

  test('★無効化はキャンセルできる（確認を挟むので誤操作で消えない）', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: true }) })

    let asked = ''
    page.on('dialog', (d) => { asked = d.message(); d.dismiss().catch(() => {}) })   // ← キャンセル

    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: SITE }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.getByRole('button', { name: '無効化' }).click()

    // ★確認文に現場名が入る（どれを消そうとしているか分かる＝今回の事故の核心）
    expect(asked, '確認ダイアログに現場名が入る').toContain(SITE)
    expect(await isActive(siteId), 'キャンセルしたので有効のまま').toBe(true)
  })

  test('★無効化を承諾すると無効になり、操作ログに残る', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: true }) })
    await restSrv(`operation_logs?target_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})

    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: SITE }).first().getByRole('button', { name: '無効化' }).click()

    await expect.poll(async () => isActive(siteId), { timeout: 15000 }).toBe(false)

    // ★後から「どの現場を無効にしたか」を追えること（今回の事故で無かったもの）
    await expect.poll(async () => {
      const logs = await restSrv(`operation_logs?target_id=eq.${siteId}&select=action,summary`)
      return logs?.length ?? 0
    }, { timeout: 15000 }).toBeGreaterThan(0)
    const logs = await restSrv(`operation_logs?target_id=eq.${siteId}&select=action,summary,target_type`)
    expect(logs[0].action).toContain('無効化')
    expect(logs[0].summary, '現場名が残る').toBe(SITE)
    expect(logs[0].target_type).toBe('site')
  })

  test('有効化（戻す方向）は確認を挟まない', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) })

    let dialogCount = 0
    page.on('dialog', (d) => { dialogCount++; d.accept().catch(() => {}) })

    await page.goto('/sites?status=inactive', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: SITE }).first().getByRole('button', { name: '有効化' }).click()

    await expect.poll(async () => isActive(siteId), { timeout: 15000 }).toBe(true)
    expect(dialogCount, '戻す操作は確認不要').toBe(0)
  })

  // ★誤操作の直接原因。他画面は「現場未設定」に変換して扱うのに、マスタだけ素通しだった
  test('★システム用バケット __unset__ は現場マスタに出ない（誤って無効化できない）', async ({ page }) => {
    await restSrv(`sites?id=eq.${unsetId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: true }) })

    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('tr', { hasText: SITE }).first(), '通常の現場は出る').toBeVisible({ timeout: 15000 })
    await expect(page.locator('tbody tr', { hasText: UNSET }), '有効タブに出ない').toHaveCount(0)

    await page.goto('/sites?status=inactive', { waitUntil: 'networkidle' })
    await expect(page.locator('tbody tr', { hasText: UNSET }), '無効化済みタブにも出ない').toHaveCount(0)
  })
})
