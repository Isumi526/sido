-- ============================================================
--  20260819010000_extract_jobs_kind.sql
--  抽出ジョブに「種別」を足して、数量抽出の結果も残せるようにする
--
--  ★なぜ（2026-08-18 本番の通しレビュー）:
--   数量抽出の結果は**どこにも保存されていなかった**。ブラウザのメモリだけなので、
--   明細タブへ移って戻るだけで消え、また解析からやり直しになる。
--   解析はAIを呼ぶので時間も費用もかかる。それを毎回捨てていた。
--   （材料抽出は estimate_drawing_extract_jobs / drawing_material_extractions に残る。
--     数量抽出だけが取り残されていた）
--
--  ★テーブルを増やさない。既存の estimate_drawing_extract_jobs が
--   project_id / attachment_id / rows / done_pages / status と、必要なものを全部持っている。
--   別テーブルを作ると「似た2つ」ができて、どちらを見るかを毎回考えることになる。
--
--  ★一意制約を (attachment_id) から (attachment_id, kind) へ広げる。
--   同じ図面に対して材料抽出と数量抽出が同時に存在しうるため。
--   既存行は kind='material' として扱う（それが今の唯一の用途）。
--
--  追加のみ。既存の材料抽出ジョブはそのまま動く。
-- ============================================================

alter table public.estimate_drawing_extract_jobs
  add column if not exists kind text not null default 'material';

comment on column public.estimate_drawing_extract_jobs.kind is
  '抽出の種別。material=図面の材料抽出 / quantity=凡例からの数量抽出。'
  ' 既定が material なのは、この列を足すまで材料抽出しか無かったため。';

-- ★古い一意制約を外してから広げる。順番を逆にすると、同じ図面に2種別を入れられず失敗する。
drop index if exists est_dext_job_att_uniq;
create unique index if not exists est_dext_job_att_kind_uniq
  on public.estimate_drawing_extract_jobs(attachment_id, kind);

-- ── ロールバック手順 ────────────────────────────────
--   drop index if exists est_dext_job_att_kind_uniq;
--   create unique index est_dext_job_att_uniq on estimate_drawing_extract_jobs(attachment_id);
--   alter table estimate_drawing_extract_jobs drop column if exists kind;
--   ※ 先に kind='quantity' の行を消さないと一意制約の作成で失敗する
