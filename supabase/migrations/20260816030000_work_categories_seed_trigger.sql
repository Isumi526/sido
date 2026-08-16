-- ============================================================
--  20260816030000_work_categories_seed_trigger.sql
--  新しい会社（accounts）を作った時に、標準の作業区分を自動で入れる
--
--  ★なぜ必要か（2026-08-16 の実装漏れ）:
--   20260816020000 は「実行した時点の既存アカウント」に区分を入れただけだった。
--   その後に作られた会社には区分が1件も入らず、日報・予定で区分を選べない。
--   要件は「これから新規追加されるアカウントに対しても標準で追加する」だったので、
--   マイグレーション1回きりの INSERT では足りない。
--
--  ★なぜトリガーにするか:
--   accounts を作る経路がアプリ側に無い（今は手作業でINSERTしている）。
--   アプリに処理を足しても、手で作られたら通らない。DB 側に置けば経路を問わず効く。
--
--  ★標準区分は「入れておく」だけで固定はしない。
--   不要なら管理画面から削除できる（is_default は表示上の目印であって制約ではない）。
-- ============================================================

create or replace function public.seed_default_work_categories()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.work_categories (account_id, name, scope, sort_order, is_default)
  values
    (new.id, '現場作業',  'site', 10, true),
    (new.id, '見積',      'site', 20, true),
    (new.id, 'その他事務', null,  30, true)
  -- ★同名が既にあれば何もしない。手動で先に作ってから accounts を入れ直す等の
  --  経路でも落ちないようにする（seed が失敗して会社の作成ごと巻き戻るのを避ける）
  on conflict (account_id, name) do nothing;
  return new;
end;
$$;

comment on function public.seed_default_work_categories is
  '新しい会社に標準の作業区分（現場作業/見積/その他事務）を入れる。'
  ' 20260816020000 は既存アカウントにしか入れておらず、以後に作られた会社が'
  ' 区分ゼロになる漏れがあったため追加（2026-08-16）。';

drop trigger if exists accounts_seed_work_categories on public.accounts;
create trigger accounts_seed_work_categories
  after insert on public.accounts
  for each row execute function public.seed_default_work_categories();

-- ★取りこぼしの補完。20260816020000 の適用後・本トリガー作成前に
--  作られた会社があっても、ここで入る（冪等）。
insert into public.work_categories (account_id, name, scope, sort_order, is_default)
select a.id, v.name, v.scope, v.sort_order, true
from public.accounts a
cross join (values
  ('現場作業', 'site', 10),
  ('見積',     'site', 20),
  ('その他事務', null, 30)
) as v(name, scope, sort_order)
on conflict (account_id, name) do nothing;

-- ── ロールバック手順 ────────────────────────────────
--   drop trigger if exists accounts_seed_work_categories on public.accounts;
--   drop function if exists public.seed_default_work_categories();
--   （既に入った区分は残る。消したい場合は work_categories から個別に削除する）
