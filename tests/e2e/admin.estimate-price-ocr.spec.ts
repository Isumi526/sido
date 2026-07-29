// ============================================================
//  admin.estimate-price-ocr.spec.ts
//  【見積】E4 価格表OCR取込（vision-LLM）＋差分承認
//   - 決定的に検証できる「差分承認パイプライン」をE2E化（vision-LLM抽出は非決定のため手動検証）
//   AC: 単価差分(材料X ¥A→¥B)が承認待ちに出る／承認した分のみ material_prices に反映＋改定履歴／人間承認必須
//   ★2026-07-29(R28): 材料マスタを廃止し商社単価表に一本化。承認は材料を作らず
//     単価表へ直接書く（単価表が品番・品名・単位を自分で持つ）。一括承認も追加。
//   ※ estimate_* は RLS 有効。seed/検証は service_role(restSrv)。承認操作は admin UI。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SUP = `商社E4_${TS}`
const MAT = `既存材_${TS}`
const NEW = `新規材_${TS}`
const CODE = `E4-${TS % 100000}`

test.describe.configure({ mode: 'serial' })

test.describe('見積 価格表差分承認（E4）', () => {
  test.afterAll(async () => {
    const sup = await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP)}&category=eq.${encodeURIComponent('商社')}&select=id`).catch(() => [])
    if (sup?.[0]) await restSrv(`estimate_price_revisions?supplier_id=eq.${sup[0].id}`, { method: 'DELETE' }).catch(() => {})
    if (sup?.[0]) await restSrv(`estimate_material_prices?supplier_id=eq.${sup[0].id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(MAT)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_materials?name=eq.${encodeURIComponent(NEW)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUP)}&category=eq.${encodeURIComponent('商社')}`, { method: 'DELETE' }).catch(() => {})
  })

  test('差分を承認すると material_prices に反映され（現行は履歴化）、新規材料も作成される', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const sup = (await post('subcontractors', { account_id: accountId, name: SUP, category: '商社', active: true }))[0]  // 商社＝下請け業者(区分=商社)
    // ★材料マスタは作らない。単価表に品番・品名を直接持たせる
    await post('estimate_material_prices', { account_id: accountId, supplier_id: sup.id, product_code: CODE, item_name: MAT, unit: '個', unit_price: 100, is_current: true })
    // OCRが作る想定の pending 差分: 既存品番 100→140 / 未登録品 ¥300
    const rev1 = (await post('estimate_price_revisions', { account_id: accountId, supplier_id: sup.id, code: CODE, name: MAT, old_price: 100, new_price: 140, status: 'pending' }))[0]
    const rev2 = (await post('estimate_price_revisions', { account_id: accountId, supplier_id: sup.id, name: NEW, unit: 'm2', new_price: 300, status: 'pending' }))[0]

    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    // 差分承認は「⚙️ マスタ・取込設定」内 → 開く → 対象商社タブを選ぶ（差分は商社で絞られる）
    await page.locator(`[data-testid="ptab-${sup.id}"]`).click()

    // 差分一覧に「材料X 現行→新単価」が出る（AC1相当）
    const row1 = page.locator(`[data-testid="rev-${rev1.id}"]`)
    // 品番・品名は編集できる入力欄なので値で見る（材料マスタの選択欄はR28で無くなった）
    await expect(page.locator(`[data-testid="rev-name-${rev1.id}"]`)).toHaveValue(MAT)
    await expect(page.locator(`[data-testid="rev-code-${rev1.id}"]`)).toHaveValue(CODE)
    await expect(row1).toContainText('¥100')
    // 新単価は承認前に手修正できる editable input（①編集）。値で検証する。
    await expect(page.locator(`[data-testid="rev-price-${rev1.id}"]`)).toHaveValue('140')
    await expect(page.locator(`[data-testid="rev-name-${rev2.id}"]`)).toHaveValue(NEW)

    // ① 既存材料の改定を承認 → 現行100は履歴化・新単価140がcurrent・revision applied
    await page.locator(`[data-testid="approve-${rev1.id}"]`).click()
    await expect.poll(async () => {
      const ps = await restSrv(`estimate_material_prices?product_code=eq.${CODE}&supplier_id=eq.${sup.id}&select=unit_price,is_current`)
      const cur = (ps ?? []).find((p: any) => p.is_current)
      const old = (ps ?? []).find((p: any) => !p.is_current)
      const rev = await restSrv(`estimate_price_revisions?id=eq.${rev1.id}&select=status`)
      return `${cur?.unit_price}|${old?.unit_price}|${rev?.[0]?.status}`
    }, { timeout: 10000 }).toBe('140|100|applied')

    // ② 未登録品の改定を承認 → ★材料マスタは作らず、単価表に直接入る
    await page.locator(`[data-testid="approve-${rev2.id}"]`).click()
    await expect.poll(async () => {
      const ps = await restSrv(`estimate_material_prices?item_name=eq.${encodeURIComponent(NEW)}&supplier_id=eq.${sup.id}&is_current=eq.true&select=unit_price,unit`)
      const rev = await restSrv(`estimate_price_revisions?id=eq.${rev2.id}&select=status`)
      return `${ps?.[0]?.unit_price}|${rev?.[0]?.status}|${ps?.[0]?.unit}`
    }, { timeout: 10000 }).toBe('300|applied|m2')
    // ★材料マスタを作っていないこと（一本化の要）
    const leftover = await restSrv(`estimate_materials?name=eq.${encodeURIComponent(NEW)}&select=id`)
    expect(leftover?.length ?? 0, '承認で材料マスタを作らない').toBe(0)

    // 承認後は pending 一覧から消える（人間承認した分だけ反映＝自動反映なし）
    await expect(page.locator(`[data-testid="rev-${rev1.id}"]`)).toHaveCount(0)
  })
})
