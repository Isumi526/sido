-- ============================================================
--  20260919100000_hiromokkou_office_kind.sql
--  拠点（sites.kind=office/factory）の導線を「自社情報 › 拠点」へ移した（2026-09-19 道具①レビュー）ので、
--  現場マスタの一覧からオフィス・工場が消える。既存テナントで「現場として作った事務所」が
--  区分 site のままだと拠点として見えず、経費の紐付け先・道具の拠点に選べない。
--  → 本番実測（2026-09-19）で区分が付いていないものを付ける。冪等・他テナント/ローカルは何もしない。
--   sido: 事務所（名古屋）/事務所（東京）=office・工場=factory は 20260913130000 で済み（本番確認済み）
--   hiromokkou: 「事務所」（日報 23 件）が site のまま → office
-- ============================================================
do $$
declare acc uuid;
begin
  select id into acc from public.accounts where slug = 'hiromokkou' limit 1;
  if acc is null then return; end if;
  update public.sites set kind = 'office' where account_id = acc and name = '事務所' and active and kind = 'site';
end $$;
