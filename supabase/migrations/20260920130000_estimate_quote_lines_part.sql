-- ============================================================
--  20260920130000_estimate_quote_lines_part.sql
--  見積Excel E-2（2026-09-10 名古屋・大塚「区分の中でも天井の項目と壁の項目と分かれているとありがたい」）:
--  単価履歴に「部位」（天井／壁／床／なし）を持てるようにする。作業用Excelの名称候補を
--  行の工事区分（＋部位）で絞るための鍵。過去データは空でよい（Excel側は名称の語で推定して補う）。
--
--  ★追加のみ: estimate_quote_lines に part 列、ビュー estimate_price_history の末尾に ql.part を足す。
--   （ビューの列は必ず末尾に足す。途中に挿すと create or replace view が失敗し DROP VIEW＝破壊的DDL になる）
--  ロールバック: create or replace view（末尾の part を外す）→ alter table estimate_quote_lines drop column part;
-- ============================================================
alter table public.estimate_quote_lines
  add column if not exists part text;
comment on column public.estimate_quote_lines.part is '部位（天井／壁／床）。見積Excel の名称候補を区分＋部位で絞る鍵。空＝不明';

create or replace view public.estimate_price_history as
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
  qr.id              as request_id,
  ql.part                              -- 2026-09-20 E-2: 部位（末尾に追加）
from public.estimate_quote_lines ql
join public.estimate_quote_requests qr on qr.id = ql.request_id
join public.subcontractors sc          on sc.id = qr.subcontractor_id
join public.estimate_projects pj       on pj.id = qr.project_id;

grant select on public.estimate_price_history to authenticated;
alter view public.estimate_price_history set (security_invoker = on);
revoke all on public.estimate_price_history from anon;
