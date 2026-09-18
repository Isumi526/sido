-- 協力業者マスタの区分に「その他」を追加（2026-09-18 尾崎さん要望）
--   商社／業者に当てはまらない先（リース・運送・清掃 等）を登録できるようにする。
--   ★追加のみ（check 制約の選択肢を増やすだけ・既存行は変えない）。
--   集計・発注の商社固有の処理には乗せず、「業者」と同じ扱い（原価は業者側に計上）。
alter table public.subcontractors drop constraint if exists subcontractors_category_check;
alter table public.subcontractors
  add constraint subcontractors_category_check check (category in ('商社', '業者', 'その他'));
