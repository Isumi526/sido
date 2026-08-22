-- ============================================================
--  20260822010000_overtime_late_flag.sql
--  残業申請に「締切後の実績修正(late)」フラグを足す
--  Notion: 残業申請の16時締切ルールは残したまま、締切を過ぎてから実際の残業時間を
--          申告して修正できる導線を用意する #ab88f3ba
--
--  ★16:00締切ルールは通常申請にそのまま残す。締切を過ぎた後は「実際に働いた残業実績」を
--   後追いで申告し、管理者の承認を得て反映する導線(late)を別に用意する。
--   is_late=true は「締切後に出された実績修正の申請」であることを承認画面に伝えるためだけの印。
--   金額/集計には触れない(承認された時刻から workerHours が従来どおり算出)。
--
--  ★既存の一意制約 overtime_requests_active_uidx (account_id,worker_id,date) where status in
--   ('pending','approved') はそのまま。実績修正は既存の有効申請があればEFがその行を上書きし
--   status を pending に戻す(=同じ行なので一意制約に抵触しない)、無ければ late 付きで新規insert。
--
--  追加のみDDL(ADD COLUMN)。既存列・既存データに変更なし。
-- ============================================================

alter table public.overtime_requests
  add column if not exists is_late boolean not null default false;

comment on column public.overtime_requests.is_late is
  '締切(当日16:00)を過ぎてから出された実績修正の申請なら true。通常の締切前申請は false。承認フローは通常申請と同じ(管理者承認が必要)。';

-- ── ロールバック手順 ────────────────────────────────
--   alter table public.overtime_requests drop column if exists is_late;
--   (列の追加のみ。落としても通常の残業申請・承認はそのまま動く。)
