-- ============================================================
--  20260709010000_expense_receipts_v2_private_bucket.sql
--  expense-receipts バケットの anon 全開放（select/insert/update）を解消。
--   - 旧 expense-receipts（public=true・過去データ多数）は当面据え置き
--     （bucket自体がpublicなためSELECTポリシーを外しても既存データのgetPublicUrl
--     読み取りは変わらず残る＝ユーザー承認済みの段階対応。過去分の移行は別タスク）。
--   - anon からの新規 insert/update だけは即座に遮断（誰でも書き込める穴を閉じる）。
--     authenticated（admin/email-pw作業員の既存アップロード：会社印影・協力業者請求書・
--     注文書PDF等）は、path内のいずれかの階層が current_account_id() と一致する時のみ
--     許可＝テナント分離した上で維持する（admin側の既知の書込先はいずれも
--     company/<account_id>/... ・subcontractor-invoices/<account_id>/... ・
--     purchase-orders/<account_id>/... の形でpath内にaccount_idを含む）。
--   - 今後の新規アップロード（LIFF領収書・ゴミ写真）は非公開の expense-receipts-v2
--     バケットへ、edge function(expense-receipt-upload) 経由・service_roleでのみ書込む。
--     アップロード直後に長期署名URL(10年)を発行して従来の *Urls フィールドへそのまま
--     格納する＝既存の表示側コード(14箇所以上のreceipt-link)は無改修で動く。
--  追加のみDDL（bucket upsert / policy）。破壊的変更なし・冪等。
-- ============================================================

-- 旧バケット: anon からの insert/update を遮断。authenticated はテナント分離した上で維持
-- （current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み）。
drop policy if exists "expense_receipts_insert" on storage.objects;
create policy "expense_receipts_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and (select public.current_account_id())::text = any (storage.foldername(name))
  );

drop policy if exists "expense_receipts_update" on storage.objects;
create policy "expense_receipts_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (select public.current_account_id())::text = any (storage.foldername(name))
  );

-- select は bucket が public=true のため据え置き（既存データの表示を壊さない）。

-- 新バケット（非公開・EF経由のみ・クライアント直アクセス不可）
insert into storage.buckets (id, name, public)
values ('expense-receipts-v2', 'expense-receipts-v2', false)
on conflict (id) do update set public = false;
