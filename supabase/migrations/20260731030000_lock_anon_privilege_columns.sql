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
--  ★workers は「列単位」で閉じる（2026-08-01 本番データで裏取りして確定）:
--   一時は「LINE連携は終了済み」という前提で anon の書き込みを全部剥がす案にしたが、
--   **本番を読むと LINE はまだ現役だった**（直近30日に日報を出した39人中25人が LINE 紐付。
--   うち2人は email/pw ログインを持たずLINEでしか入れない。稼働中の作業員では9人）。
--   決定的なのは useLiff.init() の作りで、**LINEアプリ内で開くと authMode='line'＝anon**
--   になる点。email/pw を持っている人でもLINEから開けば anon で動く。
--   一律 revoke すると useExpense.registerUser の workers upsert（作業員の自己登録）が
--   壊れて新規オンボーディングが止まるため、**自己登録に要る列だけ**を許す。
--   テーブル単位の権限を落としてから列単位で grant し直すので、
--   **今後カラムが増えても anon からは書けない（fail-closed）**。
--
--  これで閉じるもの:
--   - permission_role の書き換え（権限昇格）
--   - auth_user_id / login_id の書き換え（他人のログインへの割り込み）
--   - 賃金（daily_wage/hourly_wage）・個人経費枠など、以後追加される全カラム
--   - workers の削除
--   - site_shares への自己付与（任意現場の閲覧権を自分に与える）
--
--  影響しないもの（確認済み）:
--   - LIFF の LINE 作業員の自己登録（name/role/unit_price/active/account_id は許可）
--   - admin（email/password ログイン＝authenticated）の作業員マスタ・有休管理の書き込み
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

-- 自己登録（LINE作業員が自分の作業員行を作る）に必要な列だけ許す。
-- useExpense.registerUser の upsert が入れるのは name/role/unit_price/active/account_id。
grant insert (name, role, unit_price, active, account_id) on workers to anon;

-- upsert が衝突した時の更新分。permission_role / auth_user_id / login_id / 賃金 /
-- 個人経費枠は**含めない**＝権限昇格もログイン乗っ取りも賃金改ざんもできない。
grant update (name, role, unit_price, active) on workers to anon;

-- ── site_shares ───────────────────────────────────────────
--  現場の閲覧権を自己付与できる穴。共有トグル（apps/liff/pages/sites/[id].vue）は
--  現場責任者だけに出るUIで、**本番の現場責任者は全員 email/password を持つ
--  （email/pw を持たない責任者は0人）**ことを確認済みなので、anon を閉じても実利用は壊れない。
revoke insert, update, delete on site_shares from anon;

-- ── ロールバック手順（本番で問題が出た時はこれを流す）────────────────
--   grant insert, update, delete on workers     to anon;
--   grant insert, update, delete on site_shares to anon;
