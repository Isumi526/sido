-- ============================================================
--  20260804020000_user_list_orders.sql
--  一覧の並び順を「ユーザーごとに」覚えておく。
--
--  ★背景: 現場別集計の現場タブは五十音順固定で、よく見る現場が毎回下の方にある。
--   頻度の自動集計ではなく **人が明示的に並べた順を保存する** 方式にした
--   （議事録の手書きメモ「ユーザーごとに並び替え情報を保存」を採用）。
--   自動集計にすると「なぜこの順なのか」が説明できず、順序が勝手に動いて混乱する。
--
--  ★汎用テーブルにしてある: list_key で画面/一覧を区別する（例 'site-reports.sites'）。
--   一覧ごとにテーブルを増やさないため。並べる対象は名前やIDの配列で持つ。
--
--  追加のみDDL（CREATE TABLE / CREATE INDEX / CREATE POLICY）。既存テーブルへの変更なし。
-- ============================================================

create table if not exists user_list_orders (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  -- 認証ユーザー単位。workers/users ではなく auth ユーザーに紐づける
  -- （並び順は「その人の画面の好み」なので、ログイン主体で持つのが素直）。
  auth_user_id  uuid not null,
  -- どの一覧か（例: 'site-reports.sites'）
  list_key      text not null,
  -- 並び順。要素は表示キー（現場名など）の配列。
  -- ★ここに無い項目は「未指定」として既定の並び（五十音順）で後ろに続ける＝
  --   新しい現場が増えても消えない。逆に消えた現場がここに残っていても無視される。
  item_keys     jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),

  constraint ulo_list_key_not_blank check (btrim(list_key) <> '')
);

-- 1ユーザー×1一覧につき1行（並び替えるたびに上書き）
create unique index if not exists ulo_user_list_uniq
  on user_list_orders(auth_user_id, list_key);

alter table user_list_orders enable row level security;

-- ★自分の行だけ。anon は一切触れない（ログインしていない人に画面の好みは無い）。
revoke all on user_list_orders from anon;
revoke all on user_list_orders from authenticated;
grant select, insert, update, delete on user_list_orders to authenticated;

drop policy if exists ulo_sel on user_list_orders;
create policy ulo_sel on user_list_orders for select to authenticated
  using (auth_user_id = auth.uid() and account_id = (select public.current_account_id()));

drop policy if exists ulo_ins on user_list_orders;
create policy ulo_ins on user_list_orders for insert to authenticated
  with check (auth_user_id = auth.uid() and account_id = (select public.current_account_id()));

drop policy if exists ulo_upd on user_list_orders;
create policy ulo_upd on user_list_orders for update to authenticated
  using (auth_user_id = auth.uid() and account_id = (select public.current_account_id()))
  with check (auth_user_id = auth.uid() and account_id = (select public.current_account_id()));

drop policy if exists ulo_del on user_list_orders;
create policy ulo_del on user_list_orders for delete to authenticated
  using (auth_user_id = auth.uid() and account_id = (select public.current_account_id()));

comment on table user_list_orders is
  '一覧の並び順のユーザー個人設定。list_key で一覧を区別する汎用テーブル。item_keys に無い項目は既定順で後ろに続く＝新規項目が消えない。';

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists user_list_orders;
