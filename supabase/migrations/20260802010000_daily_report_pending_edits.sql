-- ============================================================
--  20260802010000_daily_report_pending_edits.sql
--  日報の編集を承認制にする（保留方式）
--  Notion: 日報の編集は承認制にする（承認されるまで集計に反映しない）
--
--  ★方式（ユーザー回答で確定）:
--   作業員が編集しても daily_reports は編集「前」のまま据え置き、編集「後」の内容を
--   この表に保留する。管理者が承認して初めて daily_reports に適用され、集計に反映される。
--
--  ★なぜ「未承認フラグを daily_reports に足して集計側で除外する」形にしないのか:
--   daily_reports の消費箇所が admin 7画面 ＋ liff（履歴・経費PDF）＋ Edge Function 4本の
--   10以上あり、除外方式だと全部にフィルタを足す必要がある。1つ漏らすとその画面だけ
--   未承認の金額が混ざる。保留方式なら
--     「daily_reports に入っている ＝ 承認済み」
--   という不変条件が作れるので、消費箇所を一切触らずに済む＝直し漏れが構造的に起きない。
--
--  ★なぜ daily_report_edit_logs に相乗りさせないのか:
--   あれは 1編集=1行の追記専用（append-only）の監査ログ。可変の承認状態を持たせると
--   「消せない・直せない」という性質が壊れる。保留は状態が変わるものなので表を分ける。
--   監査ログは編集のたびに必ず1行残り、保留は「今どうなっているか」だけを持つ。
--
--  追加のみDDL（CREATE TABLE / CREATE INDEX / CREATE POLICY）。既存テーブルへの変更なし。
-- ============================================================

create table if not exists daily_report_pending_edits (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id),
  report_id           uuid not null references daily_reports(id) on delete cascade,
  report_user_id      uuid,
  report_date         date not null,

  -- 編集「後」の日報の中身。daily_reports の該当列をそのまま入れる
  -- （is_working / leave_type / is_business_trip / sites / note / gasoline_items）。
  -- 承認時にこの中身をそのまま daily_reports へ適用する。
  payload             jsonb not null,

  reason              text not null,
  diffs               jsonb,

  submitted_by_user_id uuid,
  submitted_by_name    text,
  submitted_at         timestamptz not null default now(),

  status              text not null default 'pending',
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  reject_reason       text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint drpe_status_chk check (status in ('pending', 'approved', 'rejected')),
  constraint drpe_reason_not_blank check (btrim(reason) <> '')
);

-- 1つの日報に対して保留中は常に1件だけ（承認待ちの日報を再編集したら上書きする）。
-- 承認済み/差戻し済みは履歴として複数残ってよいので部分一意索引にする。
create unique index if not exists drpe_one_pending_per_report
  on daily_report_pending_edits(report_id) where status = 'pending';
create index if not exists drpe_lookup_idx
  on daily_report_pending_edits(account_id, status, report_date);

alter table daily_report_pending_edits enable row level security;

-- 書き込み（申請・承認・差戻し）は EF report-edit-log（service_role）だけが行う。
-- anon は一切触れない＝LINE経路の作業員が自分で承認状態を書き換えられない。
-- admin（authenticated）は一覧表示のため SELECT だけ。
revoke all on daily_report_pending_edits from anon;
revoke all on daily_report_pending_edits from authenticated;
grant select on daily_report_pending_edits to authenticated;

drop policy if exists drpe_sel on daily_report_pending_edits;
create policy drpe_sel on daily_report_pending_edits for select to authenticated
  using (account_id = (select public.current_account_id()));

comment on table daily_report_pending_edits is
  '日報の編集の保留（承認待ち）。承認されるまで daily_reports は書き換えない＝集計に出ない。監査ログは daily_report_edit_logs（追記専用）で別管理。';

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists daily_report_pending_edits;
--   （新規テーブルのみ・既存データに触れていないので drop で完全に戻る。
--     保留中の編集は失われるが、daily_reports は編集前の内容のまま無傷。）
