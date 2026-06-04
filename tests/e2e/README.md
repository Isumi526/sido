# フロント E2E テスト（Playwright・ローカルスタック向け）

手動ポチポチ確認を自動化する。**ローカル Supabase スタック**に対して admin/liff を実ブラウザで動かして検証する。

## 前提（ローカルスタック）
1. `supabase start` でローカルスタック稼働（`http://127.0.0.1:54321`）。
2. dev サーバー起動（**.env.local＝ローカルを見る**）:
   ```bash
   npm run dev:admin   # admin → http://localhost:3001（vite, .env.local自動）
   npm run dev:liff    # liff  → http://localhost:3000（nuxt, --dotenv .env.local）
   supabase functions serve --no-verify-jwt   # Edge Functions（日報送信テスト用）
   ```
   ※ ブラウザのコンソールに `[Supabase] 127.0.0.1:54321 🟢 LOCAL` と出ていればローカル接続。
     `☁️ CLOUD` ならクラウドに繋がっているので注意（dev は必ず上記スクリプトで起動）。
3. admin ログイン: ID=`e2e` / pass=`e2e-pass-1234`（global-setup が作成。`e2e@email.com`）。
4. liff は dev モード（`dev-user-id`・認証不要）。

ポートが違う場合は `ADMIN_URL` / `LIFF_URL` env で上書き可。

## 実行
```bash
npm run test:e2e          # 全部
npm run test:e2e:admin    # admin だけ
npm run test:e2e:liff     # liff だけ
npm run test:e2e:ui       # UIモード
npm run test:e2e:report   # HTMLレポート
```

## カバー範囲
- **admin**: auth.setup（実ログイン→storageState再利用）／全ページ描画スモーク／日報一覧表示／元請けマスタCRUD（実UIで追加→一覧反映）／日報一覧に元請け表示(Feature A)
- **liff**: 日報入力→送信→完了画面／履歴の明細常時表示(Feature B)／履歴に元請け表示(Feature A)／経費印刷が「全経費」と「立替分のみ」で分割(Feature C)

## 仕組み
- **admin 認証**: `auth.setup.ts` が `/login` で実ログイン → `tests/e2e/.auth/admin-local.json` に storageState 保存 → admin プロジェクトが再利用。
- **シード**: ローカルは `supabase/seed.sql`（Worker 01 等・dev-user-id・サンプル日報）。加えて `global-setup.ts` が機能テスト用に当月の「元請け付き日報」「立替経費付き日報」を REST で投入（冪等）。
- **接続先**: `helpers.ts` が `apps/admin/.env.local`（ローカル）を読む。RLS無効テーブルは publishable(anon) キーでシード／後始末。
- **印刷ページの userId は LINE user id**（`getUser(lineUserId)`）。dev モードは `dev-user-id`。

## メンテ
- ページ追加 → `admin.smoke.spec.ts` の `PAGES`。
- 新フロー → `liff.*.spec.ts` / `admin.*.spec.ts`。必要シードは `global-setup.ts`。
- 機能テスト用日付は当月で動的生成（admin日報一覧の既定月に合わせる）。

## 注意
- 生成物（`.auth/` `.report/` `.artifacts/`）は `.gitignore` 済み。
- 本番(クラウド)には一切書き込まない。すべてローカルスタック対象。
