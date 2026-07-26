// ============================================================
//  liff.report-draft-worker-id.spec.ts （dev モード）
//  回帰: 下書き復元経路で workers[].workerId が空のまま送信されないこと。
//
//  背景（2026-07-25 本番スモークで発覚）:
//   workerId を明示セットする修正(85ae04c)を本番反映した後も、デプロイ前に保存された
//   下書きから復元すると `report.form.value = d.form` が workerId='' を丸ごと持ち上げ、
//   空IDのまま保存されていた（本番シードで実レコードを確認）。
//   workerId が無いと現場別集計が workerName の完全一致フォールバックに依存し、
//   マスタ名を変更した瞬間に人件費0円化する（元バグの再発経路）。
//  → handleSubmit の fillMissingWorkerIds() で保存直前に一括補完する対策のガード。
//
//  ※ page.evaluate に「文字列のアロー関数」を渡すと関数は呼ばれず undefined が返る
//    （Playwrightは式として評価するだけ）。必ず実関数を渡すこと。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

const DRAFT_PREFIX = 'sido:report-draft'

test('下書き復元で workerId が空でも、送信時に補完されて保存される', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  await page.evaluate((p) => {
    Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => localStorage.removeItem(k))
  }, DRAFT_PREFIX)
  await page.reload({ waitUntil: 'networkidle' })

  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場を選んで下書きを保存させる
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(1300)   // 800ms デバウンス + 余裕

  // 送信対象日は下書きキー(`sido:report-draft:v1:<userId>:<date>`)の末尾から取る
  const targetDate = await page.evaluate((p) => {
    const k = Object.keys(localStorage).find(x => x.startsWith(p))
    return k ? k.split(':').pop() : ''
  }, DRAFT_PREFIX)
  expect(targetDate, '下書きが保存され日付が取れること').toBeTruthy()

  // ★ 下書きの workerId を空に改変（=デプロイ前に保存された下書き相当）
  const touched = await page.evaluate((p) => {
    let n = 0
    for (const k of Object.keys(localStorage).filter(x => x.startsWith(p))) {
      const d = JSON.parse(localStorage.getItem(k)!)
      for (const s of (d?.form?.sites ?? [])) {
        for (const w of (s.workers ?? [])) { w.workerId = ''; n++ }
      }
      localStorage.setItem(k, JSON.stringify(d))
    }
    return n
  }, DRAFT_PREFIX)
  expect(touched, '下書きに workers エントリが1件以上あること').toBeGreaterThan(0)

  // リロード → 空IDの下書きが復元される
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })
  await expect(page.locator('.draft-banner')).toBeVisible({ timeout: 8000 })

  // 復元直後は確かに workerId が空（=この回帰テストが本当にバグ経路を再現している証拠）
  const restoredBlank = await page.evaluate((p) => {
    const k = Object.keys(localStorage).find(x => x.startsWith(p))
    const d = JSON.parse(localStorage.getItem(k!)!)
    return (d?.form?.sites ?? []).flatMap((s: any) => s.workers ?? []).every((w: any) => !w.workerId)
  }, DRAFT_PREFIX)
  expect(restoredBlank, '復元元の下書きは workerId が空であること').toBe(true)

  // 送信（記入忘れ確認チェックが必須）
  await page.locator('.submit-confirm input[type="checkbox"]').check()
  await page.locator('button[type="submit"].btn-submit').click()
  await expect(page.getByText(/送信完了|更新しました/)).toBeVisible({ timeout: 20000 })

  // ── 保存結果を検証: workerId が空でなく、workers マスタの id と一致する ──
  const accountId = await getAccountId()
  const wrows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const expectedWorkerId = wrows?.[0]?.id
  expect(expectedWorkerId, 'seed worker が存在すること').toBeTruthy()

  const reports = await rest(`daily_reports?account_id=eq.${accountId}&date=eq.${targetDate}&select=sites,date&order=updated_at.desc&limit=1`)
  const saved = reports?.[0]
  expect(saved, `${targetDate} の日報が保存されていること`).toBeTruthy()

  const savedWorkers = (saved.sites ?? []).flatMap((s: any) => s.workers ?? [])
  expect(savedWorkers.length, '保存された workers が1件以上').toBeGreaterThan(0)
  for (const w of savedWorkers) {
    expect(w.workerId, `workerId が空でない (workerName=${w.workerName})`).toBeTruthy()
    expect(w.workerId).toBe(expectedWorkerId)
  }

  await page.evaluate((p) => {
    Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => localStorage.removeItem(k))
  }, DRAFT_PREFIX)

  // 後始末: 作成した日報を消して未送信日を解放する。
  // 編集可能windowは3日しか無く(useReportLock)、ここで1日消費したままにすると
  // 同じフルランの他の送信系spec(liff.report.spec.ts:8 等)が「送信済みです」で枯渇してflakyになる。
  await rest(`daily_reports?account_id=eq.${accountId}&date=eq.${targetDate}`, { method: 'DELETE' }).catch(() => {})
})
