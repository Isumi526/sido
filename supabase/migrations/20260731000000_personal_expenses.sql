-- ============================================================
--  20260731000000_personal_expenses.sql
--  現場に紐付かない個人経費（経営者・役員の接待交際費等）を、日報から独立して持つ。
--
--  ★なぜ日報JSON(sites[].expenses)に相乗りさせないか（決定的な理由・巻き戻し禁止）:
--    現行の経費集計は すべて is_working=true の日報行に依存している。つまり
--    「日報を出さない人（役員・経営者）」「出勤しない日」に発生した経費は、
--    今の構造では1円も集計されない（経費の入れ物が存在しないため）。
--    日報JSONに寄せる案ではこの穴が原理的に埋まらない。
--    → 後から「日報JSONの方が安かった」と巻き戻してはならない。
--    Notion: #f4cc3db1（2026-07-30 ユーザー確定回答 Q4）
--
--  ★standalone-safe: 新規テーブルのため生成時点で account_id スコープRLSを有効化
--    （.kody/accepted.yml のratchet方針＝新規のRLS無効×anon表は増やさない）。
--    drawing_material_extractions と同型。
--
--  追加のみDDL（CREATE TABLE / INDEX / POLICY / enable RLS / revoke / ADD COLUMN）。破壊的変更なし。
-- ============================================================

create table if not exists personal_expenses (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid references accounts(id) not null,
  worker_id           uuid references workers(id) not null,
  date                date not null,
  account_category    text not null,              -- 勘定科目（shared/expense-flatten.ts の EXPENSE_ACCOUNT_OPTIONS）
  amount              numeric not null,           -- 金額（小数単価の請求と同様、型で潰さない）
  payee               text,                       -- 支払い先（店名/業者）
  registration_number text,                       -- インボイス番号
  companions          text,                       -- 同行者名（接待交際費・会議費は必須＝税務要件）
  note                text,                       -- 内訳・メモ
  file_urls           jsonb not null default '[]'::jsonb,  -- 領収書（Supabase Storage URL）
  tategae             boolean not null default false,      -- 個人立替（会社が本人へ振り込む対象）
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 一覧・月次集計は「テナント×日付」と「作業員×日付」で引く
create index if not exists personal_expenses_account_date_idx on personal_expenses(account_id, date desc);
create index if not exists personal_expenses_worker_date_idx  on personal_expenses(worker_id, date desc);

alter table personal_expenses enable row level security;

drop policy if exists personal_expenses_sel on personal_expenses;
create policy personal_expenses_sel on personal_expenses for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists personal_expenses_ins on personal_expenses;
create policy personal_expenses_ins on personal_expenses for insert to authenticated
  with check (account_id = (select public.current_account_id()));

drop policy if exists personal_expenses_upd on personal_expenses;
create policy personal_expenses_upd on personal_expenses for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));

drop policy if exists personal_expenses_del on personal_expenses;
create policy personal_expenses_del on personal_expenses for delete to authenticated
  using (account_id = (select public.current_account_id()));

revoke all on personal_expenses from anon;

-- ── 誰に個人経費の申請を許すか（#2cbe3caa）──────────────────────────
--  議事録「この人とこの人とこの人だけはそういうのつけてって言ったらつけれる感じ」＝
--  作業員ごとのフラグ。既定 false＝従来どおり現場経費のみ（挙動不変）。
alter table workers add column if not exists can_apply_personal_expense boolean not null default false;
