-- ============================================================
--  現場↔ユーザー の共有紐付け（n:m）＝「この現場情報(情報/図面)を閲覧できるユーザー」
--  現場管理者以上が管理画面で現場ごとに共有ユーザーを複数選択・登録する。
--  現状 LIFF は同一 account の全現場が誰にでも見えている（情報露出）ため、これを紐付いた現場だけに
--  絞る土台。★アクセス制御の実強制（fail-closed）は Part B（edge function 経由の server-side 認可）で
--  行う。本テーブルは Part A（データモデル＋admin管理UI）分＝共有関係の保持のみ。
--  追加のみDDL・後方互換（既存の閲覧挙動は Part B 実装まで不変）。
-- ============================================================
create table if not exists site_shares (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  account_id  uuid references accounts(id),
  created_at  timestamptz not null default now(),
  unique (site_id, user_id)
);
create index if not exists site_shares_site_idx    on site_shares(site_id);
create index if not exists site_shares_user_idx    on site_shares(user_id);
create index if not exists site_shares_account_idx on site_shares(account_id);

-- 既存の露出表（site_subcontractors 等）と同じ運用。読取の fail-closed 認可は Part B の edge function
-- （service_role）で site_shares を突き合わせて行う。
grant select, insert, update, delete on site_shares to anon, authenticated, service_role;
