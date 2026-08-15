-- ============================================================
--  20260815080000_sites_contractors_anon_lockdown.sql
--  現場・元請け・現場×下請けの紐付けを公開キー(anon)から締め出す
--  Notion: c) Phase2: liff露出表のRLS化（身元設計B後）
--
--  ★2026-08-15 の実測（本番）:
--   公開キーだけで sites / contractors / site_subcontractors が全テナント分読めた。
--   どの会社がどの現場を持ち、どの元請けと組み、どの業者を入れているかが外から分かる。
--   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
--
--  ★LIFF の読み書きは Edge Function master-data に全部移した（同日）。
--   移したのは useMaster / 現場情報ページ / 現場詳細（閲覧・編集）/ チャット一覧 /
--   現場チャット / 出退勤の現場選択 / 残業申請の現場選択 / 経費の現場解決 /
--   日報送信時の現場マスタ登録 / 未読バッジ / 自分の現場ID解決。
--   直叩きは1箇所も残っていない（grep で確認）。
--
--  ★★適用の順序（先に当てると本番が壊れる）★★
--   本番の LIFF は現行ビルドが anon で直読みしている。必ず
--     1. main にマージ → Vercel が LIFF を本番デプロイ
--     2. CI が master-data を含む Edge Function をデプロイ
--     3. このマイグレーションを適用
--   の順にすること。
--
--  ★subcontractors は 20260815070000 で列を絞ってある（振込先口座を隠すため）。
--   こちらは LIFF の協力業者ページが今も直接読んでいるので、テーブルごとは閉じない。
--   閉じるなら協力業者ページのCRUDもEF化が要る（別途）。
--
--  権限の縮小のみ。データ・スキーマへの変更なし。
-- ============================================================

-- ★列単位の付与は REVOKE ALL ON <table> では消えない。先に全列を剥がす
--  （2026-08-15 に attendance_logs で踏んだ。テーブル単位だけ revoke して
--   「塞いだつもり」で本番が開いたままだった）。
do $$
declare t text; c record;
begin
  foreach t in array array['sites', 'contractors', 'site_subcontractors'] loop
    for c in
      select a.attname from pg_attribute a
      join pg_class cl on cl.oid = a.attrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = t
        and a.attnum > 0 and not a.attisdropped
    loop
      execute format('revoke all (%I) on public.%I from anon', c.attname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

comment on table sites is
  '現場マスタ。読み書きは Edge Function master-data 経由（anon は権限なし）。'
  ' admin は authenticated で参照・更新する。';
comment on table contractors is
  '元請け業者マスタ。読み書きは Edge Function master-data 経由（anon は権限なし）。';
comment on table site_subcontractors is
  '現場↔協力業者の紐付け。読み書きは Edge Function master-data 経由（anon は権限なし）。';

-- ── ロールバック手順 ────────────────────────────────
--   grant select, insert, update, delete on public.sites to anon;
--   grant select, insert, update, delete on public.contractors to anon;
--   grant select, insert, update, delete on public.site_subcontractors to anon;
--   （公開キーで全テナントの現場・元請け・業者の紐付けが読める状態に戻る。戻さないこと。）
