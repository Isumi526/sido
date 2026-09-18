-- ============================================================
--  20260918150000_tool_locations_base_site.sql
--  道具①レビュー指摘（2026-09-18・亥角）: 保管場所の「拠点」を自由入力テキストから
--  現場マスタの拠点行（sites.kind = office / factory）への参照に置き換える。
--
--  ★なぜ: 2026-09-13 の決定（20260913130000_sites_kind_office.sql）で「オフィス・工場は別テーブルを
--   作らず sites.kind で持ち、道具管理の拠点も同じ行を使い回す」と決めてあった。道具①はこれを
--   見落として tool_locations.base を text にしていた＝経費・所属拠点・道具で「拠点」の定義が割れる。
--
--  ★本番は道具①未リリース（tools / tool_locations とも 0 行・2026-09-18 実測）。
--   列の作り直しだが失うデータは無い。null 行の delete はローカル/E2E の残骸だけに当たる。
-- ============================================================
alter table public.tool_locations
  add column if not exists base_site_id uuid references public.sites(id);
comment on column public.tool_locations.base_site_id is
  '拠点＝現場マスタの office/factory 行（2026-09-18・道具①レビュー指摘）。text の base 列は廃止';

-- 旧: 拠点テキスト＋場所名で一意 → 新: 拠点サイト＋場所名で一意
alter table public.tool_locations drop constraint if exists tool_locations_name_uniq;
delete from public.tool_locations where base_site_id is null;   -- 未リリース＝本番 0 行。ローカルの旧形式行だけ消える
alter table public.tool_locations drop column if exists base;
alter table public.tool_locations alter column base_site_id set not null;
alter table public.tool_locations
  add constraint tool_locations_name_uniq unique (account_id, base_site_id, name);

drop index if exists public.tool_locations_account_idx;
create index if not exists tool_locations_account_idx
  on public.tool_locations (account_id, active, base_site_id, sort_order);
