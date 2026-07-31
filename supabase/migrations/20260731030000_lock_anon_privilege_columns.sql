-- ============================================================
--  20260731030000_lock_anon_privilege_columns.sql
--  【P0・権限】作業員が自力でオーナーに昇格できる穴を塞ぐ。
--
--  現象: workers は RLS 無効かつ anon に INSERT/UPDATE/DELETE が付いている。
--   公開anonキー（admin/LIFF のバンドルに同梱）だけで
--     PATCH /rest/v1/workers?id=eq.<自分> {"permission_role":"admin"}
--   が通り、auth.ts の resolveRole() はその値をそのまま採用する。
--   ＝任意の作業員が自力でオーナー権限になれる。これが開いている限り
--   canManageUsers / canManageAuth / canViewHourlyWage / canViewManagementPages
--   など積み上げてきた権限制御はすべて無効。
--   site_shares も同条件で、任意現場の閲覧権を自己付与できる。
--
--  ★anon の書き込みを「全部」剥がす（2026-07-31 ユーザー確定）:
--   当初案は、LIFF の LINE 作業員（Supabase JWT を持たず anon で動く）の自己登録を
--   壊さないよう **列単位** で name/role/unit_price/active/account_id だけ許すものだった。
--   しかし **LINE 連携は運用を終了済み**（作業員は email/password ログイン＝authenticated）と
--   確認できたため、carve-out を残す理由が無くなった。中途半端に列を開けておくと
--   「なぜこの列だけ書けるのか」が後から分からなくなるので一律で閉じる。
--
--  これで閉じるもの:
--   - permission_role の書き換え（権限昇格）
--   - auth_user_id / login_id の書き換え（他人のログインへの割り込み）
--   - 単価・賃金・個人経費枠など全カラム
--   - site_shares への自己付与（任意現場の閲覧権を自分に与える）
--
--  影響しないもの（確認済み）:
--   - admin（email/password ログイン＝authenticated）の作業員マスタ・有休管理の書き込み
--   - LIFF の email/password 作業員（同じく authenticated）
--   - worker-auth-setup 等の edge function（service_role）
--   - apps/gas（GET のみ・書き込みヘルパー自体が無い）
--   ＝ authenticated / service_role の権限は一切変えていない（両ロールとも全権限を保持）。
--
--  ※ 追加のみDDLではない（権限の剥奪）。本番適用は人の承認が要る。
--   既存データは一切変更しない＝ロールバックは grant を戻すだけ（下部に記載）。
-- ============================================================

-- ── workers ────────────────────────────────────────────────
--  SELECT は残す（LIFF が作業員名の一覧等を読むため）。
revoke insert, update, delete on workers from anon;

-- ── site_shares ───────────────────────────────────────────
--  共有トグル（apps/liff/pages/sites/[id].vue）は email/password 作業員＝authenticated で
--  動くため、anon を閉じても機能は残る。
revoke insert, update, delete on site_shares from anon;

-- ── ロールバック手順（本番で問題が出た時はこれを流す）────────────────
--   grant insert, update, delete on workers     to anon;
--   grant insert, update, delete on site_shares to anon;
