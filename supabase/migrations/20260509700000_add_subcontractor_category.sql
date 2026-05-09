-- 下請け業者マスタに区分（商社/業者）と単価を追加
ALTER TABLE subcontractors
  ADD COLUMN IF NOT EXISTS category   text CHECK (category IN ('商社', '業者')),
  ADD COLUMN IF NOT EXISTS unit_price integer;

-- RLS は既存の設定を引き継ぎ（subcontractors は anon 読み取り可にする）
-- 既に RLS が無効 or ポリシー設定済みの場合はスキップ
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subcontractors' AND policyname = 'allow_anon_select'
  ) THEN
    -- RLS が有効な場合のみポリシーを追加
    IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'subcontractors') THEN
      EXECUTE 'CREATE POLICY allow_anon_select ON subcontractors FOR SELECT USING (true)';
    END IF;
  END IF;
END $$;
