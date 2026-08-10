-- ============================================================
--  workers.auth_user_id をアカウント内で一意にする
--
--  背景（2026-08-10 本番障害）:
--   ヒロ木工で1つのログイン(ushidayuki1221@gmail.com)に workers が2行ぶら下がっていた
--   （牛田 友希 / 日下部 光郎）。EF が .maybeSingle() で workers を引いていたため、
--   複数行 → PGRST116 → data=null となり本人を特定できず、自分の日報申請なのに
--   「代理入力」と誤判定されて 403。承認画面に一度も出ないまま6回の再送信が失われた。
--
--   コード側（report-edit-log / personal-expense-submit / report-edit-review.vue）は
--   複数行を検知して明示エラーにする修正を入れたが、それは「壊れたデータに気づける」
--   だけで、壊れたデータが作られること自体は防げない。ここで入口を塞ぐ。
--
--  ★アカウント跨ぎは許す（account_id, auth_user_id の複合）。
--   同じ人が複数テナントの作業員として登録されるのは正規の運用
--   （report-edit-log の resolveReviewerName が account_id で絞っているのはこのため）。
--
--  ★部分インデックス（auth_user_id is not null）。ログイン未発行の作業員は
--   auth_user_id が NULL のまま何人でも存在する。NULL は一意制約の対象外だが、
--   意図を明示するために where 句を書いておく。
-- ============================================================

-- 既存の重複が1件でもあると作成に失敗する＝適用前に必ず解消しておくこと。
-- 本番は 2026-08-10 に日下部 光郎の auth_user_id を NULL にして解消済み（重複0を確認）。
create unique index if not exists workers_account_auth_user_unique
  on public.workers (account_id, auth_user_id)
  where auth_user_id is not null;

comment on index public.workers_account_auth_user_unique is
  '1ログイン=1作業員（アカウント内）。複数ぶら下がると身元が特定できず申請が無言で403になる（2026-08-10障害）';
