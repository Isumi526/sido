-- ============================================================
--  20260830020000_daily_reports_admin_write.sql
--  管理画面から日報を直せるようにする（2026-08-30 発見のバグ修正）
--
--  ★何が起きていたか:
--   daily_reports は RLS 有効だが、ポリシーが daily_reports_sel（SELECT のみ）しか無く、
--   authenticated には UPDATE/DELETE の権限もポリシーも無かった。
--   そのため管理画面の以下3つが **本番で無言のまま効いていなかった**:
--     1. 現場マージ（sites.vue:863） … 日報の現場参照を統合先へ寄せる
--        → 効かないので現場別集計が統合されない（「ルルレモン型」バグの再発経路）
--     2. 現場未設定の紐付け（report-site-relink.vue:157）
--     3. 日報の削除（reports.vue:605）
--   1 は .then(() => {}, () => {}) でエラーを握り潰しており、画面上は成功して見えた。
--   本番の無効化済み現場は75件あり、マージ運用が行われていた可能性が高い。
--
--  ★方針: 読める範囲＝直せる範囲にそろえる。
--   既存の SELECT ポリシーと同じ「自テナントのみ」条件で UPDATE / DELETE を許可する。
--   （current_account_id() は JWT の app_metadata.account_slug 由来。他テナントには届かない）
--
--  ★追加のみ（非破壊）。ポリシーと権限を足すだけで、既存データには触れない。
--   ロールバックは末尾の手順で元に戻せる。
--
--  ★anon には一切与えない。LIFF(公開キー)からの日報書き込みは従来どおり
--   save-daily-report EF（service_role）経由のまま。
-- ============================================================

-- 自テナントの日報だけ更新できる（マージ・紐付け直し・修正）
drop policy if exists daily_reports_upd on daily_reports;
create policy daily_reports_upd on daily_reports for update to authenticated
  using (account_id = (select current_account_id()))
  with check (account_id = (select current_account_id()));

-- 自テナントの日報だけ削除できる（reports.vue の削除）
drop policy if exists daily_reports_del on daily_reports;
create policy daily_reports_del on daily_reports for delete to authenticated
  using (account_id = (select current_account_id()));

grant update, delete on daily_reports to authenticated;

comment on table daily_reports is
  '日報。RLSで自テナントのみ（SELECT/UPDATE/DELETE）。anon は権限なしで、'
  ' LIFFからの保存は save-daily-report EF(service_role)経由。'
  ' 2026-08-30: 管理画面のマージ/紐付け直し/削除が権限不足で無言failしていたため UPDATE/DELETE を追加。';

-- ── ロールバック手順 ────────────────────────────────
--   drop policy if exists daily_reports_upd on daily_reports;
--   drop policy if exists daily_reports_del on daily_reports;
--   revoke update, delete on daily_reports from authenticated;
