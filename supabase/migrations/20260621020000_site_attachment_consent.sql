-- ============================================================
--  supabase/migrations/20260621020000_site_attachment_consent
--  送り出し資料の出退勤時同意（追加のみDDL）
--   - site_attachments.require_consent: チェックイン時に同意必須の資料か
--   - attendance_logs.agreed_document_names: 同意した資料名スナップショット
--     （既存 agreed_rule_texts と同じ denormalize 方式＝誰・いつ・対象資料が残る）
-- ============================================================
alter table site_attachments add column if not exists require_consent boolean not null default false;
alter table attendance_logs  add column if not exists agreed_document_names text[];
