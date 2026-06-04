# 詳細設計書: アプリ名表記の修正（会社名ベースのサイト名）

- **タスク**: アプリ名表記の修正
- **Notion**: https://app.notion.com/p/3750ff81c56b8056b504f992c5600094
- **slug**: `app-name-display`
- **作成日**: 2026-06-04

---

## 1. 背景・目的

ブラウザのタブ名（サイト名）が固定文字列 `Construction Daily Report` と表記されている。
テナント（会社）ごとに `{accounts.name}` を反映し、`{会社名}｜管理システム` と表示したい。

- 現状サイト名の出所:
  - **LIFF**: `apps/liff/nuxt.config.ts:10` の `title: 'Construction Daily Report'`（静的）
  - **管理画面**: `apps/admin/index.html:6` の `<title>Construction Admin</title>`（静的）
- どちらのアプリも `accounts.name` を**表示用には取得していない**（`accounts.id` のみ取得）。

## 2. ユーザーストーリー / 受け入れ条件(AC)

- US: 利用会社の担当者として、ブラウザタブ・共有時のタイトルに自社名が出ることで、どの会社のシステムかひと目で分かるようにしたい。
- **AC1**: LIFF のドキュメントタイトルが `{accounts.name}｜管理システム` になる（ローカル: `テストアカウント｜管理システム`）。
- **AC2**: 管理画面のドキュメントタイトルが `{accounts.name}｜管理システム` になる（ローカル: `テストアカウント｜管理システム`）。
- **AC3**: `accounts.name` 取得前の初期描画でも `Construction Daily Report` / `Construction Admin` は一切出ない（フォールバックは `管理システム`）。
- **AC4**: 既存機能（日報入力・履歴・経費・管理画面各ページ）に回帰がない（既存20本のE2Eが全green）。

## 3. 確定した仕様（ユーザー確認済み）

- **対象範囲**: LIFF タブ名 ＋ 管理画面タブ名の2か所。画面内ブランド表記（現在 `slug.toUpperCase()`）は**対象外**（今回は変更しない）。
- **表記フォーマット**: 区切りは半角ハイフン固定ではなく最適な形で、という指示のため
  **全角縦棒 `｜`** を採用 → `` `${accounts.name}｜管理システム` ``。
  - 理由: 会社名が英語（`Sample Construction Co.` のように末尾が `.`）でも日本語でも、ハイフン直結より視認性が高く、日本語サイトのタブ名として一般的。

## 4. データモデル変更・migration計画

- **変更なし**。`accounts.name`（`text not null`）は既存（`20260509400000_add_accounts_table.sql`）。
- migration追加: **不要**。後方互換性: 影響なし（DBスキーマ非変更）。

## 5. 実装方針

### 5-1. LIFF（Nuxt3, SSR off）

1. `apps/liff/composables/useAccount.ts`
   - `select('id')` → `select('id, name')` に変更。
   - `accountName` を `useState<string | null>('account_name', () => null)` で保持し、`getAccountId()` 内で `id` と同時に格納。
   - 戻り値に `accountName`（読み取り用 ref）を追加。後方互換のため既存の `getAccountId` / `slug` は維持。
2. `apps/liff/app.vue`
   - `const { getAccountId, accountName } = useAccount()`
   - `useHead({ title: () => accountName.value ? `${accountName.value}｜管理システム` : '管理システム' })`
   - `onMounted` で `getAccountId()` を呼び、名前をロード（LIFF init とは独立。Supabase anon クエリのみで dev/E2E でも動作）。
3. `apps/liff/nuxt.config.ts`
   - `title: 'Construction Daily Report'` → `title: '管理システム'`（初回ペイント用フォールバック。AC3 を満たす）。

### 5-2. 管理画面（Vite + Vue3）

1. `apps/admin/src/lib/account.ts`
   - `getAccountName()` を追加（`select('name')` を `ACCOUNT_SLUG` で取得しモジュール内キャッシュ）。
   - 既存 `getAccountId()` は据え置き（後方互換）。
2. `apps/admin/src/App.vue`
   - `onMounted`（または setup 初期化）で `getAccountName()` を呼び、
     `document.title = name ? `${name}｜管理システム` : '管理システム'` を設定。
3. `apps/admin/index.html`
   - `<title>Construction Admin</title>` → `<title>管理システム</title>`（初回ペイント用フォールバック）。

### 5-3. edge functions

- **変更なし**。`_shared` import・再デプロイ対象: なし。

## 6. AC→E2Eテストケース

新規 spec を追加（既存の dev モード前提・認証不要パターンに準拠）。

- `tests/e2e/liff.title.spec.ts`
  - **AC1**: `/` を開き `await expect(page).toHaveTitle('テストアカウント｜管理システム')`。
  - **AC3(LIFF)**: タイトルに `Construction Daily Report` を含まないこと。
- `tests/e2e/admin.title.spec.ts`（admin project, storageState 利用）
  - **AC2**: `/` を開き `await expect(page).toHaveTitle('テストアカウント｜管理システム')`。
  - **AC3(admin)**: タイトルに `Construction Admin` を含まないこと。
- **AC4**: 既存 admin/liff 20本がそのまま green。

> 注: ローカル DB の対象アカウントは slug=`test` / name=`テストアカウント`
> （`.env.local` の `*_ACCOUNT_SLUG=test`、`20260509900000_multitenancy_cleanup.sql` の INSERT）。

## 7. デプロイ順序・後方互換性

- DB migration なし → 順序依存なし。
- フロントのみの変更（タイトル文字列の動的化）。後方互換性: **完全後方互換**。
- 本番デプロイは別ゲート（本タスクでは実施しない）。

## 8. 影響範囲

- 変更ファイル: `apps/liff/{nuxt.config.ts, composables/useAccount.ts, app.vue}`、
  `apps/admin/{index.html, src/lib/account.ts, src/App.vue}`、E2E 2本追加。
- リスク: 低。タイトル文字列のみ。`accounts.name` 取得失敗時は `管理システム` にフォールバック。

## 9. 残課題・将来検討

- 画面内ブランド表記（`slug.toUpperCase()`）の会社名統一は今回スコープ外。必要なら別タスク化。
- `accounts` 取得を1回にまとめる共通化（`id`/`name` の重複フェッチ最適化）は将来検討。
