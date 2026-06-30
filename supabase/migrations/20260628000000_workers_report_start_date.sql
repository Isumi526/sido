-- ============================================================
--  workers.report_start_date 追加（日報提出開始日・作業員ごと）
--  - 未送信者判定/リマインドの「各人の起点」を作業員ごとに上書きできるようにする。
--  - null = 従来どおり workers.created_at（作業員マスタ登録日）を起点にする（後方互換）。
--  - 追加のみDDL（既存データ非破壊）。
-- ============================================================
alter table public.workers
  add column if not exists report_start_date date;

comment on column public.workers.report_start_date is
  '日報提出開始日。未送信者判定/リマインドの起点を作業員ごとに上書き（null=従来どおり workers.created_at を起点）。service_start_date より前なら service_start_date が優先。';
