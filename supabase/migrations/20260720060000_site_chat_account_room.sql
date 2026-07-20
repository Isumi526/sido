-- ============================================================
--  20260720060000_site_chat_account_room.sql
--  アカウント全体のチャットルーム対応: site_chat_messages.site_id を nullable にする
--  (NULL = 現場に紐づかないアカウント全体ルーム)。既存の現場ごとのチャット(site_id有り)
--  には一切影響しない(追加のみDDL・非破壊)。
--  クライアント側は site_id=NULL の行を「.is('site_id', null)」で明示的に絞り込む
--  (.eq('site_id', null) は Postgrest上 no-op になり全件フィルタ漏れの事故を招くため厳禁)。
--
--  site_chat_last_read.site_id も nullable化はするが、既存unique index
--  (site_chat_last_read_actor_site_uniq: account_id,site_id,actor_key の**非partial**)は
--  一切変更しない。理由: apps/liff/composables/useSiteChatListBadge.ts と
--  apps/admin/src/lib/chatBadge.ts が upsert(..., {onConflict:'account_id,site_id,actor_key'})
--  で this index を ON CONFLICT ターゲットにしている。partial indexへ変更すると
--  PostgRESTのon_conflictがマッチしなくなり既読更新が400で全滅する(実機E2Eで確認した実回帰)。
--  v1では account全体ルームの既読/未読バッジは対象外(スコープ外)のため、
--  site_id=NULLの行がこのテーブルに書かれることはなく、既存indexのままで問題ない。
--  (将来 account room の既読管理を追加する時は、この時に初めてindex方式を検討する)
-- ============================================================

alter table public.site_chat_messages alter column site_id drop not null;

alter table public.site_chat_last_read alter column site_id drop not null;
