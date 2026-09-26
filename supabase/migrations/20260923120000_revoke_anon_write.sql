-- ============================================================
--  20260923120000_revoke_anon_write.sql
--  RLS第2段のうち「まず被害の大きい半分を止める」分（回答A・2026-09-23）。
--  anon から INSERT/UPDATE/DELETE/TRUNCATE を剥がす。**SELECT は残す**。
--
--  ★なぜ必要か（2026-09-23 実測）:
--   公開の anon キー（admin/liff のバンドルに入っていて誰でも取得できる）で本番 REST を
--   叩くと subcontractors 219行 / users 59行が実際に読め、かつ anon は同じ表に
--   INSERT/UPDATE/DELETE/TRUNCATE を持っていた＝「誰でも読めて・書き換えられて・消せる」。
--   Supabase からも Critical (rls_disabled_in_public) の警告が来ている。
--
--  ★なぜ SELECT を残すのか:
--   読みまで閉じると liff の各画面が即死する。読みの遮断は RLS 本体（第2段B）で
--   身元設計とセットでやる。ここは「壊れる可能性がほぼ無い半分」だけを先に取る。
--
--  ★安全性の根拠（消す前に実測した）:
--   - 本番の auth.users 50人は**全員 provider=email**＝ログイン後の書き込みは authenticated で走る。
--     anon の書き込み権限を使っている通常経路は無い。
--   - Edge Function 群は SERVICE_ROLE_KEY で動く（anon 権限に依存しない）。
--   - 下請けポータル p/[token].vue は subcontractor-portal EF 経由＝anon 書き込み不要。
--   - 唯一の例外だった「現場チャットのゲスト招待リンク」(chat-invite/[token].vue) が
--     site_chat_messages へ anon 直 INSERT していたため、**先に site-chat-invite EF の
--     action:post へ移設した**（同コミット）。投稿先はトークンから導出するので、
--     ついでに「他テナントの現場へ管理者を騙って投稿できる」穴も塞がっている。
--
--  ★適用順序（重要）: 先に EF(site-chat-invite) をデプロイしてから本 migration を当てる。
--   逆にするとゲストのチャット投稿が落ちる。
--
--  ★列単位の付与も剥がす: テーブル単位の REVOKE だけでは
--   information_schema.column_privileges に残った列付与が効いてしまう（本番に647件あった）。
--   2026-08-15 に workers で「列単位の付与を消して本番の新規登録が止まった」逆向きの事故が
--   あるので、ここでは write だけを対象にし SELECT の列付与には触れない。
--
--  ロールバック: 末尾の巻き戻しDOブロックを流す（grant を元に戻す）。データ変更はゼロ。
-- ============================================================

do $$
declare
  t   record;
  n_tbl int := 0;
  n_col int := 0;
begin
  -- 対象: public の実テーブルで anon が書き込み権限を持つもの
  for t in
    select distinct c.relname as tbl
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where c.relkind = 'r'
      and (
        exists (
          select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.table_name = c.relname
            and g.grantee = 'anon' and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
        )
        or exists (
          select 1 from information_schema.column_privileges p
          where p.table_schema = 'public' and p.table_name = c.relname
            and p.grantee = 'anon' and p.privilege_type in ('INSERT','UPDATE')
        )
      )
    order by 1
  loop
    -- テーブル単位
    execute format('revoke insert, update, delete, truncate on table public.%I from anon', t.tbl);
    n_tbl := n_tbl + 1;

    -- 列単位（残っていると table revoke をすり抜ける）
    execute format('revoke insert, update on table public.%I from anon', t.tbl);
    n_col := n_col + 1;
  end loop;

  raise notice 'anon の書き込みを剥奪: % テーブル', n_tbl;
end $$;

-- 今後 作られる表にも効かせる（既定権限。anon に書き込みを配らない）
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;

-- ============================================================
--  検証（適用後にこれが 0 / 0 になること）
--    select count(*) from information_schema.role_table_grants
--     where grantee='anon' and table_schema='public'
--       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--    select count(*) from information_schema.column_privileges
--     where grantee='anon' and table_schema='public'
--       and privilege_type in ('INSERT','UPDATE');
--  SELECT が残っていること（liff が死んでいないこと）:
--    select count(*) from information_schema.role_table_grants
--     where grantee='anon' and table_schema='public' and privilege_type='SELECT';
-- ============================================================

-- ============================================================
--  ↩ ロールバック（本番で問題が出たらこれを流す）
--
--  ★「全表に insert/update/delete を配り直す」で戻してはいけない（2026-09-23 に一度そう書いて気づいた）。
--   workers は 2026-08-15 に **列単位の付与**へ絞って権限昇格を塞いだ表で、
--   insert/update は (account_id, active, name, role, unit_price) だけ＝permission_role を含まない。
--   テーブル単位で配り直すと「公開anonキーで自分を admin に昇格できる」穴がそのまま再び開く。
--
--  正しい戻し方＝本番の付与を写した宣言（supabase/seed.sql）に合わせる:
--    node scripts/anon-grant-check.mjs --repair > /tmp/grant-repair.sql   # 生成（列単位も正しく出る）
--    bash scripts/prod-psql.sh --rw -f /tmp/grant-repair.sql               # 適用
--    bash scripts/prod-psql.sh --rw -c "alter default privileges for role postgres in schema public grant select, insert, update, delete, truncate on tables to anon;"
--  ※ seed.sql は 2026-09-09 から「本番の付与そのもの」なので、これで適用前の本番に一致する。
--  ※ 生成したSQLの workers の行が列単位になっていることを流す前に目で確認すること。
-- ============================================================
