-- ============================================================
--  20260804000000_sites_updated_at.sql
--  sites に updated_at を持たせ、更新をトリガで自動記録する
--
--  ★経緯（2026-08-03 の事故）:
--   現場マスタから誤って現場を1つ無効化したが、sites に updated_at が無く、
--   operation_logs にも有効/無効の切替が記録されていなかったため、
--   「どの現場を無効化したのか」を特定するのに **トランザクションID(xmin)** を
--   見るしかなかった。復旧はできたが、追跡手段が無いのは監査として穴。
--
--  ★なぜアプリ側で入れずトリガにするか:
--   sites への UPDATE は1か所ではない（有効/無効の切替・モーダル保存・現場マージ・
--   責任者の付け替え等）。アプリ側で個別に入れると必ず入れ忘れが出るので、
--   DB側で必ず立つようにする。
--
--  追加のみDDL（ADD COLUMN / CREATE FUNCTION / CREATE TRIGGER）。既存データは
--  created_at で埋めるため、見え方も既存の挙動も変わらない。
-- ============================================================

alter table sites add column if not exists updated_at timestamptz;

-- 既存行は「作成時から未更新」とみなす（NULLのままだと並び替えで扱いに困るため）
update sites set updated_at = created_at where updated_at is null;

alter table sites alter column updated_at set default now();

-- 共通の updated_at 自動更新関数（public に無かったのでここで作る。他表からも使える）
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sites_updated_at on sites;
create trigger trg_sites_updated_at
  before update on sites
  for each row execute function public.set_updated_at();

comment on column sites.updated_at is
  '最終更新日時（トリガで自動設定）。現場の無効化などを後から追跡するために追加（2026-08-04）';
