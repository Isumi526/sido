// ============================================================
//  tests/e2e/liff-test.ts
//  作業員アプリ（liff.*.spec.ts）用の test。@playwright/test の代わりにここから import する。
//
//  ★既定で「既定の開発ユーザー（Worker 01）としてログインした状態」で page を開く（2026-09-26・RLS第2段A）。
//   本番の作業員は全員メール/パスワードでログインしていて、作業員アプリの書き込みは authenticated で走る。
//   E2E だけがログイン無し（anon）で動いていたので、本番で anon の書き込み権限を剥がすと
//   「本番では起きない失敗」で落ちていた。本番と同じ形に揃える。
//  ・専用の作業員で動かす spec は useDevWorker(page, key) が、その作業員のログインで上書きする
//  ・ログインしていない状態そのものを確かめる spec（ログイン画面・ゲスト招待など）は
//    test.use({ liffLogin: false }) で外す
// ============================================================
import { test as base, expect } from '@playwright/test'
import { devUserWorkerId, loginLiffAs } from './helpers'

export const test = base.extend<{ liffLogin: boolean; _liffLogin: void }>({
  liffLogin: [true, { option: true }],
  _liffLogin: [async ({ page, liffLogin }, use) => {
    if (liffLogin) await loginLiffAs(page, await devUserWorkerId())
    await use()
  }, { auto: true }],
})

export { expect }
