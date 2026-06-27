-- ============================================================
--  20260625130000_estimate_upload.sql
--  ④ 下請け業者の見積書アップロード（業者ポータル）＋admin閲覧・コメント＋現場責任者へ通知
--   - sites.responsible_worker_id : 現場責任者（作業員）。アップロード時の通知先解決に使う
--       （通知メールは worker.auth_user_id → users.email で解決、無ければ会社通知先にフォールバック）。
--   - estimates.uploaded_via_portal / uploaded_at : 業者ポータル経由アップロードの証跡。
--   - estimate_comments : admin が見積に付けるコメント（誰が・いつ・本文）。
--  追加のみDDL（ADD COLUMN / CREATE TABLE / INDEX / POLICY）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

alter table public.sites
  add column if not exists responsible_worker_id uuid references public.workers(id);

alter table public.estimates
  add column if not exists uploaded_via_portal boolean not null default false,
  add column if not exists uploaded_at timestamptz;

create table if not exists public.estimate_comments (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  estimate_id uuid references estimates(id) not null,
  body        text not null,
  author      text,                          -- コメント投稿者（admin のメール等）
  created_at  timestamptz default now()
);
create index if not exists estimate_comments_estimate_idx on public.estimate_comments (estimate_id);
create index if not exists estimate_comments_account_idx  on public.estimate_comments (account_id);

-- estimates と同方針: 既存運用に合わせ RLS は親(estimates=RLS有効)に準じ、本表も有効化＋authenticated 限定。
alter table public.estimate_comments enable row level security;
create policy ec_sel on public.estimate_comments for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy ec_ins on public.estimate_comments for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy ec_del on public.estimate_comments for delete to authenticated
  using (account_id = (select public.current_account_id()));
revoke all on public.estimate_comments from anon;
