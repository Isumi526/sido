-- ============================================================
--  supabase/migrations/20260728070000
--  見積R5: 下請から受領した見積書ファイル（PDF等）を保存する
--
--  背景（2026-07-28 ユーザー通しレビュー・音声）:
--   明細入力時に「どの業者にいつ・いくらで発注したか」を出す仕組み（Q4）は
--   **単価だけ**を持っている。単価の根拠になった業者見積そのもの（PDF等）が
--   残っていないため、後から金額の妥当性を確認できない。
--   ユーザー原文: 「した請業者からの価格っていうのは、した請業者に見積もり依頼を
--   出して返ってきたPDFなり何なりのものを保存しておく必要がある」
--
--   → 受領登録（Q3）にファイル添付を足す。単価履歴（estimate_price_history）は
--     受領明細のビューなので、request 経由でファイルまで辿れるようになる。
--
--  Notion: R5 3ab0ff81c56b81579c23ee7bd160b062
--  admin(authenticated)専用のためRLS有効・account_idスコープ（purchase_orders方式）。
-- ============================================================

create table if not exists estimate_quote_files (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  request_id  uuid not null references estimate_quote_requests(id) on delete cascade,
  path        text not null,              -- storage 上のパス（estimate-drawings バケットを共用）
  name        text,                       -- 元のファイル名
  created_at  timestamptz not null default now()
);
create index if not exists est_qfile_account_idx on estimate_quote_files(account_id);
create index if not exists est_qfile_request_idx on estimate_quote_files(request_id);

alter table estimate_quote_files enable row level security;
revoke all on estimate_quote_files from anon;
grant select, insert, update, delete on estimate_quote_files to authenticated;

drop policy if exists est_qfile_sel on estimate_quote_files;
create policy est_qfile_sel on estimate_quote_files for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_qfile_ins on estimate_quote_files;
create policy est_qfile_ins on estimate_quote_files for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_qfile_upd on estimate_quote_files;
create policy est_qfile_upd on estimate_quote_files for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_qfile_del on estimate_quote_files;
create policy est_qfile_del on estimate_quote_files for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── 単価履歴のビューに「その単価の根拠ファイル」を辿れる request_id を足す ──
--  ★ビューにしてあるおかげで、受領登録するだけで履歴が育つ性質は変わらない（Q3の設計原則）。
create or replace view estimate_price_history as
select
  ql.account_id,
  ql.item_name,
  ql.spec,
  ql.unit,
  ql.price_kind,
  ql.unit_price,
  ql.quantity,
  ql.is_selected,
  qr.subcontractor_id,
  sc.name            as subcontractor_name,
  coalesce(qr.received_at, qr.requested_at) as quoted_on,
  qr.trade_name,
  qr.project_id,
  pj.name            as project_name,
  -- ★列は必ず末尾に足す。途中に挿すと create or replace view が
  --   「既存列の名前を変えられない」で失敗し、DROP VIEW が必要になる（＝破壊的DDL）。
  qr.id              as request_id     -- ここから受領見積のファイルを引ける
from estimate_quote_lines ql
join estimate_quote_requests qr on qr.id = ql.request_id
join subcontractors sc          on sc.id = qr.subcontractor_id
join estimate_projects pj       on pj.id = qr.project_id;

grant select on estimate_price_history to authenticated;
