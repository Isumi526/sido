-- ============================================================
--  現場の住所を整える（2026-10-02 設計「入力の手間を減らす」I-4・要望14）
--  距離の候補（I-5）・高速代の目安（I-6）のため、現場の位置（緯度経度）を持つ。
--  候補は管理画面「住所の無い現場」で Google の住所検索から選ぶ（EF site-address-suggest・鍵は EF の secret）。
--  ★住所を書き換えたのに位置が古いままだと距離が狂うので、住所が変わって位置が一緒に渡されなかった時は位置を消す（トリガー）。
--  ★追加のみ（既存の行は NULL のまま）
-- ============================================================
alter table public.sites add column if not exists lat double precision;
alter table public.sites add column if not exists lng double precision;
alter table public.sites add column if not exists geocoded_at timestamptz;
comment on column public.sites.lat is '現場の緯度（住所の候補から確定した時だけ入る。住所を書き換えると消える）';
comment on column public.sites.lng is '現場の経度（同上）';
comment on column public.sites.geocoded_at is '位置を確定した日時';

create or replace function public.sites_clear_stale_geo() returns trigger
language plpgsql as $$
begin
  if new.location is distinct from old.location
     and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    new.lat := null; new.lng := null; new.geocoded_at := null;
  end if;
  return new;
end $$;

drop trigger if exists sites_clear_stale_geo on public.sites;
create trigger sites_clear_stale_geo before update of location on public.sites
  for each row execute function public.sites_clear_stale_geo();

-- ↩ ロールバック: drop trigger sites_clear_stale_geo on public.sites; drop function public.sites_clear_stale_geo();
--   列は残しても既存の動きに影響しない
