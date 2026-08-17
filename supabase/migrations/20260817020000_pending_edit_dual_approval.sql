-- ============================================================
--  20260817020000_pending_edit_dual_approval.sql
--  日報編集の承認を「金額が増える時だけ二重承認」にする
--
--  ★なぜ（2026-07-27 大塚さん逐語／2026-08-15 に要件確定）:
--   「管理者で登録されたら自分で修正できちゃうじゃん／誰も見られることもなく／
--     だから、あのダブル承認がいいなと思って」
--   狙いは監視ではなく抑止。「会社の役員まで承認しなあかんのか」と思わせて
--   ルールを守らせる。ただし全部に掛けると承認が回らないので、
--   **金額が上がる編集だけ**に絞る（単純な修正は今までどおり1人で通す）。
--
--  ★決まっている運用（実装はこれに従う）:
--   - 現場責任者とオーナーの2つ揃えば成立。★順番は問わない
--     （順を固定すると「オーナーが責任者を後から設定した1件」が一次へ戻り、
--      責任者を埋めるほどオーナーの手間が増える構造になるため）
--   - 現場責任者が未設定の現場は **オーナー1人で成立**
--     （本番 sido は責任者が半分しか埋まっておらず、止めると翌日から現場が動かない）
--   - ★同一人物の承認は1つとしか数えない
--     （申請者が自分の現場の責任者、オーナーが責任者を兼ねる、は本番で普通に起きる。
--      2役を1人で満たせると自己承認禁止が骨抜きになる）
--
--  追加のみ。既存の1人承認の行はそのまま動く（requires_dual=false）。
-- ============================================================

alter table public.daily_report_pending_edits
  add column if not exists requires_dual boolean not null default false,
  add column if not exists approvals jsonb not null default '[]'::jsonb;

comment on column public.daily_report_pending_edits.requires_dual is
  '二重承認（現場責任者＋オーナー）が要るか。申請時に「経費の合計が増えるか」で決まる。'
  ' false なら従来どおり1人の承認で成立する。';

comment on column public.daily_report_pending_edits.approvals is
  '集まった承認 [{user_id, name, role, at}]。role は site_manager / owner。'
  ' ★順不同で2つ揃えば成立。同じ user_id は1つとしか数えない（2役の兼務で骨抜きにしない）。'
  ' 現場責任者が未設定なら owner 1つで成立。';

-- ── ロールバック手順 ────────────────────────────────
--   alter table public.daily_report_pending_edits
--     drop column if exists requires_dual,
--     drop column if exists approvals;
