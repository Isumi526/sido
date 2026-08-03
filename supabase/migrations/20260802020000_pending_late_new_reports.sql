-- ============================================================
--  20260802020000_pending_late_new_reports.sql
--  期限切れ（3日より前）の新規日報も内容の承認制にする
--  Notion: 期限切れの新規日報（3日より前）も承認制にする
--
--  ★経緯（本番を数えたうえでの判断）:
--   既に「過去3日ロック」があり、4日以上前の日付は提出も編集もロックされ、
--   作業員の許可申請 → 管理者の承認 で初めて出せる（本番で承認122件・直近60日124件）。
--   つまり入口は塞がっている。ところがその承認は「解錠の承認」であって
--   **中身（金額）は誰も見ていない**。遅れて出てくる日報（直近30日で47件）こそ
--   内容を確認したいので、解錠後に出された日報を内容の承認待ちに入れる（ユーザー回答=A）。
--
--  ★編集の保留（daily_report_pending_edits）を再利用する理由:
--   承認画面・承認/差戻しの処理・「承認されるまで daily_reports に書かない」という
--   不変条件が全く同じ。別表にすると同じものを2つ運用することになる。
--   違いは「まだ daily_reports の行が無い」ことだけなので、report_id を任意にして
--   kind で区別する。
--
--  追加のみDDL（列追加 / 制約緩和 / CREATE INDEX）。既存データは kind='edit' 扱いになる。
-- ============================================================

-- 新規（late_new）は承認されるまで daily_reports の行が存在しないので report_id を持てない
alter table daily_report_pending_edits alter column report_id drop not null;

alter table daily_report_pending_edits
  add column if not exists kind text not null default 'edit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drpe_kind_chk') then
    alter table daily_report_pending_edits
      add constraint drpe_kind_chk check (kind in ('edit', 'late_new'));
  end if;
end $$;

-- late_new は report_id が null なので、既存の report_id 一意索引では重複を防げない
-- （Postgres は NULL 同士を別物として扱う）。作業員×日付で1件に絞る。
create unique index if not exists drpe_one_pending_per_late_new
  on daily_report_pending_edits(account_id, report_user_id, report_date)
  where status = 'pending' and kind = 'late_new';

comment on column daily_report_pending_edits.kind is
  'edit=送信済み日報の編集 / late_new=期限切れ（3日より前）の新規提出。承認時の適用先が違う（editはupdate・late_newはupsert）';
