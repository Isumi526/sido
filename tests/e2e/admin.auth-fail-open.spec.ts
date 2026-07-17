// ============================================================
//  admin.auth-fail-open.spec.ts
//  セキュリティ回帰: worker行が無い/リンク切れの認証ユーザーが「純粋admin(オーナー)」として
//  全権限を得てしまうフェイルオープンの修正(回答B)。
//  修正後: worker行0件のユーザーは、accounts.owner_auth_user_id に一致する時だけオーナー扱い。
//  非一致(=事故で紐付けが切れた/退職者/未リンク)は最小権限(worker)へ倒し、管理画面に入れない。
//  ※ この account の owner は global-setup で e2e ユーザーに設定済み。本ユーザーは owner ではない。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, DB_URL } from './helpers'

const EMAIL = 'noworker.failsafe.e2e@email.com'
const ID = 'noworker.failsafe.e2e'
const PASS = 'noworker-failsafe-1234'

// この spec はログアウト状態から検証する（admin storageState を使わない）
test.use({ storageState: { cookies: [], origins: [] } })

test.beforeAll(async () => {
  // worker行を持たず owner でもない認証ユーザーを用意（signup・冪等）
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch(() => {})
  // テナント解決用の app_metadata.account_slug を付与＋メール確認済み化（worker行/owner設定はしない）
  try {
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${EMAIL}'"`,
      { stdio: 'ignore' },
    )
  } catch (e) { console.warn('[e2e] failsafe user setup 失敗:', String(e)) }
})

test('worker行が無い非オーナーの認証ユーザーはオーナー扱いされず管理画面に入れない(フェイルセーフ)', async ({ page }) => {
  await page.goto('/login')
  await page.locator('[data-testid="login-id"]').waitFor({ state: 'visible', timeout: 15000 })
  await page.fill('[data-testid="login-id"]', ID)
  await page.fill('input[type="password"]', PASS)
  await page.click('button[type="submit"]')

  // 認証自体は成功するが、権限が無い(worker扱い)ため利用不可ゲートが出てサイドバーは出ない
  await expect(page.locator('.gate-title')).toContainText('権限がありません', { timeout: 20000 })
  await expect(page.locator('.sidebar')).toHaveCount(0)
})
