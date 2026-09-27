// ============================================================
//  admin.vehicles.spec.ts
//  車両マスタ（admin）＋ 車検リマインド（shaken-reminder EF）
//   AC1: 車両を追加（名前/ナンバー/車検日/スタッドレス/保険）→ DB反映
//   AC2: 修理ログを追加 → DB反映
//   AC3(EF): 車検が近い車両が dry-run の due に出る／遠い車両は出ない（マルチテナント）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, SUPABASE_URL, ANON_KEY, restSrv } from './helpers'

const TS = Date.now()
const VNAME = `E2E車両_${TS}`
const PLATE = `品川 500 あ ${String(TS).slice(-4)}`

test.describe.configure({ mode: 'serial' })

test.describe('車両マスタ CRUD', () => {
  test.afterAll(async () => {
    const rows = await restSrv(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=id`)
    for (const r of rows ?? []) {
      await restSrv(`vehicle_repair_logs?vehicle_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`vehicles?name=eq.${encodeURIComponent(VNAME)}`, { method: 'DELETE' }).catch(() => {})
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
      const r = await restSrv(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=name,plate_number,inspection_date,has_studless,has_insurance,insurance_note`)
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
      const vr = await restSrv(`vehicles?name=eq.${encodeURIComponent(VNAME)}&select=id`)
      const vid = vr?.[0]?.id
      if (!vid) return null
      const logs = await restSrv(`vehicle_repair_logs?vehicle_id=eq.${vid}&select=repair_date,description,cost`)
      const l = logs?.[0]
      return l ? `${l.repair_date}|${l.description}|${l.cost}` : null
    }, { timeout: 10000 }).toBe('2026-06-01|オイル交換|8000')
  })

  // ★保存ボタンが2つ見えて意味が違う問題（追加=即時保存 / 下の保存=車両情報）。
  //  挙動は変えず、画面から見分けられるようにしたことを固定する。
  test('AC1/AC2: 修理ログは即時保存だと分かり、下の保存が車両情報のものだと分かる', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: VNAME }).locator('.btn-edit').click()

    // 見出しに「すぐ保存される」と書いてある（押す前に分かる）
    await expect(page.locator('.repair-field label')).toContainText('すぐ保存されます')
    // 下の保存が何を保存するのか分かるラベルになっている
    await expect(page.getByTestId('vehicle-save')).toContainText('車両情報を保存')

    // 追加すると「保存しました」のフィードバックが出る（押した結果が見える）
    await page.locator('.repair-add input[type="date"]').fill('2026-06-02')
    await page.locator('.repair-add input[placeholder*="オイル"]').fill('タイヤ交換')
    await page.getByTestId('repair-add').click()
    await expect(page.getByTestId('repair-saved'), '保存された旨が出る').toContainText('保存しました')
  })

  // ★挙動は変えていないこと（即時保存のまま）を明示的に固定する
  test('AC3: 修理ログを追加して「保存」を押さずに閉じても残る（挙動は変えない）', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: VNAME }).locator('.btn-edit').click()

    await page.locator('.repair-add input[type="date"]').fill('2026-06-03')
    await page.locator('.repair-add input[placeholder*="オイル"]').fill('E2E閉じても残る')
    await page.getByTestId('repair-add').click()
    await expect(page.getByTestId('repair-saved')).toBeVisible({ timeout: 10000 })

    // ★車両情報を保存せずキャンセルで閉じる
    await page.locator('.btn-cancel').first().click()

    await page.locator('tr', { hasText: VNAME }).locator('.btn-edit').click()
    await expect(page.locator('.repair-list'), '開き直しても残っている').toContainText('E2E閉じても残る')
  })
})

// ── 車検リマインド: shaken-reminder EF は LINE 送信の全廃（2026-08-30）で撤去済み。テストも外した（2026-09-27）──
