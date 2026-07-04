-- 昇給履歴のべき等化: (worker_id, effective_date) に一意indexを張り、連打/再送での二重登録を防ぐ。
-- 追加のみ（CREATE UNIQUE INDEX）・非破壊。既存データに重複(worker_id,effective_date)・null effective_date が
-- 無いことを local/本番で確認済み。以降 workers.vue は upsert(onConflict)で同一発効日は更新＝重複しない。
-- 参考: users 重複バグ(check-then-insert競合)と同型の予防（一意index＋upsert）。
create unique index if not exists worker_wage_history_worker_eff_uniq
  on public.worker_wage_history (worker_id, effective_date);
