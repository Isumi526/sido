-- ============================================================
--  20260903140000_feature_usage_analytics.sql
--  GENLINKS の効果測定（機能別の利用状況と時間削減効果）
--  （2026-08-27運用者選択・2026-08-31リスク🔴高承認）:
--   - 方式＝自前の軽量利用ログ（新規イベントテーブル）＋トライアル先への
--     月1回の自己申告ヒアリング（時間削減の実感）。
--   - 外部アナリティクス(PostHog/Amplitude等)は導入しない（数社トライアル規模
--     には過剰・外部送信/契約面の検討が別途必要になるため見送り＝決定済み）。
--
--  ★スコープ（今回のMVP）: 全機能への計測仕込みは工数が大きいため、まず
--   代表的な2箇所（見積作成・見積書PDF発行）に計測を仕込み、集計画面と
--   自己申告フォームまでの経路を通す。他機能への計測拡張は継続タスク。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

create table if not exists public.feature_usage_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  worker_id   uuid references public.workers(id),
  feature_key text not null,
  occurred_at timestamptz not null default now()
);

comment on table public.feature_usage_events is
  '機能別の利用ログ（効果測定用・2026-08-27運用者選択）。外部アナリティクスは'
  ' 導入しない方針のため自前で持つ。feature_key は自由文字列（現状の値は'
  ' apps/admin/src/lib/usageLog.ts のコメント参照）。月次で機能別回数を集計する。';

create index if not exists feature_usage_events_account_month_idx
  on public.feature_usage_events (account_id, feature_key, occurred_at);

create table if not exists public.trial_time_saved_reports (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  year_month             text not null,   -- 'YYYY-MM'
  hours_saved            numeric(6,1) not null,
  note                   text,
  submitted_by_worker_id uuid references public.workers(id),
  submitted_at           timestamptz not null default now()
);

comment on table public.trial_time_saved_reports is
  'トライアル先の月次自己申告（何時間削減した実感か）。時間削減効果は基準値(before)が'
  ' 無いため、外部計測ではなく自己申告で概算する方針（2026-08-27運用者選択）。';

create unique index if not exists trial_time_saved_reports_account_month_uniq
  on public.trial_time_saved_reports (account_id, year_month);

-- ── 権限 ──────────────────────────────────────────────
alter table public.feature_usage_events enable row level security;
revoke all on public.feature_usage_events from anon;
revoke update, delete on public.feature_usage_events from authenticated;

drop policy if exists feature_usage_events_sel on public.feature_usage_events;
create policy feature_usage_events_sel
  on public.feature_usage_events for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists feature_usage_events_ins on public.feature_usage_events;
create policy feature_usage_events_ins
  on public.feature_usage_events for insert to authenticated
  with check (account_id = (select public.current_account_id()));

alter table public.trial_time_saved_reports enable row level security;
revoke all on public.trial_time_saved_reports from anon;

drop policy if exists trial_time_saved_reports_sel on public.trial_time_saved_reports;
create policy trial_time_saved_reports_sel
  on public.trial_time_saved_reports for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists trial_time_saved_reports_ins on public.trial_time_saved_reports;
create policy trial_time_saved_reports_ins
  on public.trial_time_saved_reports for insert to authenticated
  with check (account_id = (select public.current_account_id()));

drop policy if exists trial_time_saved_reports_upd on public.trial_time_saved_reports;
create policy trial_time_saved_reports_upd
  on public.trial_time_saved_reports for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
