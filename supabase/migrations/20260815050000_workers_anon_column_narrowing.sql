-- ============================================================
--  20260815050000_workers_anon_column_narrowing.sql
--  作業員マスタから、公開キー(anon)で読める列を「LIFFが実際に使う分」だけに絞る
--  Notion: c) Phase2: liff露出表のRLS化（身元設計B後）／期限クリティカルの workers 本体
--
--  ★2026-08-15 の実測（本番に公開キーで問い合わせて確認）:
--   公開キーだけで 5テナント・69人分の workers が **全列** 読めた。
--   含まれていたもの: unit_price / daily_wage / hourly_wage（給与）、address（住所）、
--   birth_date（生年月日）、emergency_contact / mobile_phone（連絡先）、
--   insurance_info / labor_insurance_number（保険）、invoice_number、login_id。
--   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
--
--  ★なぜ RLS ではなく列権限なのか（今回はここまで）:
--   anon には身元が無いため、RLS の行フィルタでは絞れない（attendance_logs で同じ壁に当たった）。
--   本筋は「LIFF の読み取りを EF 経由にして anon を締め出す」だが、workers は LIFF の
--   15箇所から読まれていて一度には移せない。まず被害の大きい列を落として面積を減らす。
--   attendance_logs で 2026-08-11 に取ったのと同じ順序（列を絞る → EF化 → anon遮断）。
--
--  ★残す列は「LIFFが実際に使っている列」だけ。内訳:
--   id / name / role / account_id … 作業員マスタ（日報の作業員選択・現在ユーザーの解決）
--   active / sort_order / name_kana … 絞り込みと並び替え（フィルタ列にも権限が要る）
--   permission_role / can_apply_personal_expense … 画面の出し分け
--   created_at / report_start_date … 経費申請の対象期の起点
--   birth_date … カレンダーの誕生日バッジ（同僚に見せるのが仕様）
--
--  ★列単位の付与は REVOKE ALL ON <table> では消えない。
--   先に全列を剥がしてから必要分だけ付け直す（2026-08-15 に attendance_logs で踏んだ）。
--
--  権限の縮小のみ。データ・スキーマへの変更なし。
-- ============================================================

do $$
declare c record;
begin
  for c in
    select a.attname
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'workers'
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke all (%I) on public.workers from anon', c.attname);
  end loop;
end $$;

revoke select on public.workers from anon;

grant select (
  id, name, name_kana, role, account_id, active, sort_order,
  permission_role, can_apply_personal_expense,
  created_at, report_start_date, birth_date
) on public.workers to anon;

comment on table workers is
  '作業員マスタ。★anon(公開キー)から読める列はLIFFが実際に使う分だけに絞ってある'
  '（給与・住所・連絡先・保険情報は読めない）。列を足した時、LIFFから読む必要があるなら'
  ' grant select (列) を明示的に足すこと。既定では読めない。';

-- ── ロールバック手順 ────────────────────────────────
--   grant select on public.workers to anon;
--   （全列が公開キーで読める状態に戻る＝給与・住所が露出する。戻さないこと。）
