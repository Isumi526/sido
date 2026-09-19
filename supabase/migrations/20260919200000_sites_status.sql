-- ============================================================
--  20260919200000_sites_status.sql
--  現場ステータスA-1：現場に5段階ステータス（見積中/受注/着工/完了/失注）を追加する。
--  Notion: 【現場ステータスA-1】 https://app.notion.com/p/3e00ff81c56b8193aec8e45c719f80b8
--  設計: docs/spec/現場ステータス・リソース予定_認識合わせ_20260919.html（2026-09-19 設計どおりで承認）
--
--  ★なぜ: 現場は「有効/無効」の2択しかなく、SEED本番は有効122件/無効64件が全画面に並ぶ＝情報過多
--   （2026-09-10 打合せ）。実際の現場は 見積中→受注→着工→完了（途中で失注）と進む。
--
--  ★active 列は当面残す（A-3 で撤去）。理由＝admin/LIFF/EF 合わせて 30 箇所超が eq('active', true) で
--   絞っており、一斉に差し替えると事故る。トリガで status⇄active を双方向に同期し、
--   ・status を書く新しい画面 → active が自動で追従（既存の絞り込みが従来どおり動く）
--   ・active を書く古い画面（現場詳細のトグル・マージの吸収元・LIFFの現場作成）→ status が追従
--  の両方を成立させ、画面ごとに A-2 で status 参照へ順次差し替える。
--
--  ★このマイグレーションは追加のみ＋既存行の backfill（active=true→着工 / false→完了）。
--   backfill は status 列追加直後の 1 回だけ（既定値 in_progress から無効行だけ completed に倒す）。
-- ============================================================

alter table public.sites
  add column if not exists status text not null default 'in_progress';
alter table public.sites drop constraint if exists sites_status_check;
alter table public.sites
  add constraint sites_status_check
  check (status in ('estimating', 'ordered', 'in_progress', 'completed', 'lost'));
comment on column public.sites.status is
  'estimating=見積中 / ordered=受注 / in_progress=着工 / completed=完了 / lost=失注（2026-09-19 A-1）。active はここから導出';

alter table public.sites add column if not exists lost_reason text;
comment on column public.sites.lost_reason is '失注にした時の理由（任意・単価の参考データとして残す）';

-- 既存行の移し替え: 有効→着工 / 無効→完了（承認済み ❓1=A）
update public.sites set status = 'completed' where active = false and status = 'in_progress';

create index if not exists sites_account_status_idx on public.sites (account_id, status);

-- ── status ⇄ active の双方向同期 ────────────────────────────
create or replace function public.sites_sync_status_active()
returns trigger
language plpgsql
as $$
declare
  v_open constant text[] := array['estimating', 'ordered', 'in_progress'];
begin
  if tg_op = 'INSERT' then
    -- 古い作成経路（LIFF の現場作成・協力業者請求からの追加等）は status を渡さず active だけ渡す。
    -- active=false で作られた行は「完了」として扱う（status が既定値のままの時だけ）。
    if new.active = false and new.status = 'in_progress' then
      new.status := 'completed';
    end if;
    new.active := new.status = any (v_open);
    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    -- 新しい画面（ステータス変更）が優先。active は導出
    new.active := new.status = any (v_open);
  elsif new.active is distinct from old.active then
    -- 古い画面（有効/無効トグル・マージの吸収元）が active だけを書いた時は status を追従させる
    if new.active then
      if not (old.status = any (v_open)) then new.status := 'in_progress'; end if;
    else
      if old.status = any (v_open) then new.status := 'completed'; end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sites_sync_status_active on public.sites;
create trigger trg_sites_sync_status_active
  before insert or update on public.sites
  for each row execute function public.sites_sync_status_active();
