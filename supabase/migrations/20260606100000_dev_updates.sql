-- ============================================================
--  開発の更新履歴（管理画面トップに表示するお知らせ）
--  - 全社共通（account_id なし）。OK でアーカイブ（archived=true）
--  - 追加のみ・後方互換。RLS は既存方針に合わせ無効
-- ============================================================
create table if not exists dev_updates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,                       -- 1行要約
  link       text,                                -- 該当ページ: admin内は '/expenses' 等 / それ以外は 'https://…'
  archived   boolean not null default false,
  created_at timestamptz not null default now()   -- 表示順・日付（初期データは実日付を指定）
);

create index if not exists dev_updates_archived_created_idx
  on dev_updates(archived, created_at desc);

alter table dev_updates disable row level security;
