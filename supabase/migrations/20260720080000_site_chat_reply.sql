-- LINE風リプライ(返信)機能。引用は元メッセージ削除後も表示したいため、
-- reply_to_message_id(参照用) に加え送信時点のsender_name/body抜粋をスナップショットで持つ。
alter table public.site_chat_messages
  add column reply_to_message_id uuid references public.site_chat_messages(id) on delete set null,
  add column reply_to_sender_name text,
  add column reply_to_body text;
