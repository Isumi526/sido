// ============================================================
//  admin.month-nav.spec.ts
//  月ナビ（‹ 年月 ›）が月を飛ばさないことの回帰防止。
//  2026-07-31 に 経費 日毎集計 で発覚: shiftMonth が日を1日へ丸めずに月を加算して
//  いたため、月末31日に開くと「8月31日+1ヶ月＝9月31日」→10月1日 となり9月が飛んだ。
//
//  ★検証は「月が1つずつ連続して進むこと」。特定の月を期待しないので日付に依存せず
//   flake しない。31日など月末に実行した日は、この不具合をそのまま検出する。
//   （Date差し替え/clock固定はページの読み込みを壊すため使わない）
// ============================================================
import { test, expect } from '@playwright/test'

const PAGES = [
  { path: '/expenses-daily', name: '経費 日毎集計' },
  { path: '/expenses',       name: '経費管理' },
  { path: '/site-reports',   name: '現場別集計' },
  { path: '/worker-reports', name: '出面・勤怠' },
]

// 「2026年9月」→ 通し月数（年*12+月）に変換して連続性を見る
function monthIndex(label: string): number {
  const m = label.match(/(\d{4})年\s*(\d{1,2})月/)
  if (!m) throw new Error(`月ラベルを解釈できない: ${label}`)
  return Number(m[1]) * 12 + Number(m[2])
}

for (const p of PAGES) {
  test(`${p.name}: 月送りが月を飛ばさない`, async ({ page }) => {
    await page.goto(p.path, { waitUntil: 'networkidle' })
    await expect(page.locator('.month-label')).toBeVisible({ timeout: 15000 })

    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      seen.push((await page.locator('.month-label').innerText()).trim())
      await page.locator('.month-nav .btn-nav').nth(1).click()
      await page.waitForTimeout(400)
    }

    for (let i = 1; i < seen.length; i++) {
      expect(
        monthIndex(seen[i]) - monthIndex(seen[i - 1]),
        `${p.name} の月送りが連続しない: ${seen.join(' → ')}`,
      ).toBe(1)
    }
  })
}
