-- ============================================================
--  20260815090000_workers_restore_selfregister_grants.sql
--  workers の「LINE作業員 自己登録」用の anon 書き込み権限を戻す（回帰の修正）
--
--  ★何が起きたか（2026-08-15・自分で壊した）:
--   同日の 20260815050000（workers の列絞り込み）で、
--     for each column: revoke all (col) on workers from anon
--   と全列を剥がしてから select だけ付け直した。
--   ところが workers の INSERT/UPDATE は 20260731030000 で
--   **列単位**に付与されていた（insert (name, role, unit_price, active, account_id) /
--   update (name, role, unit_price, active)）。列単位の revoke はこれも消す。
--   結果、LIFF の新規登録（register.vue → useExpense.registerUser の
--   workers upsert）が本番で通らなくなった。
--
--   他の表（subcontractors 等）が無事だったのは、そちらの INSERT/UPDATE が
--   **表単位**の付与で、消したのが `revoke select`（表単位のSELECTのみ）だったから。
--   同じコードに見えて結果が違う——ここが落とし穴だった。
--
--  ★なぜ EF に寄せず grant で戻すのか:
--   登録は「まだ身元が無い人」が通る唯一の経路で、resolveCaller が使う
--   worker_id 自体をこれから作る。身元検証で守る形にできないため、
--   列を絞った anon 書き込みのまま残す（20260731030000 の判断を踏襲）。
--   permission_role / auth_user_id / login_id / 賃金は含めない
--   ＝権限昇格もログイン乗っ取りも賃金改ざんもできない。
--
--  権限の付与のみ。データ・スキーマへの変更なし。
-- ============================================================

-- 20260731030000 と同じ列だけ。ここを広げないこと。
grant insert (name, role, unit_price, active, account_id) on public.workers to anon;

-- upsert が既存名に衝突した時の更新分
grant update (name, role, unit_price, active) on public.workers to anon;
