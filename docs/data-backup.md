# 本番DBバックアップと復元（契約 別紙2 §10 の実体）

- 取得: GitHub Actions `db-backup`（毎日 03:00 JST）。`pg_dump -Fc`（public / auth / storage スキーマ・所有者と権限なし）。
- 保管: Cloudflare R2 バケット `genlinks-db-backup` の `daily/sido-YYYYMMDD-HHMM.dump`。**31日で自動削除**（ライフサイクル。権限が無い環境では Actions が自前で 31 日超を削除）。
- 検査: 毎回 `pg_restore --list` で TOC を読み、TABLE DATA が 50 件未満・ファイルが 1MB 未満なら失敗にする。R2 上のサイズも突合。
- 復元テスト: 毎月 1 日（または手動 `restore_test=true`）に空の Postgres 17 へ復元し、public テーブル数と主要テーブルの件数を出す。
- 失敗時: LINE（notify-humanball）に「本番DBバックアップ失敗」。
- 秘密: GitHub secrets `SUPABASE_PROD_DB_URL`（pooler）、`R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`（バケット限定・オブジェクト読み書き）。

## 復元手順（新しい Supabase プロジェクトへ）

1. R2 から対象日の dump を取る（Cloudflare ダッシュボード › R2 › genlinks-db-backup › daily/ からダウンロード、または `aws s3 cp --endpoint-url https://<account>.r2.cloudflarestorage.com`）。
2. 復元先の接続URL（新プロジェクトの pooler）を用意。**既存の本番には絶対に流さない。**
3. 復元:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists -d "<復元先URL>" sido-YYYYMMDD-HHMM.dump
   ```
   Supabase 固有の拡張・ロールに関するエラーは出る（`supabase_admin` 等）。`public` のテーブル・関数・トリガ・RLS ポリシーが入っていればよい。
4. 検算: `select count(*) from daily_reports` 等を本番の直近の値と見比べる（prod-health の不変条件も流す）。
5. Storage（画像・PDF）は DB バックアップに **含まれない**。別途「Storage（添付）がバックアップ対象外」チケットの対応に従う。

## 別紙2 の文言
「クラウド事業者の標準機能により日次で自動取得し、取得日から30日間保存する」→ 実態は自前の日次バックアップなので「自動バックアップにより」に修正を弁護士へ依頼（2026-09-20 決定）。
