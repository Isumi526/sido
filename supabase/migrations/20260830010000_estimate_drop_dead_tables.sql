-- ============================================================
--  20260830010000_estimate_drop_dead_tables.sql
--  見積: 参照ゼロで死んでいるテーブルを撤去する（2026-08-30）
--
--  ★背景: 見積の方針が「SaaS内で作り込む」→「Excelを主経路にする補助」へ変わった
--   （2026-08-19 大塚さん「見積もりは外でやって、エクセルでやって」／2026-08-20 確定）。
--   転換前に作った機能のうち、アプリから一度も参照されていないものが残っていた。
--   本番は機能フラグOFFで一度も公開されておらず（lib/features.ts）、
--   実データも動作確認の残骸ばかり（案件12件中 明細ありは3件・8/19以降更新なし）＝
--   捨てるコストが最も低いうちに整理する。
--
--  ★★★ このマイグレーションは破壊的（DROP TABLE）です ★★★
--   CLAUDE.md の基準により、本番への適用は
--     (1) 人の明示承認  (2) 事前バックアップ取得
--   の両方が揃ってから行うこと。CC は本番に適用しない。
--   ローカル／検証環境での適用は問題ありません。
--
--  ★cascade を使う理由:
--   estimate_items.material_id / estimate_material_prices.material_id /
--   estimate_price_revisions.material_id / estimate_items.category_id は
--   これらのテーブルへの外部キーを持つ。cascade で「制約だけ」落とし、
--   列と既存データはそのまま残す（過去の見積の中身を壊さない）。
-- ============================================================

-- ── 1) 壁面積計算機（画面が存在しない）──
--  DDL だけ本番にアドホック適用され、migration ファイルは git 未追跡のままだった。
--  UI もテストも無い（テストは .wip 拡張子で実行対象外）。プリセット90行は投入スクリプト由来。
drop table if exists estimate_wall_calcs cascade;
drop table if exists estimate_calc_presets cascade;

-- ── 2) 見積カテゴリ（アプリからの参照ゼロ・本番0行）──
--  場所は estimate_items.location（自由文字列）で運用されており、category_id は
--  SELECT に列名が出るだけで書き込みもJOINもUIも無かった。列自体は残す（cascade）。
drop table if exists estimate_categories cascade;

-- ── 3) 材料マスタとエイリアス（R28で廃止済み・新規登録の経路なし）──
--  ・estimate_materials: 画面は「廃止・閲覧のみ」。本番でも 2026-06-27 から1行も増えていない。
--  ・estimate_material_aliases: 書き込み経路が塞がっており（material_id が付かない）、
--    空に近いテーブルを OCR が引き続けていた。実測で照合は既に当たっていない
--    （差分490件のうち450件が material_id なし＝「据置はスキップ」が効いていなかった）。
--  → OCR 側は単価表(estimate_material_prices)の品番/品名で突き合わせる方式に変更済み。
drop table if exists estimate_material_aliases cascade;
drop table if exists estimate_materials cascade;

-- ── ロールバック手順 ────────────────────────────────
--  ★DROP したデータは戻らない。バックアップからのリストアが必要。
--   スキーマだけ戻す場合は以下の定義元を再適用する:
--     estimate_materials / estimate_material_aliases / estimate_categories
--       … supabase/migrations/20260622000000_estimate_schema.sql
--     estimate_wall_calcs / estimate_calc_presets
--       … 20260728030000_estimate_wall_calc.sql（git未追跡だったため本コミットで削除済み。
--          必要なら本コミットの diff から復元する）
