-- ============================================================
--  supabase/migrations/20260602000002
--  元請け業者マスタ（contractors）
--
--  既存の sites / subcontractors マスタと同じ構造・運用に準拠する。
--   - マルチテナント: account_id を持ち、クエリ側で絞り込み
--   - unique は per-account（name, account_id）
--   - RLS は他マスタ同様 無効（LIFFは anon キーで直叩き）
--  初期データは投入しない（現場と同様に運用で登録）。
-- ============================================================

create table if not exists contractors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

alter table contractors disable row level security;

-- name の重複はアカウント単位で禁止（upsert の onConflict 'name,account_id' 用）
create unique index if not exists contractors_name_account_uidx
  on contractors(name, account_id);
