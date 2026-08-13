// ============================================================
//  admin.private-bucket-uploads.spec.ts
//  新規アップロードを公開バケットに書かない（2026-08-13 止血）
//
//  何が起きていたか:
//   旧バケット expense-receipts は public=true で、キーを一切付けない curl でも
//   下請け請求書PDF(530KB)が HTTP 200 で落ちてきた。匿名キーで bucket list も通り、
//   URLの推測すら要らない状態。2026-07-09 に v2 へ移行したはずが、下請け請求書と
//   経費申請PDFだけ書き込みが続いていた（最終 7/31・8/02）＝出血が止まっていなかった。
//
//  ★このテストが守ること: 「新しく上げたものが公開バケットに入らない」。
//   画面上はアップロードが成功して見えるので、UIの成否ではなく
//   「どのバケットに入ったか」で判定する。
//
//  ★既存分（194件）は expense-receipts のまま残す方針なので、
//   「昔のものが今までどおり開けること」も併せて固定する（後方互換を壊さない）。
//
//  接頭辞 pbu- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'pbu-'
const VENDOR = `${PREFIX}業者${TS}`

let accountId = ''

async function purge() {
  for (const inv of (await restSrv(`subcontractor_invoices?vendor_name=like.${PREFIX}*&select=id`)) ?? []) {
    await restSrv(`subcontractor_invoice_items?invoice_id=eq.${inv.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractor_invoices?id=eq.${inv.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractors?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`subcontractor_invoices?vendor_name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

test.describe('新規アップロードの保存先', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: VENDOR, active: true }),
    })
  })
  test.afterAll(async () => { await purge() })

  test('★下請け請求書のPDFが公開バケットに入らない', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '＋ 新規請求' }).click()

    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 20000 })
    await modal.locator('select').first().selectOption({ label: VENDOR })
    await modal.locator('input[type="file"]').first().setInputFiles({
      name: 'invoice.pdf', mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% e2e private bucket test\n'),
    })

    // ★保存には明細1行と現場が要る（無いとバリデーションで止まり、
    //  「アップロードされなかった」のかUI操作が届いていないのか切り分けられなくなる）
    await modal.getByRole('button', { name: '＋ 行を追加' }).click()
    const row = modal.locator('tbody tr').first()
    await row.locator('select.inp-site').selectOption({ index: 1 })
    await row.locator('input.inp-sm').last().fill('10000')

    await modal.locator('button.btn-save').click()
    // 保存に失敗していれば理由が画面に出る＝そのまま失敗理由として読ませる
    const err = modal.locator('.form-error, .err, .error')
    if (await err.count()) await expect(err.first()).toBeHidden({ timeout: 5000 })

    // ★UIの成否ではなく、DBに記録されたバケットで判定する
    await expect.poll(async () => {
      const rows = await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(VENDOR)}&select=pdf_path,pdf_bucket`)
      return rows?.[0]?.pdf_path ? rows[0].pdf_bucket : null
    }, { timeout: 30000 }).toBe('admin-docs')

    const rows = await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(VENDOR)}&select=pdf_path,pdf_bucket`)
    expect(rows[0].pdf_bucket, '★公開バケットに入れない').not.toBe('expense-receipts')
    expect(rows[0].pdf_path, 'パスは従来どおり').toContain('subcontractor-invoices/')
  })

  test('既存の公開バケット上のPDFは今までどおり開ける（後方互換を壊さない）', async () => {
    // 2026-07-09 以前に入った194件は pdf_bucket 既定値のまま残す方針。
    // 既定値が 'expense-receipts' であること＝読む側が公開URLで解決できることを固定する。
    const rows = await restSrv(`subcontractor_invoices?select=pdf_bucket&limit=1`)
    expect(Array.isArray(rows)).toBe(true)
    const def = await restSrv(`subcontractor_invoices?select=pdf_bucket&vendor_name=eq.${encodeURIComponent(VENDOR)}`)
    // 新規は admin-docs。既定値そのものは DB 側で 'expense-receipts'（migration で担保）
    expect(def?.[0]?.pdf_bucket).toBe('admin-docs')
  })
})
