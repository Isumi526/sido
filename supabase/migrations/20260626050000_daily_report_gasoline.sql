-- 日報レベルの「本日のガソリン代」（実費）。
--  ガソリンは給油1回で全現場ぶんをカバーし特定の現場に紐づかないため、現場ブロックの外＝日報レベルに持つ。
--  1日に複数回給油できるよう明細リスト(gasoline_items)で保持する。
--   各明細: { yen, payee, registrationNumber, tategae, fileUrls } （JSON）
--  用途: ①ガソリン按分ページの「実費」= 当月合計を距離比で配賦 ②立替明細は経費精算に日報日の期で加算。
--  追加のみ（後方互換）。LIFF は anon キーで読み書き（daily_reports は RLS 無効・既存方針）。
alter table public.daily_reports
  add column if not exists gasoline_items jsonb not null default '[]'::jsonb;
