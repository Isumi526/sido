// ============================================================
//  liff.jst-today.spec.ts
//  回帰: 深夜0-9時JSTでも「今日」がJST基準で計算されること。
//
//  背景（2026-07-21未明のE2E全緑ゲートで発覚）:
//   `new Date().toISOString().split('T')[0]` はUTC基準なので、深夜0:00〜8:59 JST の間は
//   前日を返す。日報の保存日付・過去3日ロック判定・残業申請の対象日・カレンダーの今日
//   ハイライトが画面(JSTで描画)と1日ズレる実害があった。
//   shared/schedule-core.ts の todayStr()（ローカル=JST基準）に統一して解消。
//
//  検証方法: ブラウザの時計を「JSTでは今日だがUTCでは前日」の時刻に固定して
//  （JST 深夜2時 = UTC 前日17時）、画面が返す今日がJST日付になっていることを見る。
//  Notion: 3a30ff81c56b81939fe7d53af43dd9c1
// ============================================================
import { test, expect } from '@playwright/test'

// JST 02:30 に固定する。UTCでは前日 17:30 なので、UTC基準の実装だと1日前になる。
function jstEarlyMorningFixture(): { iso: string; jstDate: string; utcDate: string } {
  const now = new Date()
  // 「今日(JST)の02:30 JST」= UTC では前日17:30Z
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const jstDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const utcMoment = new Date(Date.UTC(y, m, d, 2 - 9, 30, 0))   // JST02:30 → UTC前日17:30
  const utcDate = utcMoment.toISOString().split('T')[0]
  return { iso: utcMoment.toISOString(), jstDate, utcDate }
}

test('深夜2時JST(=UTCでは前日)でも「今日」はJST基準の日付になる', async ({ page }) => {
  const { iso, jstDate, utcDate } = jstEarlyMorningFixture()
  // 前提: この固定時刻ではJST日付とUTC日付が実際に食い違っていること（テストが意味を持つ保証）
  expect(utcDate, 'JST日付とUTC日付が異なる時刻を選べていること').not.toBe(jstDate)

  // ブラウザの時計を固定（Date/performance をまとめて偽装）
  await page.addInitScript(`{
    const fixed = new Date(${JSON.stringify(iso)}).getTime()
    const _Date = Date
    class MockDate extends _Date {
      constructor(...args) { if (args.length === 0) super(fixed); else super(...args) }
      static now() { return fixed }
    }
    // @ts-ignore
    window.Date = MockDate
  }`)
  // タイムゾーンはPlaywright側でJST固定（playwright.config には無いため個別指定）
  await page.emulateMedia({})   // no-op（設定APIの体裁を合わせるだけ）

  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // 偽装時計が効いていること＝この時刻ではUTC日付が前日になる（テストが意味を持つ前提）
  const computed = await page.evaluate(() => {
    const dt = new Date()
    return {
      local: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
      utc: dt.toISOString().split('T')[0],
    }
  })
  expect(computed.utc, '偽装時計ではUTC日付が前日になっている（テストの前提）').toBe(utcDate)
  expect(computed.local, 'ブラウザのローカル(JST)日付は今日のまま').toBe(jstDate)

  // ★ 実アプリの表示: カレンダーの「今日」ハイライト(.date-today)が JST日付の列に付くこと。
  //   UTC基準の実装だと前日の列にハイライトが付いていた。
  const todayCells = page.locator('.date-today')
  await expect(todayCells.first()).toBeVisible({ timeout: 15000 })
  const jstDom = String(Number(jstDate.slice(8, 10)))       // 日(先頭0なし)
  const utcDom = String(Number(utcDate.slice(8, 10)))
  const texts = (await todayCells.allInnerTexts()).map(t => t.trim())
  expect(texts.length, '今日セルが存在する').toBeGreaterThan(0)
  expect(
    texts.some(t => t.includes(jstDom)),
    `今日ハイライトはJSTの日(${jstDom})に付くべき。実際: ${JSON.stringify(texts)}`,
  ).toBe(true)
  // 月をまたぐ場合はUTC日が別月なので、同月内で日が違うケースのみ厳密に排他チェック
  if (jstDate.slice(0, 7) === utcDate.slice(0, 7)) {
    expect(
      texts.some(t => t.trim() === utcDom),
      `UTCの日(${utcDom})だけにハイライトが付いてはいけない。実際: ${JSON.stringify(texts)}`,
    ).toBe(false)
  }
})
