-- ============================================================
--  supabase/migrations/20260728080000
--  見積R6: 品名/品番から商品情報（画像・サイズ展開・仕様）をネット検索して表示
--
--  背景（2026-07-28 ユーザー通しレビュー・音声）:
--   「品名を選択したときに、商品の詳細画像とか、どんなサイズがあるかとかを
--     ネット検索・AIで調べてぱっとUI上で表示したい。現状の業務フローだと、
--     毎回その品名で Google 検索なり ChatGPT なりで調べて『あー、こんなんね』って
--     認識してる」
--   → 人が毎回やっている検索作業をそのまま置き換えるのが目的。
--     情報源が公式カタログである必要はない（要回答チケットの推奨Cは不採用）。
--
--  ★キャッシュする理由: 同じ品名を打つたびに生成AIを叩くと、金も時間もかかる。
--    見積は同じ材料を繰り返し使うので、キャッシュヒット率は高い。
--
--  Notion: R6 3a50ff81c56b81638fc2e49ae3b750bb
--  admin(authenticated)専用のためRLS有効・account_idスコープ。
-- ============================================================

create table if not exists estimate_product_info (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  -- 正規化した検索キー（品番があれば品番、無ければ品名）。同じものを二度調べない。
  lookup_key  text not null,
  name        text,
  product_code text,
  maker       text,
  sizes       text,                       -- サイズ展開（例: 910×1820 / 910×2420）
  spec        text,                       -- 仕様の要約
  image_url   text,
  source_urls jsonb not null default '[]'::jsonb,
  -- ★見つからなかったこと自体も記録する。記録しないと毎回AIを叩き直すことになる。
  not_found   boolean not null default false,
  fetched_at  timestamptz not null default now()
);
create unique index if not exists est_prodinfo_key_uidx on estimate_product_info(account_id, lookup_key);

alter table estimate_product_info enable row level security;
revoke all on estimate_product_info from anon;
grant select, insert, update, delete on estimate_product_info to authenticated;

drop policy if exists est_prodinfo_sel on estimate_product_info;
create policy est_prodinfo_sel on estimate_product_info for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_prodinfo_ins on estimate_product_info;
create policy est_prodinfo_ins on estimate_product_info for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_prodinfo_upd on estimate_product_info;
create policy est_prodinfo_upd on estimate_product_info for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_prodinfo_del on estimate_product_info;
create policy est_prodinfo_del on estimate_product_info for delete to authenticated
  using (account_id = (select public.current_account_id()));
