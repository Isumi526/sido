-- ============================================================
--  accounts.owner_auth_user_id
--  「意図的な純粋オーナー」(worker行を持たず全権限を持つユーザー)の auth.users.id を明示する。
--
--  背景(バグ): apps/admin/src/lib/auth.ts resolveRole() は auth_user_id に紐づく workers 行が
--  0件の時 currentRole=null にフォールバックし、null は全ての権限チェックで「オーナー」として
--  扱われる。そのため worker行が無い/リンク切れの認証ユーザーが意図せずオーナー全権限を得る
--  (フェイルオープン)。「意図的な純粋オーナー」と「事故で紐付けが切れた一般ユーザー」を区別できる
--  よう、オーナーの auth_user_id をここに明示する(回答B・2026-07-14)。
--
--  resolveRole は worker行0件時、この値と一致する場合のみオーナー扱いし、非一致は最小権限(worker)へ
--  倒す(フェイルセーフ)。
--
--  ※ 追加のみDDL(非破壊)。owner_auth_user_id の実値backfillは環境ごとに異なる(auth.users.id依存)ため
--    本migrationには含めない。各環境で「そのaccountの実オーナー」を設定すること(本番はship時に人手)。
-- ============================================================
alter table accounts add column if not exists owner_auth_user_id uuid references auth.users(id);

comment on column accounts.owner_auth_user_id is
  '意図的な純粋オーナー(worker行なしで全権限を持つユーザー)の auth.users.id。resolveRole が worker行0件時にこの値と一致する場合のみオーナー扱い(それ以外の0件・取得失敗は最小権限=worker)。フェイルオープン防止。';
