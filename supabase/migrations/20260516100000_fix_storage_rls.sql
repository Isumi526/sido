-- ============================================================
--  expense-receipts Storage RLS ポリシー修正
--  upsert (INSERT + UPDATE) に対応
-- ============================================================

-- 既存ポリシーを一旦削除して再作成
DROP POLICY IF EXISTS "expense_receipts_insert" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_select" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_update" ON storage.objects;

-- anon / authenticated での INSERT 許可
CREATE POLICY "expense_receipts_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'expense-receipts');

-- anon / authenticated での UPDATE 許可（upsert: true に対応）
CREATE POLICY "expense_receipts_update"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'expense-receipts');

-- 公開読み取り
CREATE POLICY "expense_receipts_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'expense-receipts');
