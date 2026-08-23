-- ============================================================
--  20260822050000_invoice_vendor_kind.sql
--  下請け請求の登録口の間口を広げる：協力業者以外（一般仕入先等）の請求書も登録できるようにする
--  Notion: [AI候補] 現在「協力業者請求」の登録口を広げ、協力業者以外の請求書も登録できるように #0e04cd0d
--
--  ★何をするか:
--   請求ヘッダに「請求元区分」を持たせる。
--     subcontractor = 従来どおり協力業者マスタ(subcontractor_id)に紐づく請求（既定）
--     other         = その他仕入先。マスタに無い相手で、vendor_name に自由入力の仕入先名を保存する
--
--  ★なぜ列を足すのか:
--   subcontractor_id が null かどうかだけでは「その他仕入先として意図的に登録した」のか
--   「協力業者だが未紐付け」なのかを区別できない。登録時の意図を保持し、編集時に正しい
--   入力モード（マスタ選択 or 自由入力）で開き直せるようにするため区分を明示的に持つ。
--
--  ★amount の意味は不変（tax_mode の規則をそのまま踏襲）。その他仕入先の請求も明細(items)は
--   従来どおり site_id/account_id を持ち、現場別/月次の原価集計に乗る。subcontractor_id が
--   null の請求は区分不明のため集計側では「業者(gyosha)」として合算される（既存の分岐に従う）。
--
--  既定は 'subcontractor'。既存行は全てこの扱いになるので**挙動は変わらない**（回帰なし）。
--  追加のみDDL（ADD COLUMN ＋ CHECK制約）。破壊的変更なし。
-- ============================================================

alter table public.subcontractor_invoices
  add column if not exists vendor_kind text not null default 'subcontractor';

-- 値を2つに固定する。増やす時は画面側の入力分岐も必ず一緒に直すこと。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subcontractor_invoices_vendor_kind_chk'
  ) then
    alter table public.subcontractor_invoices
      add constraint subcontractor_invoices_vendor_kind_chk
      check (vendor_kind in ('subcontractor', 'other'));
  end if;
end $$;

comment on column public.subcontractor_invoices.vendor_kind is
  '請求元区分: subcontractor=協力業者マスタ(subcontractor_id)に紐づく請求 / other=その他仕入先（vendor_name に自由入力の仕入先名を保存）。既定 subcontractor。';
