-- ============================================================
--  20260703010000_workers_dual_wage.sql
--  作業員に「日当単価」と「時給(実質賃金)」を両方持たせる（従来は wage_type で単一 unit_price）。
--   - 日報/各集計の既定人件費 = 日当/8h × 稼働時間（原価設定値・現場管理者も閲覧OK）。
--   - office以上のみ 実質賃金(時給 × 稼働時間) に切替可（月次集計・現場別集計のトグル）。
--  方針：追加のみDDL（ADD COLUMN のみ）。既存 unit_price / wage_type は後方互換のため温存し、
--        新コードは daily_wage / hourly_wage を参照する。バックフィルで既存値を両カラムへ写す。
--  破壊的変更なし（DROP/型変更/NOT NULL追加なし）。
-- ============================================================

-- workers: 日当・時給の2カラム（既定値付き＝既存行も安全に埋まる）
alter table workers add column if not exists daily_wage  int not null default 20000;  -- 日当単価（円/日）原価設定
alter table workers add column if not exists hourly_wage int not null default 2000;   -- 時給（円/h）実質賃金

-- 既存データのバックフィル（unit_price/wage_type から推定）：
--   wage_type='hourly' → unit_price は時給 ⇒ hourly_wage=unit_price, daily_wage=unit_price*8
--   それ以外(daily)     → unit_price は日当 ⇒ daily_wage=unit_price,  hourly_wage=round(unit_price/8)
update workers
set daily_wage  = case when wage_type = 'hourly' then unit_price * 8 else unit_price end,
    hourly_wage = case when wage_type = 'hourly' then unit_price      else round(unit_price / 8.0)::int end
where daily_wage = 20000 and hourly_wage = 2000;   -- まだ未バックフィル(既定値のまま)の行だけ

-- 賃金変更履歴も日当・時給の両方を追跡できるように（追加のみ・既存 old/new_unit_price は日当履歴として温存）
alter table worker_wage_history add column if not exists old_daily_wage  int;
alter table worker_wage_history add column if not exists new_daily_wage  int;
alter table worker_wage_history add column if not exists old_hourly_wage int;
alter table worker_wage_history add column if not exists new_hourly_wage int;
