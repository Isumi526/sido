-- ============================================================
--  20260903120000_faq_auto_generate.sql
--  AIヘルプのナレッジ(FAQ)をFableに定期生成させる（2026-08-30運用者判断）:
--   - 元ネタ = Notionのバックログ（完了チケット）のみ。まず着手できる範囲から
--     （議事録データソースはserver側のNotion連携が未共有のため今回は対象外・
--     継続タスクとしてチケットに明記）。
--   - 生成物は必ず is_active=false（下書き）で作る。自動有効化はしない。
--   - 生成のたびにNotionへレビュー用チケットを起票する（人がFAQ画面で確認・
--     有効化するまでAIヘルプの回答には使われない）。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

alter table public.faq_entries add column if not exists source text not null default 'manual';
alter table public.faq_entries add column if not exists notion_ticket_url text;

comment on column public.faq_entries.source is
  'manual=人が登録／ai-fable=faq-generate EFが自動生成した下書き。'
  ' AI生成分は必ずis_active=falseで作られ、人がFAQ画面でレビューして有効化する。';
comment on column public.faq_entries.notion_ticket_url is
  'AI生成分の人力レビューを依頼したNotionチケットのURL（同じバッチでの重複起票を防ぐため）。';
