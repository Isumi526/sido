-- ============================================================
--  20260815070000_subcontractors_anon_column_narrowing.sql
--  協力業者マスタから、公開キー(anon)で読める列を「LIFFが実際に使う分」だけに絞る
--  Notion: c) Phase2: liff露出表のRLS化（身元設計B後）
--
--  ★2026-08-15 の実測（本番に公開キーで問い合わせて確認）:
--   公開キーだけで 4テナント・182件の subcontractors が全列読めた。
--   列には bank_name / bank_branch / bank_account_type / bank_account_number /
--   bank_account_holder（振込先の銀行口座）、unit_price（単価）、address が含まれる。
--   ★口座の実データは現時点で0件だったので実害はまだ出ていない。
--    ただし「登録した瞬間に漏れる」状態であり、入る前に閉じるべきもの。
--    （0件だったから放置、では next の入力で事故る）
--
--  ★残す列は「LIFFの協力業者ページが実際に使っている列」だけ。
--   SUB_COLS（apps/liff/pages/subcontractors/index.vue）＋ 絞り込み/並び替えに要る列。
--   連絡先（representative_name / mobile_phone / office_phone / email）は
--   協力業者ページが「タップで電話・メール」を出す仕様なので残す。
--   口座・単価・住所は LIFF のどの画面も使っていない。
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
    where n.nspname = 'public' and t.relname = 'subcontractors'
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke all (%I) on public.subcontractors from anon', c.attname);
  end loop;
end $$;

revoke select on public.subcontractors from anon;

grant select (
  id, name, account_id, active, sort_order, category,
  representative_name, mobile_phone, office_phone, email, service_areas,
  is_deleted
) on public.subcontractors to anon;

comment on table subcontractors is
  '協力業者マスタ。★anon(公開キー)から読める列はLIFFが実際に使う分だけに絞ってある'
  '（振込先の銀行口座・単価・住所は読めない）。列を足した時、LIFFから読む必要があるなら'
  ' grant select (列) を明示的に足すこと。既定では読めない。';

-- ── ロールバック手順 ────────────────────────────────
--   grant select on public.subcontractors to anon;
--   （全列が公開キーで読める状態に戻る＝振込先口座が露出する。戻さないこと。）
