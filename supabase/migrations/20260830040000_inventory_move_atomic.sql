-- ============================================================
--  20260830040000_inventory_move_atomic.sql
--  在庫の入出庫を「DBの現在値に加減する」形にする（2026-08-30）
--
--  ★何が問題だったか:
--   画面が `current_qty = 画面が持っている値 + 差分` という絶対値で上書きしていた
--   （read-modify-write）。そのため
--     - 2人が同じ品目をほぼ同時に入出庫する
--     - 画面を開いたまま放置してから操作する
--   と、後から押した方が相手の分を消す（lost update）。履歴には両方残るので
--   **履歴の合計と現在庫が合わなくなる**。
--
--   ボタンの連打自体は画面側の busy フラグで塞いでいたので、問題は
--   「同一タブの連打」ではなく「複数人・複数タブでの同時操作」。
--
--  ★直し方: 履歴の追加と現在庫の加減を1つの関数（＝1トランザクション）にまとめ、
--   加減は必ずDBの現在値を起点にする。画面が持っている値は使わない。
--   行ロック(for update)で同時実行を直列化する。
--
--  ★追加のみ。既存のテーブル・データには触れない。
--   ロールバック: drop function if exists inventory_move(uuid, integer, text);
-- ============================================================

create or replace function inventory_move(
  p_item_id uuid,
  p_delta   integer,
  p_note    text default null
) returns inventory_items
language plpgsql
security invoker            -- ★呼び出したユーザーの権限で動く＝RLSがそのまま効く
set search_path = public
as $$
declare
  v_item inventory_items;
begin
  if p_delta = 0 then
    raise exception '増減が0です';
  end if;

  -- ★現在値をロックして取る。ここが肝で、画面が持っている値は一切使わない。
  --  RLS が効くので、他テナントの品目は見つからない＝触れない。
  select * into v_item from inventory_items where id = p_item_id for update;
  if not found then
    raise exception '品目が見つかりません';
  end if;

  insert into inventory_movements (account_id, item_id, delta, note)
  values (v_item.account_id, p_item_id, p_delta, nullif(btrim(coalesce(p_note, '')), ''));

  update inventory_items
     set current_qty = current_qty + p_delta,
         updated_at  = now()
   where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

comment on function inventory_move(uuid, integer, text) is
  '在庫の入出庫。履歴の追加と現在庫の加減を1トランザクションで行い、加減はDBの現在値を起点にする。'
  ' 画面が持っている値で上書きすると、同時操作で相手の分を消す（2026-08-30 修正）。';

grant execute on function inventory_move(uuid, integer, text) to authenticated;
revoke execute on function inventory_move(uuid, integer, text) from anon;
