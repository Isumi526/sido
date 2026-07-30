// ============================================================
//  liff.no-admin-page.spec.ts
//  LIFF に権限チェック無しの管理画面 /admin が存在していた問題の回帰防止。
//
//  何が起きていたか（2026-07-31 の権限棚卸しで発見）:
//   apps/liff/pages/admin/index.vue には useWorkerPermission / definePageMeta /
//   middleware が1つも無く、メニュー導線は無いものの URL 直打ちで到達でき、
//   worker を含む全員が
//     - 会社全体の月次経費合計・カテゴリ別内訳
//     - users.select('*')（LINE userId 含む全カラム）
//     - 直近500件の日報
//     - settings.select('*') ＋ saveSettings() による単価マスタの更新
//   に到達できた。admin 側に同等機能が揃っている孤児ページのため削除した。
//
//  ★このspecは「復活させない」ための番人。再追加するなら必ず権限ガードを付けること。
// ============================================================
import { test, expect } from '@playwright/test'

test('LIFFの /admin に管理画面の中身が出ない（作業員が全社集計・設定に到達できない）', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  // ※Nuxt(SPA)は未知パスでも 200 ＋ アプリシェルを返すため、ステータスでは判定しない。
  //  「管理画面の中身が描画されないこと」を見る。
  const body = await page.locator('body').innerText().catch(() => '')

  // 削除した画面固有の要素（タブ・保存ボタン・集計カード）が出ないこと
  expect(body, '管理タブが出てはいけない').not.toContain('ダッシュボード')
  expect(body, '設定の保存UIが出てはいけない').not.toContain('設定を保存')
  await expect(page.locator('.btn-save'), '設定保存ボタンが無い').toHaveCount(0)

  // 会社全体の金額集計（¥付きの合計カード）が出ていないこと
  await expect(page.locator('.dash-total, .stat-value'), '全社集計カードが無い').toHaveCount(0)
})
