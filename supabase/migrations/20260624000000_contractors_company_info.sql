-- ============================================================
--  元請け(contractors) マスタに会社情報フィールドを追加
--  下請け(subcontractors)マスタ準拠＋元請け用に登録番号を追加（過不足調整）。
--  すべて追加のみ(ADD COLUMN・nullable)＝後方互換・非破壊。
-- ============================================================
alter table contractors add column if not exists representative_name  text;
alter table contractors add column if not exists mobile_phone         text;
alter table contractors add column if not exists office_phone         text;
alter table contractors add column if not exists email                text;
alter table contractors add column if not exists address              text;
alter table contractors add column if not exists registration_number  text;  -- インボイス登録番号（請求書宛先等で使用）
alter table contractors add column if not exists note                 text;  -- 備考
alter table contractors add column if not exists bank_name            text;
alter table contractors add column if not exists bank_branch          text;
alter table contractors add column if not exists bank_account_type    text;
alter table contractors add column if not exists bank_account_number  text;
alter table contractors add column if not exists bank_account_holder  text;
