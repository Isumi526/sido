-- ============================================================
--  supabase/migrations/20260622000000_estimate_schema
--  【見積】E3 データ基盤・スキーマ構築（追加のみDDL / 土台）
--   見積もりサブシステム（全体見積→工種別分割→帳票PDF）のマスタ＋明細。
--   - 既存 estimates（下請けの見積書PDF登録）とは別物のため estimate_ 接頭辞で名前空間分離。
--   - admin専用機能のため purchase_orders 方式の RLS有効（account_id分離・anon全拒否）。
--     ＝新規テーブルでも anon×RLS無効の漏えい面を作らない（vehicle_repair_logs 方式の
--       「RLS無効＋accepted.yml追跡」ではなく、最初からRLS有効で閉じる）。
--   - current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
--  対象: E1(工種別自動分割)/E2(帳票PDF)/E4(価格表OCR)/E5(マスタ蓄積)/E6(入力UI)/E7(商社別単価) の前提。
-- ============================================================

-- ── projects（案件）────────────────────────────────────────
create table if not exists estimate_projects (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  name        text not null,                       -- 案件名
  client_name text,                                -- 発注元/客先
  site_id     uuid references sites(id),           -- 任意：現場紐付け
  status      text not null default 'draft',       -- draft/active/closed
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── categories（部位/大分類）── 場所/部位のマスタ（account単位）─
create table if not exists estimate_categories (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ── trades（工種/小分類 ＋ default発注先）──────────────────────
create table if not exists estimate_trades (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid references accounts(id) not null,
  name                    text not null,                          -- 例: 軽鉄工事
  default_subcontractor_id uuid references subcontractors(id),    -- 工種の既定発注先（E1の工種別グルーピング）
  sort_order              int not null default 0,
  created_at              timestamptz not null default now()
);

-- ── 商社（仕入先）は新設せず、既存 subcontractors（区分=商社）を流用する ──
--   工種の発注先(業者)も商社も「取引先」＝subcontractors に統一（区分 category で 商社/業者 を分ける）。
--   見積の商社別単価は subcontractors(category='商社') を参照する。

-- ── materials（材料・品番・maker属性・source）────────────────
create table if not exists estimate_materials (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  code        text,                                -- 品番（予測変換キー）
  name        text not null,                       -- 材料名
  maker       text,                                -- メーカー
  unit        text,                                -- 単位
  spec        text,                                -- 規格/仕様
  trade_id    uuid references estimate_trades(id), -- 紐づく工種（任意）
  source      text not null default 'manual',      -- manual/excel_import/ocr（参考移行=excel_import）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── material_prices（商社別単価・effective_date・改定履歴）────
create table if not exists estimate_material_prices (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references accounts(id) not null,
  material_id    uuid references estimate_materials(id) on delete cascade not null,
  supplier_id    uuid references subcontractors(id) not null,  -- 商社＝下請け業者マスタ(区分=商社)
  unit_price     integer not null,                 -- 単価（円）
  effective_date date,                             -- 適用日
  is_current     boolean not null default true,    -- 現行価格か（改定履歴は false で残す）
  created_at     timestamptz not null default now()
);

-- ── price_revisions（OCR取込差分・pending/approved/applied）──
create table if not exists estimate_price_revisions (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references accounts(id) not null,
  supplier_id    uuid references subcontractors(id),  -- 商社＝下請け業者マスタ(区分=商社)
  material_id    uuid references estimate_materials(id),  -- 既存材料への改定（新規材料なら null＝承認時に作成）
  code           text,                              -- OCRが読んだ品番（material未マッチ時の手掛かり）
  name           text,                              -- OCRが読んだ材料名
  old_price      integer,                           -- 取込前の現行単価（差分表示用）
  new_price      integer,                           -- OCRが読んだ新単価
  effective_date date,
  status         text not null default 'pending',   -- pending/approved/applied/rejected
  source_file    text,                              -- 取込元ファイル（storageパス等）
  created_at     timestamptz not null default now(),
  applied_at     timestamptz,
  constraint estimate_price_revisions_status_chk
    check (status in ('pending','approved','applied','rejected'))
);

-- ── estimate_items（場所＞工種＞明細）────────────────────────
create table if not exists estimate_items (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  project_id  uuid references estimate_projects(id) on delete cascade not null,
  category_id uuid references estimate_categories(id),  -- 場所/部位
  trade_id    uuid references estimate_trades(id),       -- 工種
  material_id uuid references estimate_materials(id),    -- 材料（任意：自由明細も可）
  supplier_id uuid references subcontractors(id),    -- 選択商社（E7・下請け業者 区分=商社）
  item_name   text not null,                             -- 明細名（材料名 or 自由入力）
  spec        text,
  unit        text,
  quantity    numeric(14,2) not null default 0,
  unit_price  integer not null default 0,
  -- 金額＝数量×単価（自動計算・E6/E7で単価が変われば追従）
  amount      bigint generated always as ((round(coalesce(quantity,0) * coalesce(unit_price,0)))::bigint) stored,
  status      text not null default 'normal',            -- normal=通常/canceled=中止/separate=別途/reduction=減/rough=概算
  sort_order  int not null default 0,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint estimate_items_status_chk
    check (status in ('normal','canceled','separate','reduction','rough'))
);

-- ── インデックス（account_id ＋ 主要参照 ＋ 予測変換キー）──────
create index if not exists est_projects_account_idx     on estimate_projects (account_id);
create index if not exists est_categories_account_idx   on estimate_categories (account_id);
create index if not exists est_trades_account_idx       on estimate_trades (account_id);
create index if not exists est_materials_account_idx    on estimate_materials (account_id);
create index if not exists est_materials_code_idx        on estimate_materials (account_id, code);   -- E6 品番予測変換
create index if not exists est_mat_prices_account_idx   on estimate_material_prices (account_id);
create index if not exists est_mat_prices_lookup_idx     on estimate_material_prices (material_id, supplier_id);
create index if not exists est_price_rev_account_idx    on estimate_price_revisions (account_id);
create index if not exists est_price_rev_status_idx      on estimate_price_revisions (account_id, status);
create index if not exists est_items_account_idx        on estimate_items (account_id);
create index if not exists est_items_project_idx         on estimate_items (project_id);
create index if not exists est_items_trade_idx           on estimate_items (trade_id);

-- ── RLS（admin専用＝authenticated のみ・account分離・anon全拒否）──
--   purchase_orders と同一方式。anon にはポリシーを与えない＝到達不可（LEAKなし）。
do $$
declare t text;
begin
  foreach t in array array[
    'estimate_projects','estimate_categories','estimate_trades',
    'estimate_materials','estimate_material_prices','estimate_price_revisions','estimate_items'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_sel', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format($f$create policy %I on %I for select to authenticated
      using (account_id = (select public.current_account_id()))$f$, t||'_sel', t);
    execute format($f$create policy %I on %I for insert to authenticated
      with check (account_id = (select public.current_account_id()))$f$, t||'_ins', t);
    execute format($f$create policy %I on %I for update to authenticated
      using (account_id = (select public.current_account_id()))
      with check (account_id = (select public.current_account_id()))$f$, t||'_upd', t);
    execute format($f$create policy %I on %I for delete to authenticated
      using (account_id = (select public.current_account_id()))$f$, t||'_del', t);
  end loop;
end $$;
