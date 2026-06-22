// ============================================================
//  admin.estimate-builder.spec.ts
//  【見積】E1 全体見積→工種別 自動分割（手コピペ撲滅）
//   AC1: 全体見積で入力した明細が、転記操作なしで工種別に集計される
//   AC2: 工種別に金額が集計される（軽鉄=2行の合計、工種別合計と総合計）
//   ※ estimate_* は RLS 有効（admin authenticated のみ）。検証/cleanup は service_role(restSrv)。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PROJ = `E2E見積_${TS}`
const TRADE_A = `軽鉄_${TS}`   // 2行: 2000 + 3000 = 5000
const TRADE_B = `ボード_${TS}` // 1行: 5000
const PROJ2 = `E2E見積E5_${TS}`
const MAT = `カタログ材_${TS}`
const PROJ3 = `E2E見積E6_${TS}`
const MAT6 = `クロス_${TS}`
const PROJ4 = `E2E見積E7_${TS}`
const MAT7 = `フロア_${TS}`
const SUP_A = `商社A_${TS}`
const SUP_B = `商社B_${TS}`
const PROJ5 = `E2E見積E2_${TS}`
const TR1 = `軽鉄E2_${TS}`
const TR2 = `ボードE2_${TS}`

test.describe.configure({ mode: 'serial' })

test.describe('見積もり 全体見積→工種別自動集計', () => {
  test.afterAll(async () => {
    for (const name of [PROJ, PROJ2, PROJ3, PROJ4, PROJ5]) {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}&select=id`).catch(() => [])
      for (const p of projs ?? []) {
        await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
      }
      await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE_A)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE_B)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT6)}`, { method: 'DELETE' }).catch(() => {})
    // MAT7 削除で material_prices は cascade。その後 suppliers を削除
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT7)}`, { method: 'DELETE' }).catch(() => {})
    for (const s of [SUP_A, SUP_B]) {
      await restSrv(`estimate_suppliers?name=eq.${encodeURIComponent(s)}`, { method: 'DELETE' }).catch(() => {})
    }
    for (const t of [TR1, TR2]) {
      await restSrv(`estimate_trades?name=eq.${encodeURIComponent(t)}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('AC1/AC2: 明細入力→工種別に自動集計され、DBにも反映される', async ({ page }) => {
    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('見積もり')

    // 案件を追加
    await page.locator('[data-testid="new-project-name"]').fill(PROJ)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)

    // 工種を2つ追加
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE_A)
    await page.locator('[data-testid="add-trade"]').click()
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE_B)
    await page.locator('[data-testid="add-trade"]').click()

    // 明細3行（軽鉄2000・ボード5000・軽鉄3000）
    const addLine = async (i: number, trade: string, name: string, qty: number, price: number) => {
      await page.locator('[data-testid="add-row"]').click()
      await page.locator(`[data-testid="item-trade-${i}"]`).selectOption({ label: trade })
      await page.locator(`[data-testid="item-name-${i}"]`).fill(name)
      await page.locator(`[data-testid="item-qty-${i}"]`).fill(String(qty))
      await page.locator(`[data-testid="item-price-${i}"]`).fill(String(price))
    }
    await addLine(0, TRADE_A, 'スタッド', 2, 1000)   // 2000
    await addLine(1, TRADE_B, 'PB12.5', 1, 5000)     // 5000
    await addLine(2, TRADE_A, 'ランナー', 3, 1000)   // 3000

    // 工種別内訳パネル（転記操作なしで集計）
    const panel = page.locator('section.panel', { hasText: '工種別 内訳' })
    await expect(panel.locator('tr', { hasText: TRADE_A }).locator('.num')).toHaveText('¥5,000')
    await expect(panel.locator('tr', { hasText: TRADE_B }).locator('.num')).toHaveText('¥5,000')
    await expect(page.locator('[data-testid="grand-total"]')).toHaveText('¥10,000')

    // 保存 → DB（生成列 amount 含む）
    await page.locator('[data-testid="save-items"]').click()
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=amount`)
      if (!items || items.length !== 3) return `count=${items?.length}`
      return items.reduce((s: number, r: any) => s + Number(r.amount), 0)
    }, { timeout: 10000 }).toBe(10000)
  })

  // E5 マスタ蓄積（使いながら捕捉）: 初回入力の材料が次回以降 予測変換候補に出る
  test('E5: 初回入力した材料が estimate_materials に捕捉され、再訪時に予測変換候補に出る', async ({ page }) => {
    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="new-project-name"]').fill(PROJ2)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ2)

    // 新規材料名で1行入力 → 保存
    await page.locator('[data-testid="add-row"]').click()
    await page.locator('[data-testid="item-name-0"]').fill(MAT)
    await page.locator('[data-testid="item-qty-0"]').fill('1')
    await page.locator('[data-testid="item-price-0"]').fill('800')
    await page.locator('[data-testid="save-items"]').click()

    // DB: estimate_materials に捕捉される
    await expect.poll(async () => {
      const r = await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT)}&select=id`)
      return (r ?? []).length
    }, { timeout: 10000 }).toBe(1)

    // 再訪 → datalist 候補（予測変換）に出る
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator(`#est-materials option[value="${MAT}"]`)).toHaveCount(1)
  })

  // E6 品番予測変換: 既存材料名を入れると単位が自動補完され material_id が紐付く
  test('E6: 既存材料を選ぶと単位が自動補完され、material_id が紐付く', async ({ page }) => {
    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="new-project-name"]').fill(PROJ3)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ3)

    // 1行目: 新規材料を単位付きで入力 → 保存（E5でmaterials化＝unit=m2 も捕捉）
    await page.locator('[data-testid="add-row"]').click()
    await page.locator('[data-testid="item-name-0"]').fill(MAT6)
    await page.locator('[data-testid="item-unit-0"]').fill('m2')
    await page.locator('[data-testid="item-qty-0"]').fill('1')
    await page.locator('[data-testid="item-price-0"]').fill('100')
    await page.locator('[data-testid="save-items"]').click()
    await expect(page.locator('[data-testid="save-items"]')).toHaveText('保存', { timeout: 10000 })

    // 2行目: 同じ材料名を入力 → blur で resolveMaterial → 単位が自動補完
    await page.locator('[data-testid="add-row"]').click()
    await page.locator('[data-testid="item-name-1"]').fill(MAT6)
    await page.locator('[data-testid="item-qty-1"]').click()   // blur で @blur 発火
    await expect(page.locator('[data-testid="item-unit-1"]')).toHaveValue('m2')

    // 保存 → DB: 両行に material_id が紐付く（同一材料）
    await page.locator('[data-testid="item-qty-1"]').fill('2')
    await page.locator('[data-testid="item-price-1"]').fill('100')
    await page.locator('[data-testid="save-items"]').click()
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ3)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=material_id,unit`)
      if (!items || items.length !== 2) return `count=${items?.length}`
      const allLinked = items.every((r: any) => r.material_id && r.unit === 'm2')
      const sameMat = items[0].material_id === items[1].material_id
      return allLinked && sameMat
    }, { timeout: 10000 }).toBe(true)
  })

  // E7 商社別単価: 同一材料で商社A/Bの単価差を表示し、商社切替で明細単価・金額が即時更新
  // マスタ/単価は service_role で seed（UI経由のマスタ作成レースを避け、E7コア挙動を堅牢に検証）
  test('E7: 同一材料の商社別単価差が出て、商社切替で単価/金額が即時更新される', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post('estimate_projects', { account_id: accountId, name: PROJ4 })
    const mat = (await post('estimate_materials', { account_id: accountId, name: MAT7, unit: 'm2', source: 'manual' }))[0]
    const supA = (await post('estimate_suppliers', { account_id: accountId, name: SUP_A }))[0]
    const supB = (await post('estimate_suppliers', { account_id: accountId, name: SUP_B }))[0]
    await post('estimate_material_prices', { account_id: accountId, material_id: mat.id, supplier_id: supA.id, unit_price: 100, is_current: true })
    await post('estimate_material_prices', { account_id: accountId, material_id: mat.id, supplier_id: supB.id, unit_price: 120, is_current: true })

    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="project-select"]').selectOption({ label: PROJ4 })

    // 行追加 → 既存材料 MAT7 を入力（resolveMaterialで material_id 紐付け）
    await page.locator('[data-testid="add-row"]').click()
    await page.locator('[data-testid="item-name-0"]').fill(MAT7)
    await page.locator('[data-testid="item-qty-0"]').fill('2')   // blur で resolveMaterial 発火

    // 商社プルダウンに A/B の単価差が出る（—, A¥100, B¥120 ＝ 3択）
    await expect(page.locator('[data-testid="item-supplier-0"] option')).toHaveCount(3)
    // 商社B(¥120)へ切替 → 単価=120・金額=¥240 に即時更新
    await page.locator('[data-testid="item-supplier-0"]').selectOption({ label: `${SUP_B} ¥120` })
    await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('120')
    await expect(page.locator('[data-testid="item-amount-0"]')).toHaveText('¥240')
    // 商社A(¥100)へ切替 → 単価=100・金額=¥200（単価差の反映）
    await page.locator('[data-testid="item-supplier-0"]').selectOption({ label: `${SUP_A} ¥100` })
    await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('100')
    await expect(page.locator('[data-testid="item-amount-0"]')).toHaveText('¥200')

    // 保存 → DB: supplier_id 紐付き・unit_price=100・amount=200
    await page.locator('[data-testid="save-items"]').click()
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ4)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=supplier_id,unit_price,amount`)
      const r = items?.[0]
      return r ? `${!!r.supplier_id}|${r.unit_price}|${r.amount}` : null
    }, { timeout: 10000 }).toBe('true|100|200')
  })

  // E2 帳票PDF: 見積書プレビュー（表紙＋工種別内訳＋合計）が出て、PDF出力でDLされる
  test('E2: 見積書プレビューが工種別内訳・合計を表示し、PDF出力でダウンロードされる', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ5, client_name: 'テスト客先' }))[0]
    const t1 = (await post('estimate_trades', { account_id: accountId, name: TR1 }))[0]
    const t2 = (await post('estimate_trades', { account_id: accountId, name: TR2 }))[0]
    await post('estimate_items', { account_id: accountId, project_id: proj.id, trade_id: t1.id, item_name: 'スタッド', unit: 'm', quantity: 2, unit_price: 100, note: '1F', sort_order: 0 })
    await post('estimate_items', { account_id: accountId, project_id: proj.id, trade_id: t2.id, item_name: 'PB12.5', unit: '枚', quantity: 1, unit_price: 500, sort_order: 1 })

    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="project-select"]').selectOption({ label: PROJ5 })

    // プレビュー: 表紙・工種別内訳・小計・合計
    const pv = page.locator('[data-testid="pdf-preview"]')
    await expect(pv).toContainText('御 見 積 書')
    await expect(pv).toContainText('テスト客先 御中')
    await expect(page.locator('[data-testid="pdf-grandtotal"]')).toContainText('¥700')
    await expect(pv).toContainText(TR1)
    await expect(pv).toContainText(TR2)
    await expect(pv).toContainText('小計 ¥200')   // 軽鉄: 2×100
    await expect(pv).toContainText('小計 ¥500')   // ボード: 1×500

    // PDF出力 → ダウンロードが発火し、ファイル名に「見積」を含む
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('[data-testid="export-pdf"]').click(),
    ])
    expect(dl.suggestedFilename()).toContain('見積')
  })
})
