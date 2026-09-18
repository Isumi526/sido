// ============================================================
//  admin.tools.spec.ts
//  道具管理①（Notion: 【道具①】道具マスタと保管場所マスタを作り、adminで登録→QR自動発行・面付け印刷）
//   https://app.notion.com/p/3d90ff81c56b818f82a3c857a4f15367
//
//  出所（2026-09-10 SEED 会議）: 大塚「電話して誰さんが大阪に持ってったとか」＝数十万円の共有道具が行方不明。
//
//  ★守ること:
//   1. 保管場所は「拠点＞場所」の2段で登録でき、同じ拠点に同名は作れない。
//      拠点は自由入力ではなく現場マスタの office/factory 行から選ぶ（2026-09-18 レビュー指摘・2026-09-13 決定に合わせた）
//   2. 道具を登録すると一覧に出て、定位置・状態が残る。QR の URL はアプリ自身のドメイン（liff.line.me ではない）
//   3. 使っている保管場所は消せない（LOCATION_IN_USE）
//   4. 書き込みは EF 経由＝anon の REST 直叩きでは tools に入らない（RLS）
//   ※ CSV 取込は 2026-09-18 に外した（要望に無かった）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const BASE = `E2E拠点_${TS}`          // 現場マスタに kind=office で作る（拠点＝office/factory の現場）
const LOC = `倉庫A`
const TOOL = `E2Eレーザー_${TS}`
let baseSiteId = ''

test.describe('道具管理①（admin）', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    baseSiteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: BASE, kind: 'office', active: true }),
    }))[0].id
  })
  test.afterAll(async () => {
    const accountId = await getAccountId().catch(() => '')
    if (!accountId) return
    await restSrv(`tools?account_id=eq.${accountId}&name=like.E2E*_${TS}*`, { method: 'DELETE' }).catch(() => {})
    if (baseSiteId) {
      await restSrv(`tool_locations?base_site_id=eq.${baseSiteId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`sites?id=eq.${baseSiteId}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★保管場所→道具を登録し、一覧・QR・削除ガードが効く', async ({ page }) => {
    const accountId = await getAccountId()
    await page.goto('/tools', { waitUntil: 'networkidle' })

    // ── 保管場所（拠点＞場所）。拠点は現場マスタの office/factory から選ぶ（自由入力欄ではない）──
    await page.getByTestId('location-add-open').click()
    await expect(page.getByTestId('location-base'), '★拠点は select（現場マスタの office/factory）').toHaveJSProperty('tagName', 'SELECT')
    await page.getByTestId('location-base').selectOption(baseSiteId)
    await page.getByTestId('location-name').fill(LOC)
    await page.getByTestId('location-save').click()
    await expect(page.getByTestId(`base-card-${baseSiteId}`), '★拠点ごとにまとまった表に出る').toContainText(LOC, { timeout: 10000 })
    // 同名は作れない
    await page.getByTestId('location-add-open').click()
    await page.getByTestId('location-base').selectOption(baseSiteId)
    await page.getByTestId('location-name').fill(LOC)
    await page.getByTestId('location-save').click()
    await expect(page.locator('.modal .error'), '★同じ拠点に同名の保管場所は作れない').toContainText('既にあります')
    await page.locator('.modal .btn-cancel').click()

    const locs = await restSrv(`tool_locations?base_site_id=eq.${baseSiteId}&select=id`)
    expect(locs.length).toBe(1)
    const locationId = locs[0].id

    // ── 道具を登録 ──
    await page.getByTestId('tool-add-open').click()
    await page.getByTestId('tool-name').fill(TOOL)
    await page.getByTestId('tool-kind').fill('レーザー')
    await page.getByTestId('tool-code').fill(`L-${TS}`)
    await page.getByTestId('tool-location').selectOption(locationId)
    await page.getByTestId('tool-save').click()
    const row = page.locator('[data-testid^="tool-row-"]', { hasText: TOOL })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row, '定位置が残る').toContainText(`${BASE}＞${LOC}`)
    await expect(row, '初期状態は保管中').toContainText('保管中')
    const toolId = (await row.getAttribute('data-testid'))!.replace('tool-row-', '')
    // 同じ名前＋管理番号は二重登録できない（連打・リトライ対策・Gemini 指摘）
    await page.getByTestId('tool-add-open').click()
    await page.getByTestId('tool-name').fill(TOOL)
    await page.getByTestId('tool-code').fill(`L-${TS}`)
    await page.getByTestId('tool-save').click()
    await expect(page.locator('.modal .error'), '★同名＋同番号の道具は作れない').toContainText('既にあります')
    await page.locator('.modal .btn-cancel').click()

    // ── QR：URL はアプリ自身のドメイン（dev は localhost:3000）で、liff.line.me ではない ──
    await page.getByTestId(`tool-qr-${toolId}`).click()
    const url = await page.locator('[data-testid="tool-qr-modal"] .qr-url').textContent()
    expect(url, '★QR の URL はアプリ自身のドメイン').toBe(`http://localhost:3000/tools/${toolId}`)
    expect(url).not.toContain('liff.line.me')
    await page.locator('[data-testid="tool-qr-modal"] .btn-cancel').click()

    // ── 面付けPDF（選択した道具・場所QR）が実際に生成される（canvas→jsPDF の経路が落ちない）──
    await page.getByTestId(`tool-select-${toolId}`).check()
    const [dl1] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByTestId('tool-qr-pdf').click()])
    expect(dl1.suggestedFilename()).toMatch(/^tool_qr_.*\.pdf$/)
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByTestId('location-qr-pdf').click()])
    expect(dl2.suggestedFilename()).toMatch(/^tool_location_qr_.*\.pdf$/)

    // ── 使っている保管場所は消せない ──
    const alerts: string[] = []
    page.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); d.accept().catch(() => {}) })   // confirm→alert の2段
    await page.getByTestId(`location-del-${locationId}`).click()
    await page.waitForTimeout(800)
    const still = await restSrv(`tool_locations?id=eq.${locationId}&select=id`)
    expect(still.length, '★定位置にしている道具がある場所は消えない').toBe(1)
    expect(alerts.join(' '), '理由が出る').toContain('定位置')

    // ── 拠点をこの画面から登録できる（画面を跨がない・2026-09-19 レビュー指摘）。保存先は sites.kind=office ──
    const BASE2 = `E2E拠点2_${TS}`
    await page.getByTestId('base-site-add').click()
    await page.getByTestId('base-site-name').fill(BASE2)
    await page.getByTestId('base-site-save').click()
    await expect(page.locator('[data-testid^="base-card-"]', { hasText: BASE2 }), '★登録した拠点が表に増える').toBeVisible({ timeout: 10000 })
    const b2 = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(BASE2)}&select=id,kind`)
    expect(b2[0]?.kind).toBe('office')
    await restSrv(`sites?id=eq.${b2[0].id}`, { method: 'DELETE' }).catch(() => {})

    // ── anon の REST 直叩きでは書けない（RLS・EF 経由のみ）──
    const res = await fetch(`${process.env.SUPABASE_URL || 'http://127.0.0.1:56321'}/rest/v1/tools`, {
      method: 'POST',
      headers: { apikey: (await import('./helpers')).ANON_KEY, Authorization: `Bearer ${(await import('./helpers')).ANON_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: `E2E不正_${TS}` }),
    })
    expect(res.status, '★anon は tools に書けない').toBeGreaterThanOrEqual(400)
    const leaked = await rest(`tools?name=eq.${encodeURIComponent(`E2E不正_${TS}`)}&select=id`).catch(() => [])
    expect(Array.isArray(leaked) ? leaked.length : 0).toBe(0)
  })
})
