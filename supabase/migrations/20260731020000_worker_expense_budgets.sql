-- ============================================================
--  20260731020000_worker_expense_budgets.sql
--  個人経費の「月額上限（枠）」を作業員×月で持つ（#32e93d75）。
--
--  ★案B採用（2026-07-31 ユーザー確定回答）＝月別テーブルで履歴を残す。
--    案A（workers に1カラム）だと上限を変えた瞬間に過去月の超過判定が
--    遡って変わってしまう。会計的に危険なので採らない。
--
--  枠の解決順（shared/expense-flatten.ts の resolveMonthlyLimit と対応）:
--    1) worker_expense_budgets(worker_id, month)     ← その月だけの上書き
--    2) workers.default_monthly_expense_limit        ← 作業員ごとの既定（毎月これが自動適用）
--    3) settings['personal_expense_monthly_limit']   ← テナント既定
--    4) いずれも未設定 → 枠なし＝申請不可
--
--  追加のみDDL（CREATE TABLE / INDEX / POLICY / enable RLS / revoke / ADD COLUMN）。破壊的変更なし。
-- ============================================================

create table if not exists worker_expense_budgets (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references accounts(id) not null,
  worker_id    uuid references workers(id) not null,
  month        text not null,     -- 'YYYY-MM'（経費の date 基準で寄せた月）
  limit_amount numeric not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 作業員×月で一意（upsert の on conflict 先）
create unique index if not exists worker_expense_budgets_worker_month_uniq
  on worker_expense_budgets(worker_id, month);

-- 管理画面の月次一覧は「テナント×月」で引く
create index if not exists worker_expense_budgets_account_month_idx
  on worker_expense_budgets(account_id, month);

alter table worker_expense_budgets enable row level security;

drop policy if exists worker_expense_budgets_sel on worker_expense_budgets;
create policy worker_expense_budgets_sel on worker_expense_budgets for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists worker_expense_budgets_ins on worker_expense_budgets;
create policy worker_expense_budgets_ins on worker_expense_budgets for insert to authenticated
  with check (account_id = (select public.current_account_id()));

drop policy if exists worker_expense_budgets_upd on worker_expense_budgets;
create policy worker_expense_budgets_upd on worker_expense_budgets for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));

drop policy if exists worker_expense_budgets_del on worker_expense_budgets;
create policy worker_expense_budgets_del on worker_expense_budgets for delete to authenticated
  using (account_id = (select public.current_account_id()));

revoke all on worker_expense_budgets from anon;

-- ── 作業員ごとの既定枠（指定が無い月はこの金額が毎月自動で効く）──────────
--  null = 未設定。テナント既定にフォールバックし、それも無ければ枠なし＝申請不可。
alter table workers add column if not exists default_monthly_expense_limit numeric;
