-- ============================================================
--  【見積→元請け】元請け担当者マスタ＋案件への元請け紐付け＋見積書送信先の元請け対応
--
--  ① contractor_contacts: 元請け(contractors)の担当者（下請けの subcontractor_contacts と同型）。
--     見積書PDFの送信先に使う。contractors と同じく RLS 無効（anonキー運用・account_idで絞る）。
--  ② estimate_projects.contractor_id: 案件に元請けを直接紐付け（見積→正式受注後に現場へ昇華する前段）。
--  ③ estimate_sends に元請け宛の記録列を追加（既存の subcontractor_* 列はそのまま・両nullable）。
--
--  すべて追加のみDDL（CREATE / ADD COLUMN / INDEX）。破壊的変更なし。
-- ============================================================

-- ① 元請け担当者（下請けの subcontractor_contacts と同型・RLSは contractors に合わせ無効）
create table if not exists contractor_contacts (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  account_id    uuid not null references accounts(id),
  name          text not null,            -- 担当者名
  email         text,
  phone         text,
  sort_order    int not null default 0,
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists contractor_contacts_contractor_idx on contractor_contacts (contractor_id);
create index if not exists contractor_contacts_account_idx     on contractor_contacts (account_id);

-- contractor_contacts は管理画面専用（元請け担当者・メール等の連絡先）。anon/LIFF は触らない。
-- → RLS有効・account分離・anon全拒否（estimate_* と同方式）。EFは service_role でバイパス。
alter table contractor_contacts enable row level security;
drop policy if exists contractor_contacts_sel on contractor_contacts;
drop policy if exists contractor_contacts_ins on contractor_contacts;
drop policy if exists contractor_contacts_upd on contractor_contacts;
drop policy if exists contractor_contacts_del on contractor_contacts;
create policy contractor_contacts_sel on contractor_contacts for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy contractor_contacts_ins on contractor_contacts for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy contractor_contacts_upd on contractor_contacts for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
create policy contractor_contacts_del on contractor_contacts for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ② 案件に元請けを紐付け（任意・現場へ昇華する前の見積段階の宛先決定に使う）
alter table estimate_projects add column if not exists contractor_id uuid references contractors(id);
create index if not exists est_projects_contractor_idx on estimate_projects (account_id, contractor_id);

-- ③ 見積書送信履歴に元請け宛の記録列（既存 subcontractor_* 列は温存・両方nullable）
alter table estimate_sends add column if not exists contractor_id         uuid references contractors(id);
alter table estimate_sends add column if not exists contractor_contact_id uuid references contractor_contacts(id);
