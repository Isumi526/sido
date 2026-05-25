-- ============================================================
--  schedules テーブル改修
--  - 夜勤フラグ・作成者名・ソフトデリート追加
--  - グループ機能は削除（テーブルは残すが UI 非使用）
--  - schedule_edits（編集履歴）テーブル追加
-- ============================================================

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS is_night_shift   boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_name  text;

-- 編集履歴
CREATE TABLE IF NOT EXISTS schedule_edits (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    uuid        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  edited_by_name text        NOT NULL,
  edited_at      timestamptz NOT NULL DEFAULT now(),
  changes        jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS schedule_edits_schedule_idx ON schedule_edits(schedule_id);
CREATE INDEX IF NOT EXISTS schedule_edits_edited_at_idx ON schedule_edits(edited_at DESC);

ALTER TABLE schedule_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_authenticated" ON schedule_edits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
