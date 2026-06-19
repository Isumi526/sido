-- ============================================================
--  20260619010000_sites_contractor_link.sql
--  現場(sites)に元請け(contractors)を紐付ける（現場↔元請け）
--   - 1現場=1元請けの想定で sites.contractor_id を追加（nullable＝未紐付けは従来どおり）。
--   - 日報で元請けを選ぶと、その元請けに紐づく現場だけにプルダウンを絞り込むために使う。
--   - 後方互換: nullable・既存現場は未紐付けのまま全現場として扱える。
--  追加のみDDL（ADD COLUMN / CREATE INDEX）。破壊的変更なし。
--  ロールバック: alter table sites drop column contractor_id;
-- ============================================================
alter table sites add column if not exists contractor_id uuid references contractors(id);
create index if not exists sites_contractor_idx on sites (contractor_id);
