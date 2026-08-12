-- ============================================================
--  supabase/migrations/20260729000000
--  見積R13: 明細に W / D / H（寸法3列）を追加する
--
--  背景（2026-07-29 ユーザー通しレビュー・第2回）:
--   顧客のExcelの明細は
--     名称 → 品番 → 形状詳細 → W → D → H → 数量 → 単位 → 単価 → 金額
--   の並び。現状の画面には寸法の3列が無く、Excelと突き合わせられない。
--
--  ★数量の自動計算はしない（2026-07-29 ユーザー回答:「記録するだけ」）。
--   工種によって面積/長さ/体積/個数と数え方が違い、自動で1つに決めると必ず外れる。
--   例: ガラススリット受金物 L2000上下 → W=2000 D=40 H=30 / 数量=4個
--   （W×D×H から数量4は導けない）。人が入れた数量を正とする。
--
--  単位は mm 想定だが、現場で cm/m 混在の記入があり得るため型では縛らない
--  （numeric・単位は形状詳細や単位列で人が判断する）。
--
--  Notion: R13
--  追加のみDDL（後方互換・既存データに影響なし）
-- ============================================================

alter table estimate_items add column if not exists dim_w numeric;
alter table estimate_items add column if not exists dim_d numeric;
alter table estimate_items add column if not exists dim_h numeric;
