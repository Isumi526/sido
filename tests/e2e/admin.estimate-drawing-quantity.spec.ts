// ============================================================
//  admin.estimate-drawing-quantity.spec.ts
//  【見積Q7】図面凡例から確定数量を自動取込（床/置床/天井/建具/器具）
//
//  ★実施図面を全数解析した結果、床・置床・天井の面積、建具・器具の台数、紙管の本数は
//   設計者が凡例に明記していると分かった（拾い直す必要がない）。面積を計算するのではなく
//   「書いてある数字」を転記する機能。
//  ★天井合計 ≒ 通り芯面積 の検算を自動で走らせる（北新宿の実例: 71.0㎡ ≒ 10.2×6.95=70.9㎡）。
//   AIの抽出は間違いうるので「桁違い・部屋1つ分の取りこぼし」を機械で弾くのが要。
//  ★壁は対象外（面積が図面に無い）。ロス率は人が付ける。
//
//  ★解析AI(Gemini)は非決定・課金されるので呼ばない。EFの応答を差し替えて
//   抽出→検算→明細投入までの流れを決定的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const PROJ = `E2E数量抽出_${TS}`
let projId = ''

/** 最小PDF（2ページ） */
function makePdf(pages: number): Buffer {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  projId = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  }))[0].id
})

test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_project_attachments?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
})

/**
 * 図面を添付して数量抽出を走らせ、結果パネルを開く。EFの応答は差し替える。
 * gridY を変えることで検算の乖離を作れる（警告テスト用）。
 */
async function runQuantityExtract(page: any, label: string, gridY: number) {
  // 1ページ目=天井の凡例（合計71.0㎡）＋通り芯 / 2ページ目=床と建具
  const byPage: Record<number, any> = {
    1: {
      parts: [{
        part: '天井',
        rows: [
          { code: 'C-01', spec: '岩綿吸音板', value: 6.5, unit: '㎡' },
          { code: 'C-03', spec: '化粧석膏ボード', value: 43.5, unit: '㎡' },
          { code: 'C-04', spec: 'AEP', value: 21.0, unit: '㎡' },
        ],
      }],
      gridSpanX: 10.2, gridSpanY: gridY, ceilingHeights: ['CH=2400'],
    },
    2: {
      parts: [
        // ★符号(code)とメーカー品番(maker_code)は別物。単価を引く鍵は maker_code の方。
        { part: '床', rows: [{ code: 'F-01', maker_code: 'NT-31', spec: 'タイルカーペット', value: 21.3, unit: '㎡' }] },
        // 図面に品番が書かれていない行もある（建具は符号だけのことが多い）
        { part: '建具', rows: [{ code: 'AD-1', maker_code: null, spec: '片開き', value: 1, unit: '台' }] },
      ],
      gridSpanX: null, gridSpanY: null, ceilingHeights: [],
    },
  }
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const d = byPage[body.page] ?? { parts: [], gridSpanX: null, gridSpanY: null, ceilingHeights: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, page: body.page, ...d }) })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_${label}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-panel"]')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="dqty-busy"]')).toHaveCount(0, { timeout: 40000 })
}

test('AC1★: 凡例の確定数量（床/天井/建具）が抽出されて一覧に出る', async ({ page }) => {
  // 天井71.0 vs 通り芯 10.2×6.95=70.9 → 乖離0.1%＝正常
  await runQuantityExtract(page, 'ac1', 6.95)

  const panel = page.locator('[data-testid="dqty-panel"]')
  await expect(panel, '天井の凡例が出る').toContainText('C-01')
  await expect(panel, '床の凡例が出る').toContainText('F-01')
  await expect(panel, '建具の台数も出る').toContainText('AD-1')
  await expect(panel, '面積の単位').toContainText('㎡')
  await expect(panel, '台数の単位').toContainText('台')
  // 壁は対象外であることを画面で明示している
  await expect(panel, '壁は対象外と明示').toContainText('壁は対象外')
  // ロス率は人が付ける（図面に「ロスは見込んでください」とあるため）
  await expect(panel, 'ロス率は人が付けると明示').toContainText('ロス率は人が付けて')
})

test('AC★: 天井合計と通り芯面積の検算が走り、妥当なら一致として出る', async ({ page }) => {
  await runQuantityExtract(page, 'ok', 6.95)

  const check = page.getByTestId('dqty-check')
  await expect(check, '検算結果が出る').toBeVisible()
  await expect(check, '天井合計71.0が出る').toContainText('71㎡')
  await expect(check, '通り芯面積70.9が出る').toContainText('70.9㎡')
  await expect(check, '妥当と判定').toContainText('妥当な範囲')
  await expect(page.getByTestId('dqty-check-warn'), '警告は出ない').toHaveCount(0)
})

// ★これが検算の存在価値。抽出漏れ・二重計上を機械で拾う
test('AC★: 天井合計が通り芯面積と大きく乖離したら警告する', async ({ page }) => {
  // 通り芯を 10.2×3.0=30.6㎡ にすると 天井71.0 は +132% 乖離
  await runQuantityExtract(page, 'warn', 3.0)

  const warn = page.getByTestId('dqty-check-warn')
  await expect(warn, '乖離が大きいと警告が出る').toBeVisible()
  await expect(warn).toContainText('乖離')
  await expect(warn, '何を疑えばよいか書いてある').toContainText('抽出漏れ・二重計上')
})

test('AC★: 選んだ数量が明細の初期値として入る（確定はしない）', async ({ page }) => {
  await runQuantityExtract(page, 'apply', 6.95)

  // 全解除してから床の1行だけ選ぶ（全部入れない＝人が選ぶ）
  await page.getByTestId('dqty-none').click()
  const rows = page.locator('[data-testid^="dqty-row-"]')
  const n = await rows.count()
  let floorIdx = -1
  for (let i = 0; i < n; i++) {
    if ((await rows.nth(i).innerText()).includes('F-01')) { floorIdx = i; break }
  }
  expect(floorIdx, '床の行が見つかる').toBeGreaterThanOrEqual(0)
  await page.getByTestId(`dqty-pick-${floorIdx}`).check()
  await page.getByTestId('dqty-apply').click()

  await expect(page.getByTestId('dqty-msg'), '単価とロスは人が入れると案内').toContainText('ロス率は人が入れて')

  // 明細に数量が入る（★単価は入れない＝確定しない）
  const COLS = 'item_name,product_code,quantity,unit,unit_price'
  await expect.poll(async () => {
    const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=${COLS}`)
    return (items ?? []).filter((r: any) => String(r.item_name ?? '').includes('F-01')).length
  }, { timeout: 20000 }).toBe(1)

  const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=${COLS}`)
  const floor = items.find((r: any) => String(r.item_name ?? '').includes('F-01'))
  // ★品番の列に入るのは**メーカー品番**であって符号ではない。
  //  符号（F-01 / AD-1）はこの図面の中だけの記号なので、品番の列に入れても
  //  価格表・定価とは永久に当たらず、単価が一生埋まらない。
  //  （2026-08-19 本番レビュー: 実図面63件すべて単価0。メーカー品番が仕様の
  //    文章に埋もれ、品番の列が空だったのが原因）
  expect(floor.product_code, '★品番の列にはメーカー品番が入る').toBe('NT-31')
  expect(floor.item_name, '★符号は名称側に残す（どの図面のどれかを追えなくなるため）').toBe('床 F-01')
  expect(Number(floor.quantity), '凡例の面積がそのまま入る').toBe(21.3)
  expect(floor.unit).toBe('㎡')
  expect(Number(floor.unit_price) || 0, '★単価は入れない（確定しない）').toBe(0)
  // 選ばなかった天井は入っていない
  expect(items.some((r: any) => String(r.item_name ?? '').includes('C-01')), '選ばなかった行は入らない').toBe(false)
})

test('★図面に品番が無い行は、品番の列を符号で埋めない', async ({ page }) => {
  // ★これが無いと「符号を品番の列に入れる」実装に戻しても全テストが通ってしまう。
  //  実際 2026-08-19 に一度その向きで直してコミットしており、価格表と永久に
  //  当たらない値で品番の列を埋めるところだった。建具は図面に品番が無いことが多い。
  await runQuantityExtract(page, 'no-code', 6.95)

  await page.getByTestId('dqty-none').click()
  const rows = page.locator('[data-testid^="dqty-row-"]')
  const n = await rows.count()
  let idx = -1
  for (let i = 0; i < n; i++) {
    if ((await rows.nth(i).innerText()).includes('AD-1')) { idx = i; break }
  }
  expect(idx, '建具の行が見つかる').toBeGreaterThanOrEqual(0)
  await page.getByTestId(`dqty-pick-${idx}`).check()
  await page.getByTestId('dqty-apply').click()

  const COLS = 'item_name,product_code'
  await expect.poll(async () => {
    const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=${COLS}`)
    return (items ?? []).filter((r: any) => String(r.item_name ?? '').includes('AD-1')).length
  }, { timeout: 20000 }).toBeGreaterThanOrEqual(1)

  const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=${COLS}`)
  const door = items.find((r: any) => String(r.item_name ?? '').includes('AD-1'))
  expect(door.item_name, '符号は名称に残る').toBe('建具 AD-1')
  expect(String(door.product_code ?? ''), '★品番が無いなら空のまま（符号で埋めない）').toBe('')
})

test('★部位ごとに場所を分けて明細へ入れる（全部1つにまとめない）', async ({ page }) => {
  // 2026-08-19 本番レビュー: 実図面63件が全部1つの場所・1つの工種に入っていた。
  // 大塚さんの拾い方は 部位(天井→壁→床) → 工種 → 明細（打ち合わせ②の逐語）。
  // ★この1本が無いと「全部1つに詰める」実装に戻しても全テストが通ってしまう。
  await runQuantityExtract(page, 'grouped', 6.95)

  // 床(F-01) と 建具(AD-1) の2部位を選ぶ
  const rows = page.locator('[data-testid^="dqty-row-"]')
  const n = await rows.count()
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText()
    if (!t.includes('F-01') && !t.includes('AD-1')) await page.getByTestId(`dqty-pick-${i}`).uncheck()
  }
  await page.getByTestId('dqty-apply').click()

  await expect.poll(async () => {
    // ★画面上の「場所」は DB では note 列に入っている（estimate_items.note）
    const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name,note`)
    const f = (items ?? []).find((r: any) => String(r.item_name ?? '').includes('F-01'))
    const a = (items ?? []).find((r: any) => String(r.item_name ?? '').includes('AD-1'))
    return f && a ? `${f.note}/${a.note}` : ''
  }, { timeout: 20000 }).toBe('床/建具')
})

test('★1ページが504で落ちても他のページは取れ、そのページだけ再試行できる', async ({ page }) => {
  // 2026-08-18 通しレビュー: 実図面で 504 が出た。当時は1ページ失敗で break していたため、
  // 以降のページが丸ごと未処理のまま終わっていた（画面には途中までの結果だけが残る）。
  // ★「途中で落ちても残りは取れる」「落ちたページだけやり直せる」を固定する。
  let firstPageCalls = 0
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.page === 1) {
      firstPageCalls++
      // 1回目だけ落とす（再試行で回復することを見るため）
      if (firstPageCalls === 1) {
        await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: '解析エラー(504)' }) })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, page: 1, gridSpanX: 10.2, gridSpanY: 6.95, ceilingHeights: [],
          parts: [{ part: '天井', rows: [{ code: 'C-01', spec: '再試行で取れた', value: 71.0, unit: '㎡' }] }] }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, page: body.page, gridSpanX: null, gridSpanY: null, ceilingHeights: [],
        parts: [{ part: '床', rows: [{ code: 'F-01', spec: '2ページ目は取れる', value: 21.3, unit: '㎡' }] }] }),
    })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_retry_${TS}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-panel"]')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="dqty-busy"]')).toHaveCount(0, { timeout: 40000 })

  // ★2ページ目は取れている（1ページ目の失敗で全体が止まっていない）
  await expect(page.locator('[data-testid="dqty-panel"]'), '★落ちたページ以外は取れる').toContainText('2ページ目は取れる')
  // 失敗ページが提示されている
  const failed = page.locator('[data-testid="dqty-failed-pages"]')
  await expect(failed, '★失敗ページが分かる').toBeVisible()
  await expect(failed).toContainText('P.1')

  // 再試行するとそのページだけ取り直せて、失敗一覧から消える
  await page.locator('[data-testid="dqty-retry-page"]').click()
  await expect(page.locator('[data-testid="dqty-panel"]'), '★再試行で取れる').toContainText('再試行で取れた', { timeout: 20000 })
  await expect(failed, '★直ったら失敗一覧から消える').toHaveCount(0, { timeout: 10000 })
})

test('★解析中は他のタブに移っても進捗が見え、離脱しようとすると確認が出る', async ({ page }) => {
  // 2026-08-18 通しレビュー:
  //  - タブを移ると進捗が見えなくなり、進んでいるのか分からなかった
  //  - 解析中にブラウザバックしたら解析がリセットされた（やり直しになった）
  // ★数量抽出はブラウザの中で走るので、離れると本当に消える。だから確認を出す。

  // 1ページ目の応答を保留して「解析中」を作る
  let release: (() => void) | null = null
  const held = new Promise<void>(r => { release = r })
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.page === 1) await held
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, page: body.page, gridSpanX: null, gridSpanY: null, ceilingHeights: [], parts: [] }),
    })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_guard_${TS}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()

  // ★他のタブへ移っても進捗が見える
  await page.locator('[data-testid="tab-items"]').click()
  await expect(page.locator('[data-testid="dqty-progress-chip"]'),
    '★どのタブに居ても解析中だと分かる').toBeVisible({ timeout: 20000 })

  // ★離脱しようとすると確認が出る（キャンセルすれば留まる）
  // ★画面内のリンクで試す。page.goto はページ全体の再読み込みになり、
  //  ルーターの離脱ガードを通らない（＝何も検証できない）。
  let asked = ''
  page.once('dialog', d => { asked = d.message(); d.dismiss() })
  await page.locator('[data-testid="back-to-list"]').click()
  await page.waitForTimeout(800)
  expect(asked, '★解析が消えることを伝えてから移動させる').toMatch(/中断/)
  await expect(page, '★キャンセルしたら留まる').toHaveURL(/estimate-builder/)

  release?.()
})

test('★抽出結果はページを移っても残り、AIを呼び直さずに戻ってくる', async ({ page }) => {
  // 2026-08-18 本番の通しレビュー: 数量抽出の結果はブラウザのメモリだけで、
  // 明細タブへ移って戻るだけで消え、また解析からやり直しになっていた。
  // 解析はAIを呼ぶので時間も費用もかかる。それを毎回捨てていた。
  let calls = 0
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    calls++
    const body = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, page: body.page, gridSpanX: 10.2, gridSpanY: 6.95, ceilingHeights: [],
        parts: [{ part: '天井', rows: [{ code: `SAVE-${body.page}`, spec: '保存確認', value: 35.5, unit: '㎡' }] }] }),
    })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_save_${TS}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)

  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-busy"]')).toHaveCount(0, { timeout: 40000 })
  await expect(page.locator('[data-testid="dqty-panel"]')).toContainText('SAVE-1')
  const callsAfterFirst = calls
  expect(callsAfterFirst, '1回目は解析している').toBeGreaterThan(0)

  // ★DBに残っていること（画面の状態だけで判断しない）
  const saved = await restSrv(`estimate_drawing_extract_jobs?attachment_id=eq.${att[0].id}&kind=eq.quantity&select=status,rows`)
  expect(saved.length, '★抽出結果がDBに保存される').toBe(1)
  expect(JSON.stringify(saved[0].rows), '中身も入っている').toContain('SAVE-1')

  // ページを完全に離れて戻る
  await page.goto('/estimate-list', { waitUntil: 'networkidle' })
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')

  // ★押す前に「前回の結果がある」と分かること。結果は保存されているのに押すまで
  //  何も見えないと「消えた」としか見えない（2026-08-19 通しレビューでの指摘）。
  await expect(page.locator(`[data-testid="dqty-open-${att[0].id}"]`), '★保存済みだとボタンで分かる')
    .toContainText('前回', { timeout: 20000 })

  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-panel"]'), '★前回の結果が出る').toContainText('SAVE-1', { timeout: 20000 })
  await expect(page.locator('[data-testid="dqty-saved-note"]'), '前回分だと分かる').toBeVisible()
  expect(calls, '★AIを呼び直していない（時間も費用もかけ直さない）').toBe(callsAfterFirst)
})

