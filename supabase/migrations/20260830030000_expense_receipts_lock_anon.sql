-- ============================================================
--  20260830030000_expense_receipts_lock_anon.sql
--  旧バケット expense-receipts を匿名から締め出す（2026-08-30）
--
--  ★何が起きていたか（本番で実測）:
--   1. バケットが public=true のまま → キー無しの curl で発注書PDFが HTTP 200 で落ちた
--   2. storage.objects の expense_receipts_select が **anon に無条件 SELECT** を許可
--      → 匿名キーだけでフォルダ一覧（estimates / expense-applications / 各社slug…）が
--        取れる＝URLを推測する必要すら無い。テナント跨ぎ。
--   303オブジェクト・下請け請求書や発注書を含む。少なくとも3ヶ月この状態だった。
--
--   1 は storage.buckets.public=false で塞いだが、2 が残っていると
--   匿名キーで list も download も通ってしまう（実際、public=false にしても
--   まだ読めることを実測した）。両方塞いで初めて閉じる。
--
--  ★読み出し経路は事前に署名URLへ寄せ済み（同日の別コミット）:
--   - 管理画面: docUrl.resolveDocUrl がバケットを問わず createSignedUrl(300秒)
--   - 下請けポータル(社外): service_role で署名URL
--   署名URLは storage の RLS を経由しないので、この締め出しでは壊れない。
--
--  ★LIFF の /files ページ（LINE通知の「📁領収書」リンク）は匿名 list に依存しており
--   これで動かなくなる。ただし日報LINE通知は全テナントで notify_report_enabled=false
--   ＝新しいリンクは配られていない。過去に配られたリンクが開けなくなるのは
--   「意図した締め出し」であって回帰ではない。
--
--  ロールバック（元の穴に戻す。緊急時のみ）:
--    drop policy if exists expense_receipts_select on storage.objects;
--    create policy "expense_receipts_select" on storage.objects for select
--      to anon, authenticated using (bucket_id = 'expense-receipts');
--    update storage.buckets set public = true where id = 'expense-receipts';
-- ============================================================

-- 匿名を外し、自テナントのフォルダだけ読めるようにする。
-- パスは「<account_id>/…」または「<account_slug>/…」の2形式が混在しているため両方見る
-- （expense_receipts_update が既に同じ判定をしているので、それに揃える）。
drop policy if exists "expense_receipts_select" on storage.objects;
create policy "expense_receipts_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (
      (select current_account_id())::text = any (storage.foldername(name))
      or (select slug from accounts where id = (select current_account_id())) = any (storage.foldername(name))
    )
  );

-- バケット自体も非公開にする（/object/public/ 経路を閉じる）
update storage.buckets set public = false where id = 'expense-receipts';
