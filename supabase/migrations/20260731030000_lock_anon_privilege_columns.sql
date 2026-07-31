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
--
--  ★なぜ「anon の書き込みを全部剥がす」ではないのか（調査済み・2026-07-31）:
--   LIFF の LINE 作業員は Supabase JWT を持たず anon で動く。全部剥がすと
--   「作業員の自己登録」（useExpense.registerUser の workers upsert）が壊れる。
--   そこで **列単位の権限**にし、anon には自己登録に必要な列だけを許す。
--   テーブル単位の UPDATE を落としてから列単位で grant し直すので、
--   **今後カラムが増えても anon からは書けない（fail-closed）**。
--
--  これで閉じるもの:
--   - permission_role の書き換え（権限昇格）
--   - auth_user_id / login_id の書き換え（他人のログインへの割り込み）
--   - 単価・賃金・個人経費枠など、以後追加される全カラム
--
--  ※ 追加のみDDLではない（権限の剥奪を含む）。本番適用は人の承認が要る。
--   既存データは一切変更しない＝ロールバックは grant を戻すだけ。
-- ============================================================

-- ── workers ────────────────────────────────────────────────
revoke insert, update, delete on workers from anon;

-- 自己登録（LINE作業員が自分の作業員行を作る）に必要な列だけ。
-- useExpense.registerUser の upsert が入れるのは name/role/unit_price/active/account_id。
grant insert (name, role, unit_price, active, account_id) on workers to anon;

-- upsert が衝突した時の更新分。permission_role / auth_user_id / login_id は**含めない**。
grant update (name, role, unit_price, active) on workers to anon;

-- ── site_shares ───────────────────────────────────────────
--  insert/delete は LIFF の現場責任者による共有トグルが使うため今回は残す
--  （剥がすと LINE 作業員の責任者が現場を共有できなくなる。EF化は別チケット）。
--  plain UPDATE を使う経路は存在しないので落とす。
revoke update on site_shares from anon;
