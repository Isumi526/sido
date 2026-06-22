-- ============================================================
--  【見積→発注】見積(estimate_projects)の明細を商社ごとに分割して発注書を生成できるよう
--  purchase_orders を拡張する。
--   - 従来: purchase_orders は legacy estimates(受領見積)に 1:1（estimate_id NOT NULL）。
--   - 追加: estimate_project_id（見積ビルダーの案件）を持てるようにし、estimate_id を任意化。
--           1案件×1商社につき有効な発注は1つ（再送は同一行をUPDATE＝重複発行を防ぐ）。
--   - 発注先(商社)＝ subcontractors(区分=商社)。受注者列(subcontractor_id/contact_id)を流用。
--   - 送信は既存 send-purchase-order EF をそのまま再利用（pdf_path＋contactのemail）。
--
--  ※ estimate_id の DROP NOT NULL は「追加のみ」ではない（制約の緩和）。データは壊さないが、
--    本番適用時は人手承認の対象（ship時に明示）。
-- ============================================================

alter table purchase_orders alter column estimate_id drop not null;
alter table purchase_orders add column if not exists estimate_project_id uuid references estimate_projects(id);
create index if not exists po_estimate_project_idx on purchase_orders (estimate_project_id);

-- 1案件×1商社につき有効な発注は1つ（ソフト削除分は対象外・再送は同一行UPDATE）
create unique index if not exists po_project_supplier_active_unique
  on purchase_orders (estimate_project_id, subcontractor_id)
  where estimate_project_id is not null and is_deleted = false;
