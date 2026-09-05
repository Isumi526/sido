-- ============================================================
--  20260903040000_account_trial_period.sql
--  アカウント（テナント）に「無償/有償の状態」「利用開始日」「無償満了日」を持たせる
--
--  ★スコープ（2026-08-30 ユーザー判断で「データ模型のみ」に縮小）:
--   機能ゲート本体（現場台帳のみに制限するUIガード＋サーバ側ガード）は別チケット
--   （料金・プラン体系＝単一/3段階が未確定だったため）。今回は日付の記録だけ入れる。
--   ※プラン体系はその後 2026-08-20 の弁護士向け連絡で「ベーシック5万/プレミアム10万」の
--    2プランに確定済みだが、ゲート本体の実装は別チケットのまま（本chiketでは着手しない）。
--
--  ★無償期間の長さは「45日固定」ではない（2026-09-03 訂正）。
--   2026-08-30 時点の決定は45日固定だったが、2026-09-01 の弁護士打合せで
--   「契約成立月の翌月末日まで」（最短1か月強〜最長2か月）に上書きされている
--   （弁護士向け連絡事項 1-2）。例：9/1契約→10/31まで、9/28契約でも10/31まで。
--   よって trial_ends_at は契約日から固定日数を足すのではなく、
--   「契約日の月の翌月末日」で計算する（アプリ側で計算してこの列に確定値を保存する。
--   保存後に契約日を変えない限り再計算しない＝法的な通知起点をぶらさない）。
--
--  ★既存アカウントの初期値: sido/hiromokkou は実際の契約者（本チケット導入前から
--   稼働中）なので billing_status='active' とし、遡って無償期間に落とさない。
--   demo/demo2/test は内部用（デモ・E2E）で契約の対象外のため同じく 'active' にする。
--   新規発行（先行スタートプラン等）はアカウント発行時にこの3列をセットする
--   （【908c1bbe】アカウント発行フローと連動）。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。機能ゲートは実装しない
--   （このmigration・この回のアプリ変更のどちらも、既存の利用を一切制限しない）。
-- ============================================================

alter table public.accounts
  add column if not exists billing_status    text not null default 'trial' check (billing_status in ('trial', 'active')),
  add column if not exists contract_started_at date,
  add column if not exists trial_ends_at       date;

comment on column public.accounts.billing_status is
  '無償(trial)/有償(active)の状態。★この列だけでは機能を制限しない（ゲート本体は別チケット）。'
  ' 記録のみ。';
comment on column public.accounts.contract_started_at is
  '契約成立日（利用開始日）。無償期間の起点。';
comment on column public.accounts.trial_ends_at is
  '無償満了日＝契約成立月の翌月末日（45日固定ではない・2026-09-03訂正）。'
  ' アプリ側で契約日から計算して確定値を保存する（保存後は契約日変更以外で再計算しない）。';

-- 既存アカウントは実運用中の契約者/内部用なので、遡って無償期間に落とさない
update public.accounts set billing_status = 'active' where billing_status = 'trial';
