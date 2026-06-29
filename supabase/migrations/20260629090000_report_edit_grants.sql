-- ============================================================
--  20260629090000_report_edit_grants.sql
--  日報・経費の「過去3日ロック」の救済: ロックされた日付について作業員が
--  編集許可を依頼し、管理者が管理画面で許可すると、その worker×date のみ
--  再度 提出/編集できるようにする（チケット 38e0ff81c56b81059a7bfc6e160ddd26）。
--
--  - キーは worker_id（user_id ではない＝LINE/メール+pw のログイン方式跨ぎで安定）。
--  - account_id でテナント分離（論理）。
--  - LIFF(anon) が依頼を insert / 自分の許可状況を read、admin(authenticated) が承認 update。
--    既存の LIFF 露出テーブル群と同じ anon 運用（RLS無効）に揃える＝本表も
--    親エピック「本番DBのRLS有効化」(37b0ff81c56b8137827bd5d49f531777) の一括RLS化対象。
--    ※ロックは UX/運用ガード（クライアント側判定）であり anon直叩きに対する
--      セキュリティ境界ではない（daily_reports 自体が現状 anon-writable なため）。
--  - 追加のみDDL（CREATE TABLE / INDEX / GRANT）。非破壊。
-- ============================================================

create table if not exists public.report_edit_grants (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references accounts(id),
  worker_id    uuid,                          -- workers.id（ログイン方式跨ぎで安定）
  date         date not null,                 -- 対象の日報日付
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  reason       text,                          -- 作業員が添える依頼理由（任意）
  requested_at timestamptz not null default now(),
  approved_by  text,                          -- 承認/却下した管理者（メール等）
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists report_edit_grants_account_idx
  on public.report_edit_grants (account_id);
create index if not exists report_edit_grants_lookup_idx
  on public.report_edit_grants (account_id, worker_id, date);

-- 既存 LIFF 露出テーブルに合わせ anon 運用（RLS無効）。本番RLS化は親エピックで一括。
alter table public.report_edit_grants disable row level security;
grant select, insert, update on public.report_edit_grants to anon, authenticated, service_role;

comment on table public.report_edit_grants is
  '過去3日ロックの編集許可申請/承認（worker×date）。LIFF=依頼insert/自状況read、admin=承認update。';
