// ============================================================
//  liff.expense-application-pdf-saved.spec.ts （dev モード）
//  申請書PDFが本当に保存される（2026-09-09・佐谷さんの報告）
//
//  ★背景
//   佐谷さん「7月分の経費申請した書類は見れなくなっていますか？」
//   調べると期間の選択肢の問題（修正済み）とは別に、**PDF自体が保存されていなかった**。
//     2026-06-second 5/5 → 2026-07 2/5・2/5 → 2026-08 0/6・0/4
//   保存先 admin-docs のRLSは4つとも authenticated 限定で、LINEから開いた作業員は
//   Supabase セッションを持たない＝anon になり upload が必ず 4xx。
//   さらに download.vue が catch で握りつぶしていたため、申請だけ成功して
//   pdf_path が NULL になり、3ヶ月誰も気づかなかった。
//
//  ★このspecが固定すること
//   1. 申請すると admin-docs に実体が置かれる（＝保存経路が生きている）
//   2. expense_settlements.pdf_path にそのパスが入る
//   どちらも「申請ステータスが申請済みになった」だけでは分からない。
//   ステータスだけ見る既存specは、この3ヶ月ずっと green のままだった。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, ACCOUNT_SLUG, downloadStorage, SUPABASE_URL, SERVICE_ROLE_KEY } from './helpers'
import { FEAT_EXP_PERIOD } from './global-setup'

const BUCKET = 'admin-docs'
const PERIOD_LABEL = (() => {
  const [, m] = FEAT_EXP_PERIOD.split('-')
  return `${parseInt(m, 10)}月後半`
})()

let userId = ''

/** 規約パス（管理画面 expenses.vue・申請メールEFがこの形で読む） */
const pdfPath = (kind: 'meisai' | 'seikyu') =>
  `expense-applications/${ACCOUNT_SLUG}/${userId}/${FEAT_EXP_PERIOD}_${kind}.pdf`

test.beforeAll(async () => {
  userId = (await getDevUserId()) || ''
  expect(userId, 'dev-user-id の users 行がある').toBeTruthy()
})

test.beforeEach(async () => {
  // 未申請へ戻す＋前回の実体を消す（「前回の残骸で通った」を防ぐ）
  await rest(`expense_settlements?user_id=eq.${userId}&period_key=eq.${FEAT_EXP_PERIOD}`, { method: 'DELETE' }).catch(() => {})
  for (const k of ['meisai', 'seikyu'] as const) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pdfPath(k)}`, {
      method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }).catch(() => {})
  }
})

test.describe('申請書PDFの保存', () => {
  test('★申請すると admin-docs に PDF の実体が置かれ、pdf_path に記録される', async ({ page }) => {
    // 事前に「無い」ことを確かめる（後の toBeTruthy が残骸で通らないように）
    expect((await downloadStorage(BUCKET, pdfPath('meisai'))).data, '申請前は存在しない').toBeNull()

    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: /経費を申請する/ }).click()
    await page.getByTestId('apply-comment').fill('E2E: PDF保存の確認')
    await page.locator('.confirm-ok').click()
    await expect(page.locator('.status-bar')).toContainText('申請済み', { timeout: 30000 })

    // ★保存に失敗していれば画面に警告が出る（黙って落とさない）
    await expect(page.getByTestId('pdf-warning'), 'PDF保存の警告が出ていない').toHaveCount(0)

    // ★実体があること。ここが本題（ステータスだけ見ても分からない）
    const saved = (await downloadStorage(BUCKET, pdfPath('meisai'))).data
    expect(saved, '★明細PDFの実体が admin-docs にある').toBeTruthy()
    expect(saved!.startsWith('%PDF'), 'PDFとして壊れていない').toBe(true)

    // ★DBにもパスが残る（管理画面のリンクはこれを見る）
    const rows = await rest(`expense_settlements?user_id=eq.${userId}&period_key=eq.${encodeURIComponent(FEAT_EXP_PERIOD)}&select=pdf_path`)
    expect(rows?.[0]?.pdf_path ?? '', '★pdf_path が空でない').toContain('_meisai.pdf')
  })
})
