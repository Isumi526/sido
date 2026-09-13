-- ============================================================
--  20260913110000_sites_period.sql
--  現場に工期（開始日〜終了日）を持たせる（追加のみDDL）
--
--  2026-09-10 SEED 大塚さん: 会社予定（工程管理）に現場が出ない真因は sites が工期を持たず
--  process_tasks（Excel取込の工程行）だけを描画していたため。「現場を作る時に工期を打ち込む。
--  工程表はPDFを貼ってクリックで見られればいい。AI解析は要らない」（G+0:19:04〜0:19:59）。
--  ★終了日は「未定」を許容する（大塚「決まってない」現場あり G+0:13:37）＝ period_end は NULL 可。
--  ★工程表PDFは既存の site_attachments に kind='schedule' で入れる（kind は free text・CHECK なし）。
--  ★既存現場は工期 NULL のまま（自動で埋めない。会社予定では「工期未定」グループに出る）。
-- ============================================================
alter table public.sites
  add column if not exists period_start date,
  add column if not exists period_end   date;

comment on column public.sites.period_start is '工期の開始日（会社予定の帯の左端）。NULL=未設定';
comment on column public.sites.period_end   is '工期の終了日（NULL=未定。開始日だけでも会社予定に出す）';

create index if not exists sites_period_idx on public.sites (account_id, period_start, period_end);
