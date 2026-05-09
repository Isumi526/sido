-- ============================================================
--  supabase/migrations/20260509600000
--  users と workers を紐づけ
--  - users.worker_id (FK → workers) を追加
--  - 既存レコードは real_name で名寄せして埋める
-- ============================================================

alter table users
  add column if not exists worker_id uuid references workers(id);

-- 既存ユーザーを workers と名寄せして worker_id を埋める
update users u
set worker_id = w.id
from workers w
where u.real_name = w.name
  and u.worker_id is null;

-- real_name / worker_role は後方互換のためそのまま残す（将来削除予定）
