-- 残業申請の決裁コメント（2026-09-17 大塚さん）
--   「残業申請の理由がわからなくて却下したんだけど、管理側がなんで残業したとか
--    聞けるのもつくってほしい」
--   却下時に管理者が一言添えられるようにする。作業員は残業画面と決裁通知でこれを見て、
--   理由を書いて再申請できる（却下→再申請は従来どおり可能。差し戻しの新ステータスは作らない）。
--   追加のみ・既存行は null（＝コメント無し）のまま。
alter table public.overtime_requests
  add column if not exists decision_note text;

comment on column public.overtime_requests.decision_note is
  '承認/却下した管理者のコメント（任意）。主に却下時の「理由を教えて」。EF attendance-log overtime-decide が書く。';
