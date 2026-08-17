-- ============================================================
--  20260817010000_work_categories_add_training_travel.sql
--  標準の作業区分に「講習」「移動」を足す
--
--  ★なぜ（2026-08-17・既存データの移行で分かった）:
--   本番の現場マスタには「安全衛生講習」「バウハウス 管理者講習」「研修／勉強会」
--   「移動」が “現場” として登録されていた。現場ではないので台帳×区分へ寄せたが、
--   受け皿の区分が標準3種（現場作業/見積/その他事務）に無く、どちらも
--   「その他事務」に丸めるしかなかった。講習は法定のものがあり件数も追いたい、
--   移動は現場の原価に混ぜたくない、と性質が違うので独立した区分にする。
--   2社（シード・ヒロ木工）とも同じ使い方をしていた＝他社でも要る、と判断した。
--
--  ★新しい会社にも入るようにする。
--   20260816030000 と同じ轍（既存アカウントにだけ入れて、以後に作られた会社が
--   区分ゼロになる）を踏まないよう、トリガー関数の定義そのものを差し替える。
--
--  ★scope は null（現場に紐づかない作業でも選べる）。
--   講習も移動も「どの現場の作業でもない」ことがあるため。
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
    (new.id, 'その他事務', null,  30, true),
    (new.id, '講習',      null,  40, true),
    (new.id, '移動',      null,  50, true)
  on conflict (account_id, name) do nothing;
  return new;
end;
$$;

comment on function public.seed_default_work_categories is
  '新しい会社に標準の作業区分（現場作業/見積/その他事務/講習/移動）を入れる。'
  ' 20260816030000 で追加、2026-08-17 に講習・移動を追加。';

-- 既存の会社にも入れる（冪等）
insert into public.work_categories (account_id, name, scope, sort_order, is_default)
select a.id, v.name, v.scope, v.sort_order, true
from public.accounts a
cross join (values
  ('講習', null, 40),
  ('移動', null, 50)
) as v(name, scope, sort_order)
on conflict (account_id, name) do nothing;

-- ★移行スクリプト（scripts/migrate-work-categories-2026-08-17.mjs）が先に入れた分は
--  is_default が付いていない。標準として扱う印を揃える。
update public.work_categories set is_default = true
where name in ('講習', '移動') and coalesce(is_default, false) = false;

-- ── ロールバック手順 ────────────────────────────────
--   標準に戻す（関数を 20260816030000 の3種に差し戻す）＋
--   delete from public.work_categories where name in ('講習','移動');
--   ※ 日報が参照している場合は先に参照を外すこと
