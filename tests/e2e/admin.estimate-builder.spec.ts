// ============================================================
//  admin.estimate-builder.spec.ts
//  【見積】E1 全体見積→工種別 自動分割（手コピペ撲滅）
//   AC1: 全体見積で入力した明細が、転記操作なしで工種別に集計される
//   AC2: 工種別に金額が集計される（軽鉄=2行の合計、工種別合計と総合計）
//   ※ estimate_* は RLS 有効（admin authenticated のみ）。検証/cleanup は service_role(restSrv)。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, openBuilderTab, newBlockFirstRow, createEstimateProject } from './helpers'

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
const MAT_PL = `単価表材_${TS}`
const SUP_PL = `単価表商社_${TS}`
const SUP_INLINE = `インライン商社_${TS}`
const TRADE_M = `工種M_${TS}`
const MNAME_M = `品名M_${TS}`
const MCODE_M = `PB-${TS}`
const DUP_PROJ = `重複案件_${TS}`

test.describe.configure({ mode: 'serial' })

test.describe('見積もり 全体見積→工種別自動集計', () => {
  test.afterAll(async () => {
    for (const name of [PROJ, PROJ2, PROJ3, PROJ4, PROJ5, DUP_PROJ]) {
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
      await restSrv(`subcontractors?name=eq.${encodeURIComponent(s)}&category=eq.${encodeURIComponent('商社')}`, { method: 'DELETE' }).catch(() => {})
    }
    for (const t of [TR1, TR2]) {
      await restSrv(`estimate_trades?name=eq.${encodeURIComponent(t)}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT_PL)}`, { method: 'DELETE' }).catch(() => {})  // cascade prices
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP_PL)}&category=eq.${encodeURIComponent('商社')}`, { method: 'DELETE' }).catch(() => {})
    // インライン追加した商社（edit_logのFK→先に消す）
    for (const s of (await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP_INLINE)}&select=id`).catch(() => []) ?? [])) {
      await restSrv(`subcontractor_edit_logs?subcontractor_id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP_INLINE)}&category=eq.${encodeURIComponent('商社')}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MNAME_M)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE_M)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/AC2: 明細入力→工種別に自動集計され、DBにも反映される', async ({ page }) => {
    // 工種はマスタ（/estimate-masters）管轄になったので REST で用意
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post('estimate_trades', { account_id: accountId, name: TRADE_A })
    await post('estimate_trades', { account_id: accountId, name: TRADE_B })

    // 見積入口一本化(#40): 案件はDBで作り ?project= で開く（直打ちの新規カードは廃止）
    const __pidA = await createEstimateProject(PROJ)
    await page.goto(`/estimate-builder?project=${__pidA}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)

    // 明細3行（軽鉄2000・ボード5000・軽鉄3000）
    // 工種はブロック単位（レビュー2026-07-28）。行追加ボタンは無く空行が用意されている。
    const addLine = async (i: number, name: string, qty: number, price: number) => {
      await page.locator(`[data-testid="item-name-${i}"]`).fill(name)
      await page.locator(`[data-testid="item-qty-${i}"]`).fill(String(qty))
      await page.locator(`[data-testid="item-price-${i}"]`).fill(String(price))
    }
    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="blk-trade-0"]').fill(TRADE_A)
    await addLine(0, 'スタッド', 2, 1000)   // 2000
    await addLine(1, 'ランナー', 3, 1000)   // 3000
    // 別の工種は別ブロック
    await page.locator('[data-testid="area-add-trade-0"]').click()
    await page.locator('[data-testid="blk-trade-1"]').fill(TRADE_B)
    const nextIdx = await newBlockFirstRow(page)
    await addLine(nextIdx, 'PB12.5', 1, 5000)     // 5000

    // 工種別内訳パネル（転記操作なしで集計）。★R36で専用タブになった
    await page.locator('[data-testid="tab-breakdown"]').click()   // R36: 専用タブになった
    const panel = page.locator('section.panel', { hasText: '工種別 内訳' })
    await expect(panel.locator('tr', { hasText: TRADE_A }).locator('.num')).toHaveText('¥5,000')
    await expect(panel.locator('tr', { hasText: TRADE_B }).locator('.num')).toHaveText('¥5,000')
    await expect(page.locator('[data-testid="grand-total"]')).toHaveText('¥10,000')

    // 保存 → DB（生成列 amount 含む）
    await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=amount`)
      if (!items || items.length !== 3) return `count=${items?.length}`
      return items.reduce((s: number, r: any) => s + Number(r.amount), 0)
    }, { timeout: 10000 }).toBe(10000)
  })

  // E5 使いながら捕捉: 初回入力の名称が次回以降 予測変換候補に出る
  // ★2026-07-29(R28): 材料マスタを廃止したので、候補の出所は
  //   「商社単価表 ＋ 過去の明細入力履歴」。保存した明細がそのまま候補になる。
  test('E5: 初回入力した名称が、再訪時に予測変換候補に出る（材料マスタは作らない）', async ({ page }) => {
    const __pid1 = await createEstimateProject(PROJ2)
    await page.goto(`/estimate-builder?project=${__pid1}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ2)

    // 新規材料名で1行入力 → 保存
    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="item-name-0"]').fill(MAT)
    await page.locator('[data-testid="item-qty-0"]').fill('1')
    await page.locator('[data-testid="item-price-0"]').fill('800')
    await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })

    // DB: 明細として保存される（＝これが候補の元になる）
    await expect.poll(async () => {
      const r = await restSrv(`estimate_items?item_name=eq.${encodeURIComponent(MAT)}&select=id`)
      return (r ?? []).length
    }, { timeout: 10000 }).toBeGreaterThan(0)

    // ★材料マスタは作らない（管理する場所を増やさないのがR28の要）
    const mats = await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT)}&select=id`)
    expect(mats?.length ?? 0, '材料マスタには登録しない').toBe(0)

    // 再訪 → datalist 候補（予測変換）に出る
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator(`#est-materials option[value="${MAT}"]`)).toHaveCount(1)
  })

  // E6 予測変換: 過去に打った名称を入れると単位が自動補完される
  // ★2026-07-29(R28): 材料マスタを廃止したので material_id は新規では付かない。
  //   候補と単位補完は「過去の明細入力履歴」から効く（保存＝そのまま履歴）。
  test('E6: 過去に打った名称を選ぶと単位が自動補完される', async ({ page }) => {
    const __pid2 = await createEstimateProject(PROJ3)
    await page.goto(`/estimate-builder?project=${__pid2}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ3)

    // 1行目: 新しい名称を単位付きで入力 → 保存（これが次回の候補になる）
    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="item-name-0"]').fill(MAT6)
    await page.locator('[data-testid="item-unit-0"]').fill('m2')
    await page.locator('[data-testid="item-qty-0"]').fill('1')
    await page.locator('[data-testid="item-price-0"]').fill('100')
    await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
    
    // 2行目: 同じ名称を入力 → blur で resolveMaterial → 単位が自動補完
    await page.locator('[data-testid="item-name-1"]').fill(MAT6)
    await page.locator('[data-testid="item-qty-1"]').click()   // blur で @blur 発火
    await expect(page.locator('[data-testid="item-unit-1"]')).toHaveValue('m2')

    // 保存 → DB: 両行とも単位が入っている（候補からの補完が保存まで通る）
    await page.locator('[data-testid="item-qty-1"]').fill('2')
    await page.locator('[data-testid="item-price-1"]').fill('100')
    await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ3)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=item_name,unit`)
      if (!items || items.length !== 2) return `count=${items?.length}`
      return items.every((r: any) => r.item_name === MAT6 && r.unit === 'm2')
    }, { timeout: 10000 }).toBe(true)

    // ★材料マスタは作らない（R28）
    const mats = await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT6)}&select=id`)
    expect(mats?.length ?? 0, '材料マスタには登録しない').toBe(0)
  })

  // E7 商社別単価: 同一材料で商社A/Bの単価差を表示し、商社切替で明細単価・金額が即時更新
  // マスタ/単価は service_role で seed（UI経由のマスタ作成レースを避け、E7コア挙動を堅牢に検証）
  // ★2026-07-29(R28): 商社単価は品番で引き、入る先は「原価」。
  //   商社から買う値段は原価であって客先に出す値段ではない（客先単価は粗利率から生える）。
  test('E7: 同一品番の商社別単価差が出て、商社切替で原価/客先単価が即時更新される', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const proj4 = (await post('estimate_projects', { account_id: accountId, name: PROJ4 }))[0]
    // 商社＝下請け業者(区分=商社)。★材料マスタは作らず、単価表が品番・品名を持つ
    const supA = (await post('subcontractors', { account_id: accountId, name: SUP_A, category: '商社', active: true }))[0]
    const supB = (await post('subcontractors', { account_id: accountId, name: SUP_B, category: '商社', active: true }))[0]
    const code7 = `E7-${TS % 100000}`
    await post('estimate_material_prices', { account_id: accountId, supplier_id: supA.id, product_code: code7, item_name: MAT7, unit: 'm2', unit_price: 100, is_current: true })
    await post('estimate_material_prices', { account_id: accountId, supplier_id: supB.id, product_code: code7, item_name: MAT7, unit: 'm2', unit_price: 120, is_current: true })

    await page.goto(`/estimate-builder?project=${proj4.id}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ4)

    // 品番を入力 → 商社単価表と突き合わせ（材料マスタは介さない）
    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="item-code-0"]').fill(code7)
    await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
    await page.locator('[data-testid="item-qty-0"]').fill('2')

    // 商社プルダウンに A/B の単価差が出る（—, A¥100, B¥120 ＝ 3択）
    await expect(page.locator('[data-testid="item-supplier-0"] option')).toHaveCount(3)
    // 商社B(¥120)へ切替 → ★原価=120。客先単価は粗利20%で 120/0.8=150
    // ★R41: 選択肢のラベルに出所（単価表／定価×掛率）が付くので前方一致で選ぶ
// ★R41: 選択肢のラベルに出所（単価表／定価×掛率）が付くので、value(=商社ID)で選ぶ
    await page.locator('[data-testid="item-supplier-0"]').selectOption(supB.id)
    await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('120')
    await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('150')
    // 商社A(¥100)へ切替 → 原価=100・客先 100/0.8=125・金額 ¥250
    await page.locator('[data-testid="item-supplier-0"]').selectOption(supA.id)
    await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('100')
    await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('125')
    await expect(page.locator('[data-testid="item-amount-0"]')).toHaveText('¥250')

    // 保存 → DB: supplier_id 紐付き・unit_price=100・amount=200
    await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ4)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=supplier_id,cost_unit_price,unit_price,amount`)
      const r = items?.[0]
      return r ? `${!!r.supplier_id}|${r.cost_unit_price}|${r.unit_price}|${r.amount}` : null
    }, { timeout: 10000 }).toBe('true|100|125|250')
  })

  // E2 帳票PDF: 見積書プレビュー（表紙＋工種別内訳＋合計）が出て、PDF出力でDLされる
  // ★2026-07-29(R25): 内訳書はExcelの「全体見積」と同じ形＝場所/工種の見出し＋明細を行単位で出す。
  //   工種ごとの小計だけを並べる形は廃止（同じ明細を2回出さない）。
  test('E2: 見積書プレビューが内訳書（場所・工種の見出し＋明細行）を表示し、PDF出力でダウンロードされる', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ5, client_name: 'テスト客先' }))[0]
    const t1 = (await post('estimate_trades', { account_id: accountId, name: TR1 }))[0]
    const t2 = (await post('estimate_trades', { account_id: accountId, name: TR2 }))[0]
    // note=場所（大項目）、trade_name=工種（中項目）。内訳書の見出しになる
    await post('estimate_items', { account_id: accountId, project_id: proj.id, trade_id: t1.id, trade_name: TR1, item_name: 'スタッド', spec: 'W65', dim_w: 65, unit: 'm', quantity: 2, unit_price: 100, note: '壁面工事', sort_order: 0 })
    await post('estimate_items', { account_id: accountId, project_id: proj.id, trade_id: t2.id, trade_name: TR2, item_name: 'PB12.5', unit: '枚', quantity: 1, unit_price: 500, note: '壁面工事', sort_order: 1 })

    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ5)

    // プレビュー(サンプル様式): 表紙(見積金額・宛名)・内訳書・工種別小計・合計
    await page.locator('[data-testid="tab-preview"]').click()
    const pv = page.locator('[data-testid="pdf-preview"]')
    await expect(pv).toContainText('テスト客先　様')
    await expect(pv).toContainText('見積金額')
    await expect(pv).toContainText('内訳書')
    await expect(pv).toContainText('¥700')        // 小計(明細合計)=2×100 + 1×500
    // ★場所・工種の見出しがExcelと同じ表記で出る
    await expect(pv).toContainText('（壁面工事）')
    await expect(pv).toContainText(`■${TR1}`)
    await expect(pv).toContainText(`■${TR2}`)
    // ★明細が行単位で出る（名称・形状詳細・W・数量・単位・単価）
    await expect(pv).toContainText('スタッド')
    await expect(pv).toContainText('W65')
    await expect(pv).toContainText('PB12.5')

    // PDF出力 → ダウンロードが発火し、ファイル名に「見積」を含む
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('[data-testid="export-pdf"]').click(),
    ])
    expect(dl.suggestedFilename()).toContain('見積')
  })

  // 商社別単価: 登録UI → 現行一覧に表示 → 削除
  test('商社別単価: 登録すると一覧に出て、削除できる', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const sup = (await post('subcontractors', { account_id: accountId, name: SUP_PL, category: '商社', active: true }))[0]
    const codePL = `PL-${TS % 100000}`

    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })

    // ★R28: 材料マスタから選ぶのではなく、品番・品名を単価表に直接入れる
    await page.locator(`[data-testid="ptab-${sup.id}"]`).click()
    await page.locator('[data-testid="price-code"]').fill(codePL)
    await page.locator('[data-testid="price-name"]').fill(MAT_PL)
    await page.locator('[data-testid="price-unit"]').fill('m')
    await page.locator('[data-testid="price-value"]').fill('1500')
    await page.locator('[data-testid="add-price"]').click()

    // 現行一覧に出る（商社列は無い＝タブで自明）
    const list = page.locator('[data-testid="price-list"]')
    await expect(list).toContainText(MAT_PL)
    // 単価はその場編集できる editable input（①編集）。値で検証する。
    await expect(list.locator('tr', { hasText: MAT_PL }).locator('input[data-testid^="price-val-"]')).toHaveValue('1500')
    await expect.poll(async () => {
      const ps = await restSrv(`estimate_material_prices?product_code=eq.${codePL}&supplier_id=eq.${sup.id}&is_current=eq.true&select=id`)
      return (ps ?? []).length
    }, { timeout: 10000 }).toBe(1)

    // 削除（MAT_PL の行を狙う＝他の単価が混在しても誤削除しない）→ 一覧/DBから消える
    await list.locator('tr', { hasText: MAT_PL }).locator('[data-testid^="price-del-"]').click()
    await expect.poll(async () => {
      const ps = await restSrv(`estimate_material_prices?product_code=eq.${codePL}&supplier_id=eq.${sup.id}&select=id`)
      return (ps ?? []).length
    }, { timeout: 10000 }).toBe(0)
  })

  // このページから商社(下請け業者 区分=商社)を追加できる（横断不要）
  test('商社をこのページから追加できる（下請け業者 区分=商社として保存）', async ({ page }) => {
    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="add-supplier-toggle"]').click()
    await page.locator('[data-testid="new-supplier-name"]').fill(SUP_INLINE)
    await page.locator('[data-testid="add-supplier"]').click()

    // タブに出て選択状態になる
    await expect(page.locator('.price-tabs')).toContainText(SUP_INLINE)
    // DB: subcontractors に 区分=商社 で保存
    await expect.poll(async () => {
      const s = await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP_INLINE)}&category=eq.${encodeURIComponent('商社')}&select=id`)
      return (s ?? []).length
    }, { timeout: 10000 }).toBe(1)
  })

  // 工種一覧＋材料マスタ（★R50で廃止＝閲覧のみ）
  test('工種は追加できる／材料マスタは閲覧のみで追加・削除できない（R50）', async ({ page }) => {
    const accountId = await getAccountId()
    // 「過去に登録された材料」を用意する。廃止後も既存見積が参照するので消えてはいけない
    await restSrv('estimate_materials', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, code: MCODE_M, name: MNAME_M, unit: '枚', source: 'manual' }),
    })

    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="subtab-trade"]').click()

    // 工種は今までどおり追加できる（廃止したのは材料マスタだけ）
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE_M)
    await page.locator('[data-testid="add-trade"]').click()
    await expect(page.locator('[data-testid="trade-list"]')).toContainText(TRADE_M)

    await page.locator('[data-testid="subtab-material"]').click()

    // ★追加の導線が無い（開いていると単価の正本がまた二重化する）
    await expect(page.locator('[data-testid="mat-add"]'), '追加ボタンが無い').toHaveCount(0)
    await expect(page.locator('[data-testid="mat-name"]'), '入力欄が無い').toHaveCount(0)
    await expect(page.locator('[data-testid="mat-code"]')).toHaveCount(0)
    // ★削除の導線も無い（消すのは単価表側の判断・破壊的操作はここから行わせない）
    await expect(page.locator('[data-testid^="mat-del-"]'), '削除ボタンが無い').toHaveCount(0)

    // 廃止した旨と、どこで管理するかが画面に出ている
    await expect(page.getByTestId('material-deprecated')).toContainText('商社単価表')

    // ★既存データは消さずに読める（過去見積の名称・単位の解決に使っている）
    const ml = page.locator('[data-testid="material-list"]')
    await expect(ml).toContainText(MCODE_M)
    await expect(ml).toContainText(MNAME_M)
    const rows = await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MNAME_M)}&select=id`)
    expect((rows ?? []).length, 'DBの行も残っている').toBe(1)
  })

  // 同名の案件は作れない（重複防止）
  test('同名の案件は登録できない（DB一意制約で重複防止）', async () => {
    // ★#40(見積入口一本化): ビルダー内の「名前を打って新規作成」導線は廃止した。
    //  入口は estimate-list の「＋新規」＝自動命名＋衝突時は自動リネームでリトライする設計。
    //  重複防止の実体は DB の一意制約 est_projects_name_uniq(account_id, lower(name)) で、
    //  estimate-list のリトライはこの制約が効いていることに依存する。ここでは制約の生存を固定する。
    const accountId = await getAccountId()
    await restSrv('estimate_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, name: DUP_PROJ }) })

    // 2件目（同名）は一意制約で拒否される（createEstimateProject は 409 を投げる）
    let rejected = false
    try {
      await createEstimateProject(DUP_PROJ)
    } catch (e: any) {
      rejected = /23505|duplicate|unique/i.test(String(e?.message ?? e))
    }
    expect(rejected, '同名の2件目は一意制約で弾かれる').toBe(true)

    // DBは1件のまま（増えない）
    const p = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(DUP_PROJ)}&select=id`)
    expect((p ?? []).length, 'DBは1件のまま').toBe(1)
  })
})
