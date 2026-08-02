-- ============================================================
--  20260802000000_daily_report_edit_logs.sql
--  日報の「編集理由」を必須にする（議事録『日報の編集理由を必須にする』）
--  Notion: 日報の編集理由を必須にする（回答=B: 対象は日報フォームの編集のみ）
--
--  ★なぜ1列(daily_reports.edit_reason)ではなく履歴テーブルなのか
--   daily_reports は unique(user_id, date) の upsert で更新される。1列に持つと
--   2回目の編集で前回の理由が上書きされて消える。「誰がいつ何故直したか」を
--   追うのが目的なので、1編集=1行の履歴でなければ意味を成さない。
--
--  ★なぜ report_edit_grants.reason では足りないのか
--   あれは「3日以上前の日報のロック解除を依頼する理由」で、管理者承認を伴う別物。
--   3日以内の編集では行そのものが作られないため、通常の編集の理由が一切残らない。
--   今回埋めるのはこの穴。
--
--  ★RLS方針（既存のLIFF露出表とあえて変えている）
--   既存の liff 書き込み表（report_edit_grants / overtime_requests / site_chat_* 等）は
--   RLS無効＋anon全権で、.kody/accepted.yml に pre-RLS ベースラインとして追跡されている。
--   だが本表は「監査ログ」なので、同じ作りにすると anon から改竄・削除・他テナント閲覧が
--   できてしまい、存在意義そのものが薄れる。そこで:
--     anon          … INSERT のみ（LINE経路の liff はJWTを持たないため account スコープを
--                      検証できない。書き込みだけ許し、読めない・消せない・直せない）
--     authenticated … 自テナントの SELECT / INSERT（admin が理由を閲覧する）
--     UPDATE/DELETE … 誰にも許可しない＝追記専用（append-only）
--   これで rls-audit は 🟢ok（RLS有効・ポリシーあり）となり allowlist を増やさずに済む。
--
--  追加のみDDL（CREATE TABLE / CREATE INDEX / policy）。既存データへの変更なし。
-- ============================================================

create table if not exists daily_report_edit_logs (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id),
  -- 日報の特定。report_id は upsert 前だと未確定なことがあるので user_id + date も必ず持つ
  report_id         uuid references daily_reports(id) on delete set null,
  report_user_id    uuid,
  report_date       date not null,
  -- 編集した人。代理編集があるので「日報の持ち主」とは別に持つ
  edited_by_user_id uuid,
  edited_by_name    text,
  reason            text not null,
  -- 何を変えたか（LINE通知に出しているのと同じ差分。理由だけでは妥当性を判断できないため）
  diffs             jsonb,
  created_at        timestamptz not null default now(),
  constraint daily_report_edit_logs_reason_not_blank check (btrim(reason) <> '')
);

create index if not exists dre_log_report_idx on daily_report_edit_logs(report_id);
create index if not exists dre_log_lookup_idx on daily_report_edit_logs(account_id, report_date, report_user_id);

alter table daily_report_edit_logs enable row level security;

-- 追記専用にするため update/delete は誰にも grant しない
revoke all on daily_report_edit_logs from anon;
grant insert on daily_report_edit_logs to anon;
grant select, insert on daily_report_edit_logs to authenticated;

-- anon（LINEアプリ内の liff）は書くだけ。JWTが無く account_slug を名乗れないので
-- account スコープの検証はできない＝ with check (true)。読めない・消せない・直せないので
-- 混入されても既存データは壊れず、他テナントの理由も見えない。
drop policy if exists dre_log_ins_anon on daily_report_edit_logs;
create policy dre_log_ins_anon on daily_report_edit_logs for insert to anon
  with check (true);

drop policy if exists dre_log_sel on daily_report_edit_logs;
create policy dre_log_sel on daily_report_edit_logs for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists dre_log_ins on daily_report_edit_logs;
create policy dre_log_ins on daily_report_edit_logs for insert to authenticated
  with check (account_id = (select public.current_account_id()));

comment on table daily_report_edit_logs is
  '日報を編集した理由の履歴（1編集=1行・追記専用）。report_edit_grants.reason（ロック解除の依頼理由）とは別物。';

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists daily_report_edit_logs;
--   （新規テーブルのみ・既存データに触れていないので drop で完全に戻る）
