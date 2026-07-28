-- ============================================================
--  supabase/migrations/20260728020000
--  見積: 相見積の依頼→受領→比較・選定 と 下請単価の履歴（Q3 / Q4）
--
--  背景（2026-07-27 認識合わせ §1.4 / 確認15）:
--   顧客のExcel（軽鉄価格 基本シート）には、業者3枠 ×（業者/見積単価/提示日/現場名）
--   という相見積比較の構造が既にあった。しかし約120項目のうち**1項目しか埋まっていない**。
--   理由をユーザーに確認したところ:
--     「手入力などが面倒。業者から見積もり受領を行った際に記憶させたい」
--
--  ★設計の肝: 単価履歴は「別途入力する台帳」にしない。
--   受領登録の**副作用**として自動で貯まる形にする。
--   Excelが1項目しか埋まらなかったのは、明細入力とは別に台帳へ手入力する
--   設計だったから（推測）。同じ轍を踏まない。
--
--  Notion: Q3 3aa0ff81c56b81e28792f1b78a98cea0 / Q4 3aa0ff81c56b81e788d6daa09cd1a8e1
--
--  admin(authenticated)からのみ使うため、最初からRLS有効＋account_idスコープ
--  （purchase_orders 方式。rls-audit の ratchet 基準に適合）。
-- ============================================================

-- ── 見積依頼（どの案件のどの工種を、どの業者に、いつまでに頼んだか）──
create table if not exists estimate_quote_requests (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  project_id      uuid not null references estimate_projects(id) on delete cascade,
  -- 業者は後から選ぶ運用（行を追加 → 業者を選択）なので nullable。
  -- not null にすると空行を作れずUIの流れと矛盾する（E2Eで検出）。
  subcontractor_id uuid references subcontractors(id),
  trade_name      text,                        -- 依頼した工種（自由記述。明細と同じ考え方）
  requested_at    date,                        -- 依頼日（図面を配布した日）
  due_date        date,                        -- 回収期限
  received_at     date,                        -- 受領日（null = 未回収）
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists est_qr_account_idx on estimate_quote_requests(account_id);
create index if not exists est_qr_project_idx on estimate_quote_requests(project_id);

-- ── 受領した見積の明細（項目 × 単価）──
--  ここに入れることが「単価履歴に記録する」ことと同義になる（別台帳を作らない）。
create table if not exists estimate_quote_lines (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id),
  request_id   uuid not null references estimate_quote_requests(id) on delete cascade,
  item_name    text not null,                  -- 工事項目（例: 天井 下地組）
  spec         text,                           -- 形状・詳細
  unit         text,                           -- ㎡ / m / 式 …
  -- ★単価の「意味」を明示する。確認6で「業者によって平米単価、材工共に分かれる」と回答あり。
  --  これを持たずに横並び比較すると、意味の違う単価を見比べて誤った選定をする。
  price_kind   text not null default 'material_labor',  -- 'material_labor'(材工共) | 'labor'(労務のみ) | 'material'(材料のみ)
  quantity     numeric(14,2),                  -- 業者が拾った数量（自社の数量と食い違うことがある＝確認3のC）
  unit_price   integer not null,
  is_selected  boolean not null default false, -- この項目でこの業者を採用したか
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists est_ql_account_idx on estimate_quote_lines(account_id);
create index if not exists est_ql_request_idx on estimate_quote_lines(request_id);
-- Q4（過去の業者別単価を候補表示）で「項目名で横断検索」するため
create index if not exists est_ql_item_idx on estimate_quote_lines(account_id, item_name);

-- ── RLS（admin専用・account_idスコープ）──
alter table estimate_quote_requests enable row level security;
revoke all on estimate_quote_requests from anon;
grant select, insert, update, delete on estimate_quote_requests to authenticated;
drop policy if exists est_qr_sel on estimate_quote_requests;
create policy est_qr_sel on estimate_quote_requests for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_qr_ins on estimate_quote_requests;
create policy est_qr_ins on estimate_quote_requests for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_qr_upd on estimate_quote_requests;
create policy est_qr_upd on estimate_quote_requests for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_qr_del on estimate_quote_requests;
create policy est_qr_del on estimate_quote_requests for delete to authenticated
  using (account_id = (select public.current_account_id()));

alter table estimate_quote_lines enable row level security;
revoke all on estimate_quote_lines from anon;
grant select, insert, update, delete on estimate_quote_lines to authenticated;
drop policy if exists est_ql_sel on estimate_quote_lines;
create policy est_ql_sel on estimate_quote_lines for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_ql_ins on estimate_quote_lines;
create policy est_ql_ins on estimate_quote_lines for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_ql_upd on estimate_quote_lines;
create policy est_ql_upd on estimate_quote_lines for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_ql_del on estimate_quote_lines;
create policy est_ql_del on estimate_quote_lines for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── Q4: 過去の業者別単価を引くためのビュー ──
--  受領明細に「いつ・どの現場（案件）で・どの業者が」を結合したもの。
--  Excelの相見積シートの列構成（業者/見積単価/提示日/現場名）をそのまま再現する。
--  ★別テーブルに転記するのではなくビューにすることで、受領登録するだけで履歴が育つ。
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
  coalesce(qr.received_at, qr.requested_at) as quoted_on,   -- 提示日
  qr.trade_name,
  qr.project_id,
  pj.name            as project_name                        -- 現場名（案件名）
from estimate_quote_lines ql
join estimate_quote_requests qr on qr.id = ql.request_id
join subcontractors sc          on sc.id = qr.subcontractor_id
join estimate_projects pj       on pj.id = qr.project_id;

grant select on estimate_price_history to authenticated;
