-- ============================================================
--  20260822080000_storage_backups_bucket.sql
--  Storage バックアップ用の非公開バケット backups を新設する。
--
--  背景: Supabase の Database Backups は Storage オブジェクト実体を含まない
--   （ダッシュボード注意書き "Storage objects are not included"）。
--   領収書画像・車検証・請求書PDF・履歴書添付・日報/チャット添付・帳票PDF が
--   誤削除/上書き/バケット事故で失われても DB 行しか戻せない＝ファイルは戻らない。
--
--  対応方式(b): 全バケットのオブジェクトを日付プレフィックス付きで
--   この backups バケットへ複製し、事故時にさかのぼって復元できるようにする
--   （実際の複製/復元は scripts/backup-storage.mjs が service_role で行う）。
--   ※方式(a)の S3 object versioning は Supabase がトグルとして公開しておらず
--     migration/API では有効化できないため、リポで完結する(b)を採る。
--
--  ★アクセス制御: この backups バケットには policy を一切作らない。
--   storage.objects は RLS 有効なので、policy が無い＝anon も authenticated も
--   一切読み書きできない。service_role（バックアップ/復元スクリプト）だけが
--   RLS をバイパスして操作できる＝バックアップの取り違え/漏洩を物理的に防ぐ。
--
--  追加のみDDL（bucket upsert のみ・破壊的変更なし・冪等）。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;
