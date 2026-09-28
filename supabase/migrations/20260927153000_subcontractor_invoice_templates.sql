-- ============================================================
--  20260927153000_subcontractor_invoice_templates.sql
--  協力会社請求の「毎月定額」: ひな形と、ひな形から自動登録した請求の印（2026-09-27）。追加のみ。
--
--  出所（尾崎さん・SEED 2026-09-25/27）: 「毎月定額で請求となっているものを固定で登録することは可能か」
--   →「基本的にはボタンを押さずに毎月自動で登録される仕様希望。金額や内容に変更がある場合のみ、
--     登録後にその場で修正できると嬉しい」
--
--  ★「その月を作ったか」は last_generated_period（ひな形側）で持つ。
--   請求が来なかった月に自動登録の請求を削除しても、翌日に同じ月が作り直されないようにするため。
--   (recurring_template_id, recurring_period) の部分一意は、同時実行で二重に作らないための保険。
--  ★請求は通常の請求と同じ表に入る（source='recurring'）＝集計・一覧・支払いは従来の規則のまま
--   （docs/subcontractor-invoice-consumers.md）。
--  ★RLS は subcontractor_invoices と同じ（authenticated・自社の行だけ）。anon には付与しない（ラチェット）。
-- ============================================================
create table if not exists public.subcontractor_invoice_templates (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  vendor_kind           text not null default 'subcontractor' check (vendor_kind in ('subcontractor', 'other')),
  subcontractor_id      uuid null references public.subcontractors(id) on delete set null,
  vendor_name           text not null,
  registration_number   text null,
  title                 text null,
  total_amount          numeric null,
  note                  text null,
  tax_mode              text not null default 'exclusive',
  tax_override          numeric null,
  -- 明細: [{site_id, site_name, description, quantity, unit, unit_price, amount, tax_rate, note}]
  items                 jsonb not null default '[]'::jsonb,
  day_of_month          int  not null check (day_of_month between 1 and 31),
  -- 支払期限＝登録日の何日後か（元の請求の 請求日→支払期限 の差を引き継ぐ。null＝期限を入れない）
  due_offset_days       int  null check (due_offset_days between 0 and 120),
  start_period          text not null check (start_period ~ '^[0-9]{4}-[0-9]{2}$'),
  end_period            text null check (end_period is null or end_period ~ '^[0-9]{4}-[0-9]{2}$'),
  last_generated_period text null check (last_generated_period is null or last_generated_period ~ '^[0-9]{4}-[0-9]{2}$'),
  active                boolean not null default true,
  source_invoice_id     uuid null references public.subcontractor_invoices(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists subcontractor_invoice_templates_account_idx
  on public.subcontractor_invoice_templates (account_id);
-- ★1つの請求から作れるひな形は1つまで。登録の再送・連打で同じひな形が二重にでき、
--  毎月同じ請求が2件自動で作られる（二重計上）のを防ぐ（2026-09-27 独立レビュー指摘）
create unique index if not exists subcontractor_invoice_templates_source_uidx
  on public.subcontractor_invoice_templates (source_invoice_id)
  where source_invoice_id is not null;

alter table public.subcontractor_invoices
  add column if not exists recurring_template_id uuid null references public.subcontractor_invoice_templates(id) on delete set null,
  add column if not exists recurring_period text null;
create unique index if not exists subcontractor_invoices_recurring_uidx
  on public.subcontractor_invoices (recurring_template_id, recurring_period)
  where recurring_template_id is not null;

alter table public.subcontractor_invoice_templates enable row level security;
revoke all on table public.subcontractor_invoice_templates from anon;
do $$
begin
  execute 'drop policy if exists subcontractor_invoice_templates_sel on public.subcontractor_invoice_templates';
  execute 'drop policy if exists subcontractor_invoice_templates_ins on public.subcontractor_invoice_templates';
  execute 'drop policy if exists subcontractor_invoice_templates_upd on public.subcontractor_invoice_templates';
  execute 'drop policy if exists subcontractor_invoice_templates_del on public.subcontractor_invoice_templates';
end $$;
create policy subcontractor_invoice_templates_sel on public.subcontractor_invoice_templates
  for select to authenticated using (account_id = (select public.current_account_id()));
create policy subcontractor_invoice_templates_ins on public.subcontractor_invoice_templates
  for insert to authenticated with check (account_id = (select public.current_account_id()));
create policy subcontractor_invoice_templates_upd on public.subcontractor_invoice_templates
  for update to authenticated using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
create policy subcontractor_invoice_templates_del on public.subcontractor_invoice_templates
  for delete to authenticated using (account_id = (select public.current_account_id()));

comment on table public.subcontractor_invoice_templates is
  '協力会社請求の毎月定額のひな形。recurring-invoices EF が毎月の登録日に今月分の請求を1件作る（source=recurring）';
comment on column public.subcontractor_invoice_templates.last_generated_period is
  '最後に自動登録した月(YYYY-MM)。請求を削除しても戻さない＝その月は作り直さない';
