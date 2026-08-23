-- ============================================================
--  supabase/migrations/20260822040000
--  元請け(contractors)・協力業者(subcontractors) に読み仮名(name_kana)を追加 (#37)
--   - 選択リスト/一覧を50音順で並べるための読み仮名カラム
--   - 手入力（自動生成しない）・nullable。未設定はソート時に末尾フォールバック
--   - sites/workers と同型（20260608000000 / 20260727000000）
--   - 追加のみDDL（既存データ非破壊）
-- ============================================================

alter table contractors    add column if not exists name_kana text;
alter table subcontractors add column if not exists name_kana text;
