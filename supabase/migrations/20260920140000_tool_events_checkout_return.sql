-- ============================================================
--  20260920140000_tool_events_checkout_return.sql
--  道具②（2026-09-10 SEED 会議・設計書 T-1・確認事項2=A 仮置き）: QR で持出／返却／又貸し。
--   - 位置情報は「抑止」目的（QR を写真に残して遠隔操作する抜け道を塞ぐ）。所定場所との自動照合はしない。
--     取れなかった時（拒否・圏外）も記録できる＝「位置なし」として残す（確認事項2=A）。
--   - 返却は場所QR→道具QR。返した場所（tool_locations）を道具の「今ある場所」として持つ（定位置 location_id とは別）。
--  ★追加のみ（列＋部分一意index）。
--  ロールバック: alter table tool_events drop column accuracy, located_at, client_request_id;
--                alter table tools drop column current_location_id;
-- ============================================================
alter table public.tool_events
  add column if not exists accuracy   double precision,      -- 位置情報の精度（m）。null＝位置なし
  add column if not exists located_at timestamptz,           -- 位置情報を取った時刻
  add column if not exists client_request_id uuid;           -- 連打・再送のべき等キー
comment on column public.tool_events.accuracy is '位置情報の精度（m）。lat/lng が null なら「位置なし」で記録（確認事項2=A）';

create unique index if not exists tool_events_client_request_uidx
  on public.tool_events (account_id, client_request_id)
  where client_request_id is not null;

alter table public.tools
  add column if not exists current_location_id uuid references public.tool_locations(id) on delete set null;
comment on column public.tools.current_location_id is
  '今ある保管場所（最後に返却された場所QR）。定位置 location_id とは別。持出中は null';
