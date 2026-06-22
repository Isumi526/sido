-- ============================================================
--  【見積】商社別 品番/品名の名寄せ（エイリアス学習）＋ 見積書PDF送信履歴
--
--  ① estimate_material_aliases
--     商社ごとに単価表の「品番/品名」が揺れても、一度承認時に自社材料へ紐付ければ
--     次回OCR取込から自動一致させるための対応表（学習結果）。
--     例: 商社B「PB t12.5 / PBN1212」＝ 自社材料「石膏ボード12.5」
--
--  ② estimate_sends
--     見積書PDFを商社（下請け業者 区分=商社）の担当者アドレスへ送った履歴。
--     送信実体は send-estimate EF（service_role）が insert。adminは自account分を閲覧。
--
--  RLS は estimate_* と同一方式（authenticated のみ・current_account_id() で分離・anon全拒否）。
-- ============================================================

-- ① 商社別エイリアス（名寄せ学習）
create table if not exists estimate_material_aliases (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  material_id   uuid not null references estimate_materials(id) on delete cascade,
  supplier_id   uuid not null,
  supplier_code text,                 -- 商社の単価表上の品番（OCR読取値）
  supplier_name text,                 -- 商社の単価表上の品名（OCR読取値）
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists est_alias_account_idx on estimate_material_aliases (account_id);
create index if not exists est_alias_lookup_idx   on estimate_material_aliases (account_id, supplier_id);
create index if not exists est_alias_material_idx  on estimate_material_aliases (material_id);

-- ② 見積書PDF送信履歴
create table if not exists estimate_sends (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null,
  project_id               uuid not null references estimate_projects(id) on delete cascade,
  subcontractor_id         uuid,
  subcontractor_contact_id uuid,
  email_to                 text,      -- 実送信先（マスク前のフル。自account閲覧のみ）
  subject                  text,
  pdf_path                 text,      -- expense-receipts/estimates/<account>/<project>-<ts>.pdf
  total_amount             integer,
  sent_at                  timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists est_sends_account_idx on estimate_sends (account_id);
create index if not exists est_sends_project_idx  on estimate_sends (project_id);

-- ── RLS（estimate_* と同一: authenticated のみ・account分離・anon全拒否）──
do $$
declare t text;
begin
  foreach t in array array['estimate_material_aliases','estimate_sends']
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
