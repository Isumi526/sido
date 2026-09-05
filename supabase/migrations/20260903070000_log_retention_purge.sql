-- ============================================================
--  20260903070000_log_retention_purge.sql
--  操作ログの保存期間を12か月に定め、超過分を自動削除する
--  （契約 別紙2「アクセスの記録を取得し、●か月間保存する」＝12か月で弁護士回答）
--
--  ★背景: operation_logs は記録するだけで削除処理が無かった＝実質無期限保存。
--   契約書に12か月と明記する以上、実装で裏付ける必要がある。
--
--  ★AC4（ログ系テーブルの棚卸し）— 12か月に含めるもの／含めないもの:
--
--   含める（純粋に運用ログで、他の法定/契約上の証跡義務が無い）:
--     - operation_logs   … 操作の監査ログそのもの（別紙2の対象）
--     - reminder_logs    … リマインド送信の実行記録（誰が読んだかではなく「実行したか」の記録）
--
--   ★含めない（2026-09-03 時点・別途の業務判断が要るため据え置き）:
--     - document_send_logs … 発注書等の送信記録。下請けとの「送った/送っていない」の
--       争いに使われうる取引記録で、税務上の会計書類に準じる保存義務（法人税法は
--       原則7〜10年）と抵触しうる。12か月で消してよいか運用判断が要る＝今回は対象外。
--     - daily_report_edit_logs … 日報（賃金計算の元）の編集監査ログ。労働基準法の
--       賃金請求権の消滅時効（現行3年・将来5年への移行あり）に鑑みると12か月は
--       短すぎる可能性が高い。今回は対象外とし、労務調査後に別途retentionを決める。
--   この2表は自動削除の対象にしない。理由をコード上にも残す（本コメント）。
--
--  ★DELETEを含む＝破壊的操作。本番適用（cron有効化）は人の明示承認が必要
--   （CLAUDE.md自走ポリシー）。このmigration自体は「削除される対象がまだ無い」
--   状態で適用される（operation_logs は2026-06-25作成＝13か月経過は2027-07以降）。
--   ★12か月ちょうどではなく13か月の余裕を持たせる（AC1）。
-- ============================================================

create extension if not exists pg_cron;

-- AC3: いつ何件消したかを追跡する
create table if not exists public.log_purges (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  deleted_count integer not null,
  run_at        timestamptz not null default now()
);

comment on table public.log_purges is
  '保存期間を超えたログの自動削除の実行記録（何のテーブルから何件消したか）。'
  ' 契約 別紙2の保存期間を実装で裏付けていることの監査証跡。';

-- 保存期間(13か月=13か月超過分を削除)を過ぎた operation_logs / reminder_logs を消し、
-- 削除件数を log_purges に残す。手動実行も同じ関数を叩けばよい（AC2）。
create or replace function public.purge_old_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '13 months';
  n integer;
begin
  delete from public.operation_logs where created_at < cutoff;
  get diagnostics n = row_count;
  insert into public.log_purges (table_name, deleted_count) values ('operation_logs', n);

  delete from public.reminder_logs where created_at < cutoff;
  get diagnostics n = row_count;
  insert into public.log_purges (table_name, deleted_count) values ('reminder_logs', n);
end;
$$;

comment on function public.purge_old_logs() is
  '13か月(12か月+1か月の余裕)を超えた operation_logs / reminder_logs を削除する。'
  ' document_send_logs / daily_report_edit_logs は対象外（本ファイル冒頭コメント参照）。'
  ' pg_cron から毎月1回呼ぶ。手動実行: select public.purge_old_logs();';

-- 毎日 3:00 JST（UTC前日18:00）に評価する。★月次ではなく日次にしているのは意図的:
--  cutoff より新しい行しか無い日は DELETE 0件で終わるだけの軽い処理なので、月次に
--  絞る利点が薄い一方、日次にしておけば「その日のcronが1回失敗しても翌日拾える」
--  （shaken-reminderのように呼び先EFが消えて気づかれない、という事故を繰り返さない）。
select cron.schedule(
  'purge-old-logs',
  '0 18 * * *',
  $$select public.purge_old_logs()$$
) where not exists (select 1 from cron.job where jobname = 'purge-old-logs');

-- ── ロールバック手順（本番で問題が出た時はこれを流す）────────────────
--   select cron.unschedule('purge-old-logs');
--   drop function if exists public.purge_old_logs();
--   drop table if exists public.log_purges;
