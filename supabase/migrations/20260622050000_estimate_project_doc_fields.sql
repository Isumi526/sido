-- ============================================================
--  【見積書フォーマット】見積書の表紙/内訳書に出す案件側の項目を estimate_projects に追加。
--   - 工事場所・予定工期・見積有効期限・MEMO・端数調整。
--   - 自社情報（会社名/代表者/住所/TEL/FAX/印影/法定福利費率/消費税率/支払条件/別途注記）は
--     settings(key/value) に保存（マイグレ不要）。
--  すべて追加のみDDL（ADD COLUMN）。破壊的変更なし。
-- ============================================================
alter table estimate_projects add column if not exists construction_location text;            -- 工事場所
alter table estimate_projects add column if not exists period_text text;                      -- 予定工期（自由記述）
alter table estimate_projects add column if not exists valid_until text;                      -- 見積有効期限（自由記述）
alter table estimate_projects add column if not exists memo text;                             -- MEMO
alter table estimate_projects add column if not exists adjustment integer not null default 0; -- 端数調整（±円）
