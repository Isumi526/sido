-- ============================================================
--  expense-receipts Storage バケット作成
--  経費領収書・ゴミ写真を Supabase Storage で管理
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', true)
ON CONFLICT (id) DO NOTHING;

-- anon キーでアップロード許可（LIFF は anon key を使用）
CREATE POLICY "expense_receipts_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'expense-receipts');

-- 公開読み取り
CREATE POLICY "expense_receipts_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'expense-receipts');
