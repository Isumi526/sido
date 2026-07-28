-- ============================================================
--  supabase/migrations/20260728050000
--  見積R7: 相見積の依頼を「図面ページ＋業者選択」だけで成立させる
--
--  背景（2026-07-28 ユーザー通しレビュー・音声）:
--   Q3で作った「依頼行を1件ずつ作って工種・依頼日・回収期限を入れる」UIは
--   実業務に対して過剰だった。実務では業者への見積依頼は
--   **図面の該当ページを投げるだけ**で、依頼の粒度は
--   『どのページを共有するか』『どの業者に送るか』で足りる。
--
--   → 図面送信（R8）をすると、その業者への見積依頼が自動で立つようにする。
--     どの送信から生まれた依頼かを辿れるよう drawing_send_id で紐づける。
--     （「この業者にはP.13-19を渡して見積を待っている」が1行で分かる状態にする）
--
--  Notion: R7 3ab0ff81c56b81819375c3ce78f4ed68
--  追加のみDDL（後方互換・既存データに影響なし）
-- ============================================================

alter table estimate_quote_requests
  add column if not exists drawing_send_id uuid references estimate_drawing_sends(id) on delete set null;

create index if not exists est_qr_dsend_idx on estimate_quote_requests(drawing_send_id);
