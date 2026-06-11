-- ============================================================
--  20260611100000_subcontractor_access_tokens.sql
--  下請け業者向け トークン認証基盤（#2 AC3）
--   - 業者がログイン無しで、メールのトークンURLから自社分だけ閲覧/操作するための土台
--   - 平文トークンは保存せず SHA-256 ハッシュのみ保存（漏洩耐性）
--   - account/業者/文書 の三重スコープを Edge Function(service role) で適用する前提
--  追加のみDDL（CREATE TABLE / CREATE INDEX）。破壊的変更なし。
--  ※ 真の分離には別途「本番DBのRLS有効化」タスクが必要（anonキー公開のため）。
-- ============================================================
create table if not exists document_access_tokens (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) not null,
  subcontractor_id uuid references subcontractors(id) not null,
  purpose          text not null,            -- 'order_accept' / 'invoice_submit' 等
  document_type    text,                     -- 'purchase_order' / 'invoice' 等（任意）
  document_id      uuid,                     -- 対象文書ID（業者単位トークンなら null）
  token_hash       text not null unique,     -- SHA-256(token) の16進。平文は保存しない
  expires_at       timestamptz,              -- 失効（null=無期限）
  revoked_at       timestamptz,              -- 手動失効
  used_at          timestamptz,              -- 単回利用にする場合の使用済み記録
  last_accessed_at timestamptz,
  created_by       uuid references workers(id),
  created_at       timestamptz default now()
);

create index if not exists dat_token_hash_idx       on document_access_tokens (token_hash);
create index if not exists dat_subcontractor_idx    on document_access_tokens (subcontractor_id);
create index if not exists dat_account_idx          on document_access_tokens (account_id);

-- 既存マスタ群と同様（現状はアプリ/Edge側でスコープ）。RLS有効化は別タスクで実施。
alter table document_access_tokens disable row level security;
