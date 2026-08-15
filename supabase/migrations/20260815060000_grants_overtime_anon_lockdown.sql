-- ============================================================
--  20260815060000_grants_overtime_anon_lockdown.sql
--  日報の編集許可申請・残業申請を公開キー(anon)から締め出す
--  Notion: c) Phase2: liff露出表のRLS化（身元設計B後）／期限クリティカル分
--
--  ★2026-08-15 の実測（本番）:
--   公開キーだけで report_edit_grants 129件・overtime_requests 3件が
--   全テナント分読め、任意の worker_id で申請を作れた。
--   「誰がいつ何を申請し、承認/却下されたか」が外から見え、他人名義の申請も作れる。
--   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
--
--  ★report_edit_grants: LIFF 側のコードは全部消した
--   「解錠の許可申請」は 2026-08-03 に廃止され、過去日もそのまま編集できる
--   （理由必須＋内容の承認待ち）二段構えに置き換わっていた。にもかかわらず
--   composable と画面側に読み書きのコードが残り、テンプレートから一度も
--   参照されない死にコードになっていた。権限だけ剥がすと「動かないコードが残る」ので、
--   コードごと削除したうえでここを閉じる。
--
--  ★overtime_requests: Edge Function attendance-log 経由に移した
--   申請の worker_id はクライアントから受け取らず、検証済みの身元から決める。
--
--  ★★適用の順序（先に当てると本番が壊れる）★★
--   本番の LIFF は現行ビルドが anon で直読みしている。必ず
--     1. main にマージ → Vercel が LIFF を本番デプロイ
--     2. CI が attendance-log を含む Edge Function をデプロイ
--     3. このマイグレーションを適用
--   の順にすること。
--
--  ★site_subcontractors は今回含めない（意図的）
--   親の sites / subcontractors 自体が anon 全開なので、紐付けだけ閉じても
--   実質の秘匿にならない。マスタ一式（sites/contractors/subcontractors/vehicles）を
--   EF 経由にする回でまとめて閉じる。
--
--  権限の縮小のみ。データ・スキーマへの変更なし。
-- ============================================================

-- ── 日報の編集許可申請 ──────────────────────────────
--  ★列単位の付与は REVOKE ALL ON <table> では消えない。先に全列を剥がす
--   （2026-08-15 に attendance_logs で踏んだ。テーブル単位だけ revoke して
--    「塞いだつもり」で本番が開いたままだった）。
do $$
declare c record;
begin
  for c in
    select a.attname from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'report_edit_grants'
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke all (%I) on public.report_edit_grants from anon', c.attname);
  end loop;
end $$;
revoke all on public.report_edit_grants from anon;

comment on table report_edit_grants is
  '日報の編集許可申請（2026-08-03 に運用終了・履歴として保持）。'
  ' anon は権限なし。管理画面(authenticated)からの参照のみ。';

-- ── 残業申請（早朝入り・休憩の申告も含む）──────────────
do $$
declare c record;
begin
  for c in
    select a.attname from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'overtime_requests'
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke all (%I) on public.overtime_requests from anon', c.attname);
  end loop;
end $$;
revoke all on public.overtime_requests from anon;

comment on table overtime_requests is
  '残業申請/承認（worker×date・早朝入り/休憩の申告を含む）。'
  ' 読み書きは Edge Function attendance-log 経由（anon は権限なし）。admin は authenticated。';

-- ── ロールバック手順 ────────────────────────────────
--   grant select, insert, update, delete on public.report_edit_grants to anon;
--   grant select, insert, update, delete on public.overtime_requests to anon;
--   （公開キーで全テナントの申請が読め、他人名義で作れる状態に戻る。戻さないこと。）
