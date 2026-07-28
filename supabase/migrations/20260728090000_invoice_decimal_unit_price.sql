-- ============================================================
--  supabase/migrations/20260728090000
--  下請け請求: 単価・金額に小数が入ると保存できない不具合の修正
--
--  症状（2026-07-28 ユーザー報告）:
--    保存に失敗しました: invalid input syntax for type integer: "0.74"
--    保存に失敗しました: invalid input syntax for type integer: "3.45"
--
--  原因: unit_price / amount / total_amount が integer だった。
--   単価に小数が入るのは異常値ではない。実際の請求書にも
--   「3分ワッシャー @9円」「3分メッキナット @6円」のような1桁単価があり、
--   ビス・ワッシャー等の細物は @0.74円・@3.45円 といった小数単価が普通に出る。
--   さらに AI解析(analyze-invoice) は丸めを一切していないため、
--   請求書に書かれた小数がそのままDBへ流れる。
--
--  ★なぜ「クライアントで丸める」で直さないか:
--    @0.74円 × 500個 = 370円 だが、単価を1円に丸めると 500円 になる（+130円の過大計上）。
--    請求は金額そのものが成果物なので、丸めではなく型を広げるのが正しい。
--
--  integer → numeric は拡大変換で無損失。既存の整数データは値も表示も変わらない。
--  （金額の「表示」を円単位に整えるのはアプリ側の責務であり、DBが桁を潰す理由はない）
--
--  Notion: 3ab0ff81c56b81e08247fc28b4de52a0
-- ============================================================

alter table subcontractor_invoice_items alter column unit_price type numeric;
alter table subcontractor_invoice_items alter column amount     type numeric;
alter table subcontractor_invoices      alter column total_amount type numeric;
