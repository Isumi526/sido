// ============================================================
//  admin.invoice-vendor-match-fill-down.spec.ts
//  協力業者請求 — 事務員（尾崎さん）からの2件（2026-09-04）:
//
//  1️⃣「日付や現場が全明細で同じとき、1行ずつプルダウンで選ばずに上段から下段へコピーしたい」
//     → 明細ヘッダの「↓全行」で1行目の値を以降の全行へコピーできること。
//
//  2️⃣「登録済みの業者なのに自動で反映されることがほぼない。登録の仕方が間違っている？」
//     → 登録方法の問題ではなく照合の不具合だった。マスタは `(株)◯◯` の略記で登録され
//       （本番実測: 175社中74社）、請求書PDFには `株式会社◯◯` と正式表記で書かれるため、
//       完全一致では当たらなかった。一致しないと「＋新規業者を登録」に流れるので、
//       `(株)アサヒ` と `株式会社アサヒ` のような重複マスタが16組32件できていた。
//       → normVendor による名寄せ（NFKC＋法人格・記号除去）で拾えるようにした。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const VENDOR_ABBREV = `(株)E2Eアサヒ${TS}`     // マスタ側＝略記で登録（本番の多数派）
const SITE_A = `E2E請求現場A_${TS}`
const SITE_B = `E2E請求現場B_${TS}`

let accountId = ''
let vendorId = ''
let siteAId = ''
let siteBId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const [v] = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VENDOR_ABBREV, active: true }),
  })
  vendorId = v.id
  const made = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { account_id: accountId, name: SITE_A, active: true },
      { account_id: accountId, name: SITE_B, active: true },
    ]),
  })
  siteAId = made.find((s: any) => s.name === SITE_A).id
  siteBId = made.find((s: any) => s.name === SITE_B).id
})

test.afterAll(async () => {
  await restSrv(`sites?id=in.(${siteAId},${siteBId})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${vendorId}`, { method: 'DELETE' }).catch(() => {})
})

test('★1️⃣ 明細の「↓全行」で、1行目の日付・現場が下の行すべてにコピーされる', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(1000)

  // 明細を3行用意する
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /行を追加/ }).first().click()
    await page.waitForTimeout(200)
  }
  const dates = page.locator('input.inp-date')
  const siteSelects = page.locator('select.inp-site')
  await expect(dates).toHaveCount(3)

  // 1行目だけ入力し、2・3行目は別の値／未選択のままにしておく
  await dates.nth(0).fill('2026-07-31')
  await siteSelects.nth(0).selectOption(siteAId)
  await dates.nth(1).fill('2026-01-05')
  await siteSelects.nth(1).selectOption(siteBId)

  await page.getByTestId('fill-down-date').click()
  await page.getByTestId('fill-down-site').click()
  await page.waitForTimeout(200)

  for (const i of [1, 2]) {
    await expect(dates.nth(i), `★${i + 1}行目の日付が1行目と同じになる`).toHaveValue('2026-07-31')
    await expect(siteSelects.nth(i), `★${i + 1}行目の現場が1行目と同じになる`).toHaveValue(siteAId)
  }
})

test('★1️⃣ 1行目が空のときは「↓全行」で下の行を空にしない（誤操作で入力を消さない）', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(1000)
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /行を追加/ }).first().click()
    await page.waitForTimeout(200)
  }
  const dates = page.locator('input.inp-date')
  const siteSelects = page.locator('select.inp-site')

  // 1行目は空・2行目に値が入っている状態（「—」は :value="null" バインドなのでラベルで選ぶ）
  await dates.nth(0).fill('')
  await siteSelects.nth(0).selectOption({ label: '—' })
  await dates.nth(1).fill('2026-07-31')
  await siteSelects.nth(1).selectOption(siteBId)

  await page.getByTestId('fill-down-date').click()
  await page.getByTestId('fill-down-site').click()
  await page.waitForTimeout(200)

  await expect(dates.nth(1), '★2行目の日付が空で潰されない').toHaveValue('2026-07-31')
  await expect(siteSelects.nth(1), '★2行目の現場が空で潰されない').toHaveValue(siteBId)
})

test('★2️⃣ 業者名の名寄せ: 請求書の「株式会社◯◯」がマスタの「(株)◯◯」に一致する', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })

  // AI解析の戻り値そのもの（vendor_name）を画面の照合ロジックへ流し、
  // 実際に registered 済みマスタが選ばれるかを確認する。
  // ★ここで検証したいのは「AIが読んだ表記ゆれをマスタへ名寄せできるか」なので、
  //  外部APIに依存しないよう解析EFの応答だけを差し替える（照合ロジックは本物）。
  await page.route('**/functions/v1/*analyze-invoice', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        vendor_name: `株式会社E2Eアサヒ${TS}`,     // 請求書には正式表記で書かれている
        invoice_date: '2026-07-31',
        items: [{ description: 'テスト明細', amount: 1000, tax_rate: 10 }],
      }),
    })
  })

  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(1000)

  // ファイルを1枚渡してAI解析を実行（応答は上のrouteで差し替え済み）
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test'),
  })
  await page.getByRole('button', { name: /AI解析/ }).first().click()

  const vendorSelect = page.locator('select.inp').first()
  await expect(vendorSelect, '★「株式会社◯◯」で登録済みの「(株)◯◯」が自動選択される')
    .toHaveValue(vendorId, { timeout: 15000 })
  // 新規業者の登録欄が開いていない＝重複マスタを作りに行っていない
  await expect(page.locator('.new-vendor'), '★新規登録欄は開かない（重複マスタを作らない）').toHaveCount(0)
})
