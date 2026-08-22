-- ============================================================
--  20260822060000_personal_expense_site_link.sql
--  個人経費(personal_expenses)に「現場」への任意の紐付けを持たせる。
--
--  一括解析した領収書を、その日出勤していた現場から選んで紐付けられるようにする（#96ec0759）。
--  ・site_id   = 現場マスタ(sites.id)への権威キー。集計・グループ化はこれで行う。
--  ・site_name = 表示用スナップショット（現場マージ/改名でも当時の表示が残る）。
--    daily_reports.sites[] と同じ『site_id 権威 ＋ 表示名スナップショット』パターン。
--  ・どちらも NULL 許容＝任意紐付け（現場に紐付かない個人経費は従来どおり NULL のまま）。
--
--  ★FKは張らない: 現場マージ/非アクティブ化で site_id が孤児になり得るため（daily_reports と同方針）。
--    site_id が実在するかの検証は EF(personal-expense-submit) 側で自テナントに限定して行う。
--
--  追加のみDDL（ADD COLUMN / CREATE INDEX）。破壊的変更なし。
-- ============================================================

alter table personal_expenses add column if not exists site_id   uuid;
alter table personal_expenses add column if not exists site_name text;

-- 現場別の集計・絞り込みで引けるように（テナント×現場）
create index if not exists personal_expenses_site_idx on personal_expenses(account_id, site_id);
