-- ============================================================
--  20260913130000_sites_kind_office.sql
--  オフィス・工場を現場マスタの「区分（kind）」で持つ／作業員の所属拠点（追加のみDDL）
--
--  2026-09-13 亥角: SEED は名古屋・東京の2オフィス。現場に紐づかない経費がオフィスごとに
--  月いくらかを台帳で見たい。今は「事務所（名古屋）」「事務所（東京）」「工場」が現場として
--  現場マスタに入っている（無理やり）。
--  ★決定: 別テーブル（会社情報にオフィス登録）は作らず sites.kind（site／office／factory）で持つ。
--   現場別集計・RLS・集計の消費箇所はそのまま使え、道具管理の拠点も同じ行を使い回せる。
--   経費申請（現場に紐づかない経費）は personal_expenses.site_id にオフィスを入れて
--   現場別集計にオフィスの行として並べる。既定値＝作業員の所属拠点（workers.base_site_id・任意）。
-- ============================================================
alter table public.sites add column if not exists kind text not null default 'site';
alter table public.sites drop constraint if exists sites_kind_check;
alter table public.sites add constraint sites_kind_check check (kind in ('site', 'office', 'factory'));
comment on column public.sites.kind is '区分: site=現場 / office=オフィス / factory=工場。office/factory は工程管理・スケジュールの候補から外し、経費申請の紐付け先になる（2026-09-13）';
create index if not exists sites_kind_idx on public.sites (account_id, kind);

alter table public.workers add column if not exists base_site_id uuid references public.sites(id);
comment on column public.workers.base_site_id is '所属拠点（kind=office/factory の現場・任意）。経費申請の紐付け先の既定値。横断する人は空でよい（2026-09-13）';

-- SEED（slug=sido）の既存データを区分へ移す（冪等・他テナント/ローカルは何もしない）
do $$
declare acc uuid;
begin
  select id into acc from public.accounts where slug = 'sido' limit 1;
  if acc is null then return; end if;
  update public.sites set kind = 'office'  where account_id = acc and name in ('事務所（名古屋）', '事務所（東京）') and kind = 'site';
  update public.sites set kind = 'factory' where account_id = acc and name = '工場' and active and kind = 'site';
end $$;
