// ============================================================
//  admin.vehicles.spec.ts
//  車両マスタ（admin）＋ 車検リマインド（shaken-reminder EF）
//   AC1: 車両を追加（名前/ナンバー/車検日/スタッドレス/保険）→ DB反映
//   AC2: 修理ログを追加 → DB反映
//   AC3(EF): 車検が近い車両が dry-run の due に出る／遠い車両は出ない（マルチテナント）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const VNAME = `E2E車両_${TS}`
const PLATE = `品川 500 あ ${String(TS).slice(-4)}`

test.describe.configure({ mode: 'serial' })

test.describe('車両マスタ CRUD', () => {
  test.afterAll(async () => {
    const rows = await rest(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=id`)
    for (const r of rows ?? []) {
      await rest(`vehicle_repair_logs?vehicle_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await rest(`vehicles?name=eq.${encodeURIComponent(VNAME)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1: 車両を追加すると DB に保存される', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('車両マスタ')

    await page.locator('.btn-add').click()
    await page.locator('[data-testid="vehicle-name"]').fill(VNAME)
    await page.locator('.input[placeholder*="品川"]').fill(PLATE)
    await page.locator('[data-testid="vehicle-inspection-date"]').fill('2026-07-10')
    // スタッドレス 有
    await page.locator('.field', { hasText: 'スタッドレスタイヤ' }).locator('button', { hasText: /^有$/ }).click()
    // 保険 加入 → 内容（「未加入」と区別するため完全一致）
    await page.locator('.field', { hasText: '任意保険' }).locator('button', { hasText: /^加入$/ }).click()
    await page.locator('.input[placeholder*="損保"]').fill('◯◯損保 対人対物無制限')
    await page.locator('[data-testid="vehicle-save"]').click()

    await expect.poll(async () => {
      const r = await rest(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=name,plate_number,inspection_date,has_studless,has_insurance,insurance_note`)
      const v = r?.[0]
      return v ? `${v.plate_number}|${v.inspection_date}|${v.has_studless}|${v.has_insurance}|${v.insurance_note}` : null
    }, { timeout: 10000 }).toBe(`${PLATE}|2026-07-10|true|true|◯◯損保 対人対物無制限`)

    // 一覧に車検日と残日数バッジが出る
    await expect(page.locator('tr', { hasText: VNAME })).toContainText('2026-07-10')
  })

  test('AC2: 修理ログを追加すると DB に保存される', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: VNAME })
    await expect(row).toBeVisible()
    await row.locator('.btn-edit').click()

    await page.locator('.repair-add input[type="date"]').fill('2026-06-01')
    await page.locator('.repair-add input[placeholder*="オイル"]').fill('オイル交換')
    await page.locator('.repair-add input[type="number"]').fill('8000')
    await page.locator('.btn-repair-add').click()

    await expect.poll(async () => {
      const vr = await rest(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=id`)
      const vid = vr?.[0]?.id
      if (!vid) return null
      const logs = await rest(`vehicle_repair_logs?vehicle_id=eq.${vid}&select=repair_date,description,cost`)
      const l = logs?.[0]
      return l ? `${l.repair_date}|${l.description}|${l.cost}` : null
    }, { timeout: 10000 }).toBe('2026-06-01|オイル交換|8000')
  })
})

// ── 車検リマインド（shaken-reminder EF dry-run・非test: sample-construction）──
test.describe('車検リマインド：dry-run', () => {
  const SC_SLUG = 'sample-construction'
  const FN = `${SUPABASE_URL}/functions/v1/shaken-reminder`
  const soon = `E2E車検間近_${TS}`
  const far  = `E2E車検先_${TS}`
  let scAccountId = ''
  let fnAvailable = true

  function ymd(offsetDays: number): string {
    const d = new Date(Date.now() + offsetDays * 86400000 + 9 * 3600000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  test.beforeAll(async () => {
    try {
      const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true, account_slug: '__none__' }) })
      if (!r.ok && r.status !== 404) fnAvailable = false
    } catch { fnAvailable = false }
    if (!fnAvailable) return
    const acc = await rest(`accounts?slug=eq.${SC_SLUG}&select=id`)
    scAccountId = acc?.[0]?.id
    if (!scAccountId) { fnAvailable = false; return }
    await rest('vehicles', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: scAccountId, name: soon, active: true, inspection_date: ymd(20) },   // 20日後＝対象
        { account_id: scAccountId, name: far,  active: true, inspection_date: ymd(120) },  // 120日後＝対象外
      ]),
    })
  })

  test.afterAll(async () => {
    if (!scAccountId) return
    for (const n of [soon, far]) {
      await rest(`vehicles?account_id=eq.${scAccountId}&name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('AC3: 車検45日以内の車両だけ due に出る', async () => {
    test.skip(!fnAvailable, 'functions serve 未起動のためskip')
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ dry_run: true, account_slug: SC_SLUG }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    const r = (json?.results ?? []).find((x: any) => x.slug === SC_SLUG)
    expect(r, 'sample-construction の結果が返る').toBeTruthy()
    const names = (r.due ?? []).map((d: any) => d.name)
    expect(names).toContain(soon)   // 20日後＝出る
    expect(names).not.toContain(far) // 120日後＝出ない
  })
})
