-- ============================================================
--  20260704040000_faq_knowledge_base.sql
--  FAQナレッジDB（AIチャットBot土台 / T1）。
--   - アプリ内AIヘルプ（ai-chat EF）が読む「FAQナレッジ」の格納先。
--     現状 ai-chat は SYSTEM を固定文字列で持つだけ＝DB由来のナレッジが無い。本テーブルで
--     テナントごとに 質問/回答/カテゴリ/言い換えバリエーション を運用追加できるようにし、
--     ai-chat が systemInstruction にFAQを注入して回答精度を上げる下地にする（後続 T2〜T5 が依存）。
--   - variations は「聞かれ方の言い換え」を複数持たせ、将来の retrieval ヒット率向上の下地（T4）。
--   - 種は「実問い合わせログ起点」。ログが揃うまでは管理画面から少数を運用追加で開始（チケットの
--     フォールバック方針。想像で埋めず、実際に聞かれた質問を運用で足していく）。
--   - RLS は既存マスタ/schedules と同じく無効（マスタ層のRLS化は親エピックで一括）。account_id で論理分離。
--   追加のみDDL（CREATE TABLE / INDEX）。非破壊・後方互換。
-- ============================================================
create table if not exists faq_entries (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  question    text not null,                       -- 代表的な質問文
  answer      text not null,                       -- 回答（AIが根拠として使う）
  category    text,                                -- 分類（日報/経費/見積 等・任意）
  variations  jsonb not null default '[]'::jsonb,  -- 聞かれ方の言い換え（string配列）
  sort_order  integer not null default 0,          -- 表示順（小さいほど上）
  is_active   boolean not null default true,       -- false=AIに渡さない（下書き/無効）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists faq_entries_account_idx
  on faq_entries (account_id);
create index if not exists faq_entries_account_active_idx
  on faq_entries (account_id, is_active, sort_order);

alter table faq_entries disable row level security;
