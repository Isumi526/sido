// ============================================================
//  liff.no-account.spec.ts （dev モード）
//  身元が解決できない時の行き止まり画面（2026-09-09・LINE認証撤去 Phase 1）
//
//  ★背景
//   作業員が自分で workers 行を作る /register（自己登録）を廃止した。
//   新規ユーザーは管理画面でメール/パスワードを発行して作る運用に変わったため、
//   「自分で自分を登録する」経路は不要かつ権限の入口でもあった。
//
//  ★このspecが固定すること
//   1. /register は残っていない（自己登録画面が復活していない）
//   2. /login へ自動で飛ばさない ＝ ログイン済みの人が入口へ戻されて
//      また弾かれる無限ループを作らない（変異テスト済み：リダイレクトを足すと落ちる）
//
//  ★ここで見られないこと
//   app.vue の isExempt に /no-account を入れた効果（LINEログイン誘導を挟まない）は
//   dev モードだと LIFF 初期化自体がスキップされるので再現できない。
//   外しても通ってしまうことを確認済み＝この spec は exempt の番人ではない。
// ============================================================
import { test, expect } from '@playwright/test'

test.describe('身元が解決できない時の案内', () => {
  test('★/register は廃止されている（自己登録が復活していない）', async ({ page }) => {
    // liff は SPA(ssr:false)なので HTTP は常に 200。ルートの有無は描画で見る。
    await page.goto('/register', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    // 旧・自己登録画面の中身（本名を選ばせて workers を作る UI）が出ないこと
    await expect(page.locator('body'), '自己登録フォームが復活していない')
      .not.toContainText('ユーザー登録')
    await expect(page.locator('body'), '本名の選択UIが残っていない')
      .not.toContainText('一覧にない場合は新規登録できます')
  })

  test('★/no-account はそのまま表示され、/login へ飛ばされない', async ({ page }) => {
    await page.goto('/no-account', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('no-account'), 'LIFF初期化待ちで白画面にならない')
      .toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('no-account'), '次に取るべき行動が書いてある')
      .toContainText('管理者')
    // ★勝手に /login へ遷移しない（セッションを持つ人がループするため）
    await page.waitForTimeout(2000)
    expect(new URL(page.url()).pathname, '自動遷移しない').toBe('/no-account')
    // 自分で選べば /login には行ける
    await expect(page.getByTestId('no-account-login')).toHaveAttribute('href', '/login')
  })
})
