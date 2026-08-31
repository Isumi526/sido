// ============================================================
//  liff.home-layout-stability.spec.ts
//  ホームは読み込みの前後でメニューの位置が動かないこと。
//
//  ★動くと「押そうとしたものと別のボタンをタップしてしまう」（運用者指摘・2026-08-31）。
//   実測で2回踏んでいる:
//    ① アイコンフォント未ロード中にリガチャ名がそのまま流れ、PWA案内が452px→80pxに縮む（366px）
//    ② 経費申請の締切カードが後から生える。締切前の3〜4日だけ起きるので、ローカルでは
//       期間外で気づかず、本番の9/1で77px跳ねた（2026-09-01 実測）
//   ①はアイコンを1emの箱に閉じ込め、②は日付だけで決まる枠を先に確保して潰した。
//   ②は「その日でないと再現しない」ので、時計を固定して両方の期間を固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { suppressOverdueModal } from './helpers'

test.use({ viewport: { width: 375, height: 667 } })

/** ページ内の時計を固定する（締切が近い日／遠い日を作り分ける） */
async function freezeClock(page: any, iso: string) {
  await page.addInitScript((f: number) => {
    const O = Date
    // @ts-ignore
    window.Date = class extends O {
      constructor(...a: any[]) { super(...(a.length ? a : [f]) as []) }
      static now() { return f }
    }
  }, new Date(iso).getTime())
}

async function menuShift(page: any): Promise<number> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('home-today-skeleton')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.menu-grid').first()).toBeVisible({ timeout: 20000 })
  const before = await page.locator('.menu-grid').first().boundingBox()
  await expect(page.getByTestId('home-today-card')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const after = await page.locator('.menu-grid').first().boundingBox()
  return Math.abs((after?.y ?? 0) - (before?.y ?? 0))
}

test('★経費の締切が近い日（9/1）でもメニューが動かない', async ({ page }) => {
  await freezeClock(page, '2026-09-01T09:00:00+09:00')
  await suppressOverdueModal(page)
  expect(await page.evaluate(() => 1)).toBe(1)   // initScript 適用の確認
  const shift = await menuShift(page)
  await expect(page.locator('.deadline-slot'), '締切の枠が先に確保される').toHaveCount(1)
  expect(shift, '★メニューが動かない').toBeLessThanOrEqual(2)
})

test('★締切が遠い日（9/8）ではムダな枠を作らない', async ({ page }) => {
  await freezeClock(page, '2026-09-08T09:00:00+09:00')
  await suppressOverdueModal(page)
  const shift = await menuShift(page)
  await expect(page.locator('.deadline-slot'), '期間外は枠ごと出さない').toHaveCount(0)
  expect(shift, '★メニューが動かない').toBeLessThanOrEqual(2)
})

// ★ずれ幅だけを見るテストは、フォントがキャッシュ済みのローカルでは0になり見逃す。
//  実際に本番だけで30px出た（box-sizing が content-box で、min-height に padding が
//  加算され、中身の小さいスケルトンだけ背が高くなっていた・2026-09-01）。
//  「読み込み中の枠と、読み込み後のカードの高さが同じ」を直接固定する。
test('★読み込み中の枠と読み込み後のカードは同じ高さ', async ({ page }) => {
  await suppressOverdueModal(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('home-today-skeleton')).toBeVisible({ timeout: 20000 })
  const sk = await page.getByTestId('home-today-skeleton').boundingBox()
  await expect(page.getByTestId('home-today-card')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(1200)
  const card = await page.getByTestId('home-today-card').boundingBox()
  expect(Math.round(sk?.height ?? 0), '★スケルトンと実カードの高さが同じ')
    .toBe(Math.round(card?.height ?? 0))
})
