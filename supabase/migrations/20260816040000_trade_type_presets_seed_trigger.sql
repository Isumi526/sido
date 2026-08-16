-- ============================================================
--  20260816040000_trade_type_presets_seed_trigger.sql
--  工種プリセットを未投入の会社に補完し、新規会社にも自動で入るようにする
--
--  ★同じ穴が2件目（2026-08-16 発見）:
--   20260530000001 が `-- 初期プリセット（全既存アカウントに投入）` として
--   当時の2社（sido / test）に入れたきりで、その後に作られた3社
--   （demo / demo2 / hiromokkou）は **0件**だった。
--   work_categories で今日踏んだのと**まったく同じパターン**。
--
--  ★実害:
--   協力業者マスタの工種選択（admin の subcontractors.vue / LIFF の
--   subcontractors/index.vue）が、この3社では**選択肢ゼロ**で表示される。
--
--  ★マイグレーション1回きりの INSERT は「その時いた会社」にしか効かない。
--   会社は後から増えるので、トリガーで経路を問わず効かせる。
--   accounts を作る経路はアプリ側に無く（今は手作業でINSERT）、
--   アプリ側に処理を足しても手で作られたら通らない。
-- ============================================================

create or replace function public.seed_default_trade_type_presets()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.trade_type_presets (name, category, is_preset, sort_order, account_id)
  select v.name, v.category, true, v.sort_order, new.id
  from (values
    ('軽鉄（LGS）工事',     '下地・造作工事', 1),
    ('ボード工事',           '下地・造作工事', 2),
    ('木工・造作工事',       '下地・造作工事', 3),
    ('左官工事',             '下地・造作工事', 4),
    ('クロス（壁紙）工事',   '仕上げ工事',     5),
    ('塗装工事',             '仕上げ工事',     6),
    ('床仕上げ工事',         '仕上げ工事',     7),
    ('木製・金属製建具工事', '仕上げ工事',     8),
    ('電気設備工事',         '設備工事',       9),
    ('空調・換気設備工事',   '設備工事',       10),
    ('給排水衛生設備工事',   '設備工事',       11)
  ) as v(name, category, sort_order)
  -- ★同名が既にあれば何もしない。seed の失敗で会社の作成ごと巻き戻るのを避ける
  on conflict (name, account_id) do nothing;
  return new;
end;
$$;

comment on function public.seed_default_trade_type_presets is
  '新しい会社に工種プリセット11件を入れる。20260530000001 は当時の既存アカウントに'
  ' しか入れておらず、以後に作られた3社が0件になっていたため追加（2026-08-16）。';

drop trigger if exists accounts_seed_trade_type_presets on public.accounts;
create trigger accounts_seed_trade_type_presets
  after insert on public.accounts
  for each row execute function public.seed_default_trade_type_presets();

-- ── 未投入の会社へ補完（冪等）──────────────────────────
--  ★既存の独自追加（is_preset=false）は触らない。プリセット11件を足すだけ。
--   本番実測では独自追加は全社0件だが、将来のために条件を明示しておく。
insert into public.trade_type_presets (name, category, is_preset, sort_order, account_id)
select v.name, v.category, true, v.sort_order, a.id
from public.accounts a
cross join (values
  ('軽鉄（LGS）工事',     '下地・造作工事', 1),
  ('ボード工事',           '下地・造作工事', 2),
  ('木工・造作工事',       '下地・造作工事', 3),
  ('左官工事',             '下地・造作工事', 4),
  ('クロス（壁紙）工事',   '仕上げ工事',     5),
  ('塗装工事',             '仕上げ工事',     6),
  ('床仕上げ工事',         '仕上げ工事',     7),
  ('木製・金属製建具工事', '仕上げ工事',     8),
  ('電気設備工事',         '設備工事',       9),
  ('空調・換気設備工事',   '設備工事',       10),
  ('給排水衛生設備工事',   '設備工事',       11)
) as v(name, category, sort_order)
on conflict (name, account_id) do nothing;

-- ── ロールバック手順 ────────────────────────────────
--   drop trigger if exists accounts_seed_trade_type_presets on public.accounts;
--   drop function if exists public.seed_default_trade_type_presets();
--   -- 補完で入った分だけ消す場合（独自追加は残す）:
--   -- delete from trade_type_presets p using accounts a
--   --   where p.account_id = a.id and p.is_preset and a.slug in ('demo','demo2','hiromokkou');
