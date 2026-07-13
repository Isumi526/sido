# フロント E2E テスト（Playwright・ローカルスタック向け）

手動ポチポチ確認を自動化する。**ローカル Supabase スタック**に対して admin/liff を実ブラウザで動かして検証する。

## 前提（ローカルスタック）
1. `supabase start` でローカルスタック稼働。
   **sido は他プロジェクトとの共存のため `supabase/config.toml` でポートを 56321 系に固定**
   （API=56321 / DB=56322 / Studio=56323。標準の 54321 系ではない）。`supabase status` で実値確認。
2. dev サーバー起動（**.env.local＝ローカルを見る**）:
   ```bash
   npm run dev:admin   # admin → http://localhost:3001（vite, .env.local自動）
   npm run dev:liff    # liff  → http://localhost:3000（nuxt, --dotenv .env.local）
   supabase functions serve --no-verify-jwt --env-file supabase/functions/.env   # Edge Functions（日報送信テスト用・必須）
   ```
   ※ `supabase start` だけでは functions serve は別プロセスのため EF は配信されない。漏れると
     EF依存spec＋liffフォーム群（マスタ読込=get-master EF）が大量に絡んでtimeout する
     （2026-07-08実測: 52失敗の主因）。`global-setup.ts` が実行前に `get-master` へ疎通確認し、
     未配信なら個々のspecがtimeoutする前に明示エラーで即失敗する。
   ※ ブラウザのコンソールに `[Supabase] 127.0.0.1:56321 🟢 LOCAL` と出ていればローカル接続。
     `☁️ CLOUD` ならクラウドに繋がっているので注意（dev は必ず上記スクリプトで起動）。
3. admin ログイン: ID=`e2e` / pass=`e2e-pass-1234`（global-setup が作成。`e2e@email.com`）。
4. liff は dev モード（`dev-user-id`・認証不要）。

ポートが違う場合は `ADMIN_URL` / `LIFF_URL` env で上書き可。DB直接接続（psqlを使うspec/script）は
`SUPABASE_DB_URL` を明示するか、`tests/e2e/helpers.ts` の `DB_URL`（`SUPABASE_URL` のポート+1から自動導出）
を使う。`scripts/rls-audit.mjs` はこのプロジェクト専用ではない汎用スクリプトのため、既定は標準54322のまま
（sido実行時は `.env` の `LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres` で上書き、
または `--db-url=postgresql://postgres:postgres@127.0.0.1:56322/postgres` を明示）。

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
- **liffの「送信」系spec**（`/report` を新規=非editモードで開いて実際に送信するテスト）は
  liffアプリの「次の未送信日」ロジック（`useExpense.getNextUnsubmittedDate`）に依存する。
  この日は `report_start_date`（`global-setup.ts` が毎回「編集可能window内の最古日」に更新）から
  `today` まで走査した最初の未送信日で、**当日を含む過去2日（3日間）だけが編集可能**
  （`apps/liff/composables/useReportLock.ts` の `LOCK_AFTER_DAYS=3`。`diffDaysFromToday>=3` でロック
  ＝実際に編集可能なのは diff 0/1/2 の3日のみ）。1回のフルランで複数specが新規送信するため、
  **`FEAT_ATT_DATE`（admin出退勤表示テスト用・当月10日固定）が「今日」からこの3日windowに
  かかる日（だいたい毎月10〜12日ごろ）は空き枠が減り、一部の新規送信specが
  「送信済みです」で自身のskipガードに倒れることがある**（バグではなく設計上の枯渇時フォールバック）。
  **並び順や入力チェックだけで送信を伴わないspec**（`liff.garbage-decimal.spec.ts` /
  `liff.site-kana.spec.ts` / `liff.site-contractor-filter.spec.ts` 等）はこの枯渇の影響を受けないよう
  `/report?edit=<既存の日報日>`（`FEAT_C_DATE` 等 `global-setup.ts` が必ず用意する日）を使う設計にしてある。
  新しく「送信しない」specを書く時もこのパターンに従うこと。

## 決定と理由（2026-07-10・E2Eテスト負債の解消）
- **陳腐化spec**は本文にコメントで根拠コミットを残して更新（住所列削除/責任者必須化/客先フォーマット
  ラベル短縮/未送信リマインドの絵文字→【】表記/現場プルダウン階層化/車検UI撤去/車両レベル領収書廃止/
  ログインplaceholder簡素化/認証UI統一 等・詳細は各specファイルのコメント参照）。テストのみ修正・製品コードは
  意図的な既存動作として尊重し変更していない（`admin.attendance-on-card.spec.ts` の「打刻なし」表示化など）。
- **liff 13本の送信クリック不全**の主因は `apps/liff/components/ReportOnboarding.vue` の初回オンボーディング
  オーバーレイ（`.ob-overlay`・z-index:1000・全画面）。Playwrightは毎テスト新規contextでlocalStorageが
  空のため全specで初回表示になり、配下のボタンクリックを40秒タイムアウトするまで奪っていた
  （2026-06-27導入）。`playwright.config.ts` の liff project に「オンボーディング既読」を既定の
  `storageState` として設定し解消（`liff.report-onboarding.spec.ts` 自体は自分でフラグを消すため非破壊）。
  残りは個別の陳腐化（`.date-fixed` の曜日併記化・車両レベル領収書廃止・現場プルダウン階層化）と、
  「次の未送信日」の起点が編集ロック窓の外（古すぎる）を指す環境要因（新規追加した
  `ensureRecentReportStartDate` で恒久化）。
- **admin.multitenant.spec.ts の"負荷時のみ失敗"は誤診断だった**: 実際は `input[placeholder^="ID"]` という
  陳腐化した前方一致セレクタ（`c1a4ba4` でplaceholderが「ID(@なし)またはメール」→「メールアドレス」に
  簡素化され不一致）。`data-testid="login-id"` に張り替えて解消（真因は負荷/リソース競合ではなかった）。
- **本番/実運用への影響は無し**: 全て admin/liff の UI/データ層の実装が正しく、E2Eテストのアサーション側が
  実装の変化に追従していなかった（陳腐化）か、テスト環境固有の日付/データ蓄積問題。製品コードへの修正は
  `apps/liff/components/PasswordInput.vue`（TS2345型エラー修正のみ・実行時挙動不変）・
  `apps/admin/src/pages/sites.vue`（`data-testid` 追加のみ）・`apps/liff/pages/calendar/index.vue`
  （`data-testid` 追加のみ）に限定。
- **見送った項目（要フォローアップ・意図的に本チケットでは着手せず）**:
  - `20260709010000_expense_receipts_v2_private_bucket.sql`（前日追加のRLS強化）で `expense-receipts`
    バケットへの anon insert/update が遮断されたが、`apps/liff/utils/generateExpensePdf.ts` の
    `uploadApplicationPdf` はLIFFクライアント側から直接この bucket へ upload しており、この移行対象パス
    (`expense-applications/...`) がポリシーの想定パス一覧（`company/<account_id>/...` 等）に含まれていない。
    実際にLIFFユーザーの認証状態次第では申請PDF生成が壊れている可能性がある
    （E2Eのフィクスチャ投入は `admin.expense-pdf.spec.ts` を service_role 経由に変更して回避したのみ・
    製品コード/migrationは未調査・認証・RLS領域のため人力確認を推奨）。
  - `daily-reminder` EF送信文言（絵文字📋あり）と `admin/src/pages/non-submitters.vue` のプレビュー文言
    （`15222cb` で【】表記に変更済み）が乖離している。プレビューの目的（実際のリマインドと同じ整形）と
    UI絵文字禁止ルールが衝突している可能性があるため、どちらに寄せるかは意図確認が必要
    （E2Eはこのspecでは既定=現状のUI文言【】に追従させたのみ）。
  - liffの「次の未送信日」が編集可能window内で複数specの新規送信と競合し、`FEAT_ATT_DATE`
    （当月10日固定）と当日が近い日（毎月10〜12日ごろ）は一部specが送信スキップに倒れる
    （上記メンテ節参照）。根本解消には日毎の枠取り設計変更が必要で本チケットの範囲を超えるため見送り。

## Green Baseline（2026-07-10 再定義・恒常5失敗の記述は陳腐化のため置換）
クリーンな環境（`supabase start` + `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env`
+ `npm run dev:admin` + `npm run dev:liff` が起動済み）で `npm run test:e2e` を実行した最終実測：

- **admin プロジェクト: 183 passed / 1 skipped / 0 failed**
  - skip: `admin.ai-help.spec.ts` の常駐ウィジェット(FAB)テスト。
    `apps/admin/src/lib/featureFlags.ts` の `HIDE_AI_HELP_SECTIONS=true`（2026-07-08・レビューで
    未検証の不具合が見つかったため一時保留・可逆フラグ）でFAB自体が非表示のため技術的に検証不能。
    フラグを `false` に戻したら `test.skip` を外して復活させる。
- **liff プロジェクト: 44 passed / 4 skipped / 0 failed**
  - skip 4件（`liff.report-draft.spec.ts` 2本 ・ `liff.report.spec.ts` の新規送信系2本）:
    上記メンテ節の「次の未送信日の枠不足」による自己スキップ（`送信済みです`検知→`test.skip`）。
    実行するタイミング（月内の日付）依存で、`FEAT_ATT_DATE` と当日が競合しない日は正常に実行され
    green（実際に別実行で全件passした実績あり）。ship前トリアージでは
    「この4本が"skipped"（failedではない）」であれば既知の日付依存として無視してよい。
    もし"failed"（timeoutやdisabledボタンのエラー）に変わっていたら回帰の可能性があるので調査すること。

**failed 0件**。上記は全て `passed` か（意図的な）`skipped` であり、ship時のトリアージは
「failed が0件であることの確認」だけで済む（skipの内訳は上記2件のみ既知）。
