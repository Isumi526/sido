-- ============================================================
--  20260711010000_expense_receipts_allow_slug_path.sql
--  expense-receipts バケットの authenticated insert/update ポリシー
--  （20260709010000_expense_receipts_v2_private_bucket.sql）が、
--  account_id(UUID) をパスに含む書込先のみを想定していたため、
--  slug をパスに含む既存の書込先（expense-applications/<slug>/...
--  ＝ apps/liff/utils/generateExpensePdf.ts の経費申請PDFアップロード）
--  が全テナントで失敗していた（本番実測で確認・2026-07-09〜）。
--
--  経費申請PDFの読み取り側（apps/admin/src/pages/expenses.vue・
--  edge function send-expense-application 等）は slug ベースの
--  パスを直接組み立てて参照するため、パス自体を UUID 化する修正は
--  読み取り側を全て壊す。よってポリシー側で「account_id(UUID) または
--  account の slug のどちらかがパスに含まれていれば自テナント」に広げる
--  （slug は JWT の app_metadata.account_slug 由来＝他テナントの slug を
--  偽装できないため、UUID 限定から広げても分離は保たれる）。
--
--  追加のみDDL（既存と同じ drop policy + create policy パターン）。破壊的変更なし・冪等。
-- ============================================================

drop policy if exists "expense_receipts_insert" on storage.objects;
create policy "expense_receipts_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and (
      (select public.current_account_id())::text = any (storage.foldername(name))
      or (select slug from accounts where id = public.current_account_id()) = any (storage.foldername(name))
    )
  );

drop policy if exists "expense_receipts_update" on storage.objects;
create policy "expense_receipts_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (
      (select public.current_account_id())::text = any (storage.foldername(name))
      or (select slug from accounts where id = public.current_account_id()) = any (storage.foldername(name))
    )
  );
