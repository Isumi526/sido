-- ============================================================
--  20260815100000_overtime_requests_rls.sql
--  残業申請にRLSを入れ、authenticated の書き込みを止める
--  Notion: 【P0・権限】残業申請がRLS無効でauthenticated全開―他テナントの申請を承認できる
--
--  ★2026-08-15 に実証した穴:
--   overtime_requests は RLS 無効かつ authenticated に INSERT/UPDATE/DELETE 全開で、
--   管理画面が EF を通さず直接テーブルを UPDATE して承認していた。
--   RLS が無いので account_id の絞り込みが一切かからない。
--     - 本番（読み取りのみ）: demo テナントのアカウントで絞り込み無しに SELECT すると
--       sido（実運用テナント）の3件が全部見えた
--     - ローカル（本番と同一のRLS/権限状態）: test テナントのJWTで別テナントの申請を
--       PATCH すると HTTP 204、status=approved / approved_by='越境した第三者' に書き換わった
--   ＝自己承認どころか越境承認ができ、承認者名も任意の文字列を入れられた。
--
--  ★承認の正規経路は Edge Function attendance-log の overtime-decide に一本化した（同日）。
--   EF 側で「JWT経路のみ」「承認できるロールか」「自己承認でないか」「account_id 一致」を検査し、
--   承認者名も検証済みの身元から引き直す（クライアントの申告を信じない）。
--
--  ★anon は 20260815060000 で既に全権限を剥がしてある。本 migration は authenticated 側。
--
--  ★★適用の順序（先に当てると本番が壊れる）★★
--   本番の管理画面は現行ビルドが authenticated で直接 UPDATE している。必ず
--     1. main にマージ → Vercel が admin を本番デプロイ
--     2. CI が attendance-log を含む Edge Function をデプロイ
--     3. このマイグレーションを適用
--   の順にすること。
--
--  ★SELECT は authenticated に残す（管理画面の一覧表示・現場責任者への通知で読む）。
--   ただし RLS のポリシーで自テナントに絞るので、他社の申請は読めなくなる。
-- ============================================================

alter table public.overtime_requests enable row level security;

-- 自テナントのみ読める。current_account_id() は JWT の app_metadata.account_slug から
-- アカウントを引く既存のヘルパ（daily_report_pending_edits / purchase_orders と同じ形）。
drop policy if exists overtime_requests_sel on public.overtime_requests;
create policy overtime_requests_sel on public.overtime_requests
  for select to authenticated
  using (account_id = (select current_account_id()));

-- ★書き込みポリシーは作らない＝authenticated からの INSERT/UPDATE/DELETE は通らない。
--  申請は LIFF から EF(attendance-log の overtime-request)、承認は EF(overtime-decide) 経由。
--  どちらも service_role で書くので RLS を跨ぐ。
revoke insert, update, delete on public.overtime_requests from authenticated;

comment on table public.overtime_requests is
  '残業申請/承認（worker×date・早朝入り/休憩の申告を含む）。'
  ' 読み書きは Edge Function attendance-log 経由（申請=overtime-request / 承認=overtime-decide）。'
  ' anon は権限なし。authenticated は自テナントの SELECT のみ（RLS）。'
  ' ★管理画面から直接 UPDATE しないこと——2026-08-15 に他テナントの申請を承認できる穴になっていた。';

-- ── ロールバック手順 ────────────────────────────────
--   grant insert, update, delete on public.overtime_requests to authenticated;
--   alter table public.overtime_requests disable row level security;
--   （ログインできる他テナントの利用者が他社の申請を読め・承認できる状態に戻る。戻さないこと。）
