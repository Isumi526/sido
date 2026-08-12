// ============================================================
//  admin.estimate-product-info.spec.ts
//  見積R6: 品名の「もしかして」＋商品情報（サイズ展開・仕様・画像）の自動表示
//
//  ユーザー原文（2026-07-28 通しレビュー・音声）:
//   「品名を入力したときに、過去の入力から遡って予測変換だとか、近い入力があったときに
//     『もしかして』で表示して、クリックしたらそれで上書きするみたいなのが必要。
//     プラス、品名を選択したときに、商品の詳細画像とか、どんなサイズがあるかとかを、
//     ネット検索・AIで調べてぱっとUI上で表示したい」
//
//  ★このspecは生成AIを叩かない。叩くと課金され、結果も毎回変わってテストにならない。
//    キャッシュ（estimate_product_info）を先に入れておき、
//    「キャッシュがあればAIを叩かず即表示する」ことと表示内容を検証する。
//
//  ★2026-07-29(R14): 商品情報は「材料＝品番のある行」だけに出す仕様に変更。
//    作業内容（下請への発注作業）はネット検索しても商品として見つからないため。
//    よって本specでは品番を入れてから検証する。
//  ★2026-07-29(R23): 表示は品番セルの虫眼鏡アイコン＋モーダルに変更。
//    明細の下に出すと縦に伸びて入力欄が押し下げられるため。
//  Notion: R6 3a50ff81c56b81638fc2e49ae3b750bb / R14 / R23
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const MAT = `E2E不燃PB_${TS}`          // マスタに入れる正しい名前
const CODE = `PB-${TS % 100000}`       // 材料＝品番のある行として扱わせる
// ★全角/半角の違いはNFKC正規化で自動的に同じ扱いになる（＝候補を出す必要が無い）。
//   ここでは正規化では直らない打ち間違い（不燃→不然）を使う。
const TYPO = `E2E不然PB_${TS}`        // 打ち間違い（燃→然）
let seq = 0
const projName = () => `E2E商品情報_${TS}_${++seq}`
let PROJ = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  await restSrv('estimate_materials', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: MAT, unit: '枚', source: 'manual' }),
  })
  // 商品情報のキャッシュ（AIを叩かずに表示できる状態を作る）
  await restSrv('estimate_product_info', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, lookup_key: CODE.toLowerCase(), name: MAT, product_code: CODE,
      maker: 'E2Eメーカー', sizes: '910×1820 / 910×2420', spec: '厚さ12.5mm 不燃',
      image_url: null, source_urls: ['https://example.com/e2e-product'], not_found: false,
    }),
  })
  // 「調べたが見つからなかった」ケースのキャッシュ
  await restSrv('estimate_product_info', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, lookup_key: `nf-${TS}`.toLowerCase(),
      name: `E2E該当なし_${TS}`, product_code: `NF-${TS}`, not_found: true, source_urls: [],
    }),
  })
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E商品情報_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_product_info?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E%' + TS + '%')}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_materials?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E%' + TS + '%')}`, { method: 'DELETE' }).catch(() => {})
})

async function openNewProject(page: any) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
}

test('AC2★: 打ち間違いに「もしかして」候補が出て、クリックで上書きされる', async ({ page }) => {
  await openNewProject(page)
  // 予測変換(datalist)は前方一致しか効かない。全角Bのような打ち間違いはここでしか拾えない。
  await page.locator('[data-testid="item-name-0"]').fill(TYPO)
  const dym = page.locator('[data-testid="item-dym-0"]')
  await expect(dym).toBeVisible({ timeout: 10000 })
  await expect(dym).toContainText(MAT)

  await page.locator('[data-testid="item-dym-0-0"]').click()
  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue(MAT)
  // 正しい名前になったら候補は消える（正解が入っているのに出し続けない）
  await expect(page.locator('[data-testid="item-dym-0"]')).toHaveCount(0)
})

test('AC1: 完全一致するマスタ名を打った時は「もしかして」を出さない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(MAT)
  await page.waitForTimeout(600)
  await expect(page.locator('[data-testid="item-dym-0"]')).toHaveCount(0)
})

test('AC3★/AC4: 商品情報（サイズ・仕様・出典）が明細のそばに出る（キャッシュから／AIを叩かない）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(MAT)
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  // ★R31: 結果がある時はアイコンが青のi。押すとモーダルで出る
  const askIco = page.locator('[data-testid="item-pinfo-ask-0"]')
  await expect(askIco).toHaveClass(/done/, { timeout: 15000 })
  await askIco.click()
  const pinfo = page.locator('[data-testid="pinfo-modal"]')
  await expect(pinfo).toBeVisible({ timeout: 15000 })
  await expect(page.locator('[data-testid="pinfo-sizes"]')).toContainText('910×1820 / 910×2420')
  await expect(page.locator('[data-testid="pinfo-maker"]')).toContainText('E2Eメーカー')
  await expect(page.locator('[data-testid="pinfo-spec"]')).toContainText('厚さ12.5mm 不燃')
  // 出典リンク（今までGoogleで開いていたページ）に飛べる
  await expect(page.locator('[data-testid="pinfo-src-0"]')).toHaveAttribute('href', 'https://example.com/e2e-product')
  // AIの結果である旨の注意書きを必ず出す（そのまま発注させない）
  await expect(pinfo).toContainText('発注前に必ず現物・カタログで確認')
  await page.locator('[data-testid="pinfo-close"]').click()
  await expect(pinfo).toBeHidden()
})

test('AC5★: 見つからなかった時は黙って空欄にせず「見つかりませんでした」と出す', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(`E2E該当なし_${TS}`)
  await page.locator('[data-testid="item-code-0"]').fill(`NF-${TS}`)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  // ★R31: 結果が「見つからなかった」時はアイコンが赤バツになり、押すと詳細が出る
  const ico = page.locator('[data-testid="item-pinfo-ask-0"]')
  await expect(ico).toHaveClass(/none/, { timeout: 15000 })
  await ico.click()
  await expect(page.locator('[data-testid="pinfo-none"]')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('[data-testid="pinfo-none"]')).toContainText('見つかりませんでした')
})

test('AC6★: 未知の材料では自動でAIを叩かず、「商品情報を調べる」を出す', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(`E2E未知の材料_${TS}`)
  // ★品番が無いうちは作業内容扱いなので、そもそも検索ボタンを出さない（R14）
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await page.waitForTimeout(600)
  await expect(page.locator('[data-testid="item-pinfo-ask-0"]')).toHaveCount(0)

  await page.locator('[data-testid="item-code-0"]').fill(`UNK-${TS}`)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.waitForTimeout(1200)

  // ★打鍵のたびに生成AIを叩くと、課金が入力のたびに発生し、検索の十数秒が
  //   他の操作（保存など）を待たせる。人が押した時だけ調べる。
  // モーダルは勝手に開かない（自動でAIを叩かない）
  await expect(page.locator('[data-testid="pinfo-modal"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="item-pinfo-ask-0"]')).toBeVisible()

  // キャッシュ済みの品番では、アイコンが「調べる」から「見る」に変わる（再取得しない）
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  const ico = page.locator('[data-testid="item-pinfo-ask-0"]')
  await expect(ico).toHaveClass(/done/, { timeout: 15000 })
  await ico.click()
  await expect(page.locator('[data-testid="pinfo-sizes"]')).toContainText('910×1820')
})
