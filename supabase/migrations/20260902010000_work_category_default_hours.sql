-- ============================================================
--  20260902010000_work_category_default_hours.sql
--  作業区分ごとの「全現場共通の定時」を持てるようにする
--
--  ★なぜ必要か（2026-09-02 今井さん / LINE）:
--   工場勤務は現場作業と別の勤務帯（8:00〜17:30）で動いているのに、
--   日報が現場の定時（現場作業の時間帯）で計算されてしまう。
--   定時の置き場所は site_category_hours（現場×区分）しか無いので、
--   「工場作業」が発生する現場を1件ずつ登録して回るしかなかった。
--   工場作業は複数の現場で発生するので、それは運用として成立しない。
--     >「時間帯を各現場でなく一括で設定したい。
--       各現場で設定のチェックと一括設定も可能で。見積もりなども一括で設定したい。」
--
--  ★解決順序（この migration 後）:
--   1. site_category_hours（現場×区分）… 現場ごとの上書き。最優先
--   2. work_categories.default_*（区分の共通定時）… ←ここで追加するもの
--   3. sites.default_*（現場の定時）
--   4. 無し
--
--   共通定時を現場の定時より優先させるのは、まさに「工場作業が夜勤現場の
--   時間帯に引っ張られない」ようにするため。逆順にすると要望を満たせない。
--   その代わり「現場作業」区分に共通定時を入れると全現場の定時を上書きして
--   しまうので、管理画面側で注意書きを出す（既定は null＝従来どおり）。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
--   共通定時が null の区分は、これまでどおり現場の定時へ落ちる。
-- ============================================================

alter table public.work_categories
  add column if not exists default_start_time    time,
  add column if not exists default_end_time      time,
  add column if not exists default_break_minutes integer,
  add column if not exists default_breaks        jsonb;

comment on column public.work_categories.default_start_time is
  '区分の共通始業時刻（全現場に効く）。null=設定なし（現場の定時へ落ちる）。'
  ' 現場ごとに変えたい場合は site_category_hours で上書きする（そちらが優先）。';
comment on column public.work_categories.default_end_time is
  '区分の共通終業時刻（全現場に効く）。null=設定なし。';
comment on column public.work_categories.default_break_minutes is
  '区分の共通休憩（分）。時間帯指定の休憩は default_breaks を使う。';
comment on column public.work_categories.default_breaks is
  '区分の共通休憩の時間帯 [{start,minutes}]。sites.default_breaks と同じ形。';
