-- schedule_edits の RLS を schedules に合わせて無効化
-- （LIFF は anon キーを使用するため authenticated ポリシーでは INSERT できない）
ALTER TABLE schedule_edits DISABLE ROW LEVEL SECURITY;
