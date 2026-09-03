-- ============================================================
--  20260903020000_health_checkup_drop_free_text.sql
--  健診テーブルから自由記述列（result / note）を落とす
--
--  ★なぜ必要か:
--   利用契約 第9条8項・別紙2 で「健診は受診日・受診の有無のみ、結果・所見は
--   取り扱わない」と明記しているのに、worker_health_checkups に result / note の
--   自由記述列が存在し、要配慮個人情報を保存できる状態だった（契約と実態のズレ）。
--   2026-08-19 の契約詰め打合せ（論点 A-1）で是正方針を確認済み。
--
--  ★列を残して「書き込みだけ止める」案を採らない理由:
--   【396cb882】で「保管データを一覧化して契約書に明記する」と決めている。
--   列を残すと、その一覧に健診結果を載せるか隠すかの問題が生じ、
--   載せれば第9条8項と矛盾する。持たないのが正しい。
--
--  ★適用前に必ず件数を確認すること（下の確認SQL）。
--   本番では 2026-09-03 時点で 全8行・result あり 0件・note あり 0件 を実測済み。
--   0件なので実データは失われないが、DROP COLUMN 自体は破壊的DDLなので
--   CC は実行しない（人手・事前バックアップ）。
--
--  適用前の確認（中身は読まない。件数だけ見る）:
--    select count(*) as 全行,
--           count(*) filter (where result is not null and btrim(result) <> '') as 結果あり,
--           count(*) filter (where note   is not null and btrim(note)   <> '') as 備考あり
--    from public.worker_health_checkups;
--  ★「結果あり」「備考あり」が1件でもあれば、この migration は流さずに
--   契約解釈の確認（弁護士/大塚さん）に戻すこと。
-- ============================================================

alter table public.worker_health_checkups drop column if exists result;
alter table public.worker_health_checkups drop column if exists note;

comment on table public.worker_health_checkups is
  '作業員の健診履歴。★受診日のみを保持する（利用契約 第9条8項・別紙2）。'
  ' 結果・所見・持病などの要配慮個人情報はここに限らず保存しない。'
  ' 自由記述の列を足さないこと（2026-09-03 に result / note を削除した経緯がある）。';
