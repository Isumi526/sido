# 未送信者リマインドを指定ユーザーへ個人DM送信

- Notion: 管理者が未送信者リマインドをLINEで毎日受け取ることができる
  （id: 3760ff81-c56b-808d-98ed-e07c9356b754 / エピック: 未送信者リマインド / 優先度: 中）
- ブランチ: `feature/reminder-dm-recipients`（dev基点）

## 背景・目的
- 現状：`daily-reminder` が毎時実行され、各アカウントの未送信日報リストを **グループLINE**（`settings.notify_group_id`）に1通自動投稿している。
- 課題：グループ自動投稿をやめ、**管理画面で指定したユーザーの個人LINE**へ送信し、本人がグループへ手動転送する運用へ変更したい。
- 併せて、現状「日報を出さない管理者（例：尾崎さん）を未送信者リストから外すために worker を無効化している」ハックを廃し、**専用フラグ**で除外できるようにする。

## 決定事項（ユーザー確認済み）
1. 送信先：**指定者へ個人DMのみ**（グループ自動投稿は廃止）。
2. データモデル：**2フラグに分離**（受信フラグ／未送信チェック除外フラグを別々に持つ）。

## データモデル（migration・追加のみ・後方互換）
ファイル: `supabase/migrations/20260607100000_user_reminder_flags.sql`
```sql
alter table users add column if not exists is_reminder_recipient boolean not null default false; -- リマインドDMを受け取る
alter table users add column if not exists reminder_exempt        boolean not null default false; -- 未送信者チェックから除外（日報を出さない人）
```
- 追加のみ・既定 false ＝ 既存挙動に影響しない（誰も受信者でない＝後述の通り送信ゼロになるため、デプロイ手順で先に受信者を設定する／下記「デプロイ順序」参照）。
- RLS：users は既存方針で anon 読み書き可（`users.vue` が anon で select/delete している）。新列はテーブルのRLSを継承するため追加ポリシー不要。実装時に確認。

## Edge Functions 変更（`daily-reminder` ＋ `test-daily-reminder` を同期）
`test-daily-reminder` は本体から乖離した古い版のため、**本体（daily-reminder）に内容を揃えたうえで**両方に同じ変更を入れる。

### 1. 未送信チェックからの除外
`users` 取得に新列を含め、判定ループで除外を追加：
```ts
// select に is_reminder_recipient, reminder_exempt, line_user_id を追加
for (const user of users) {
  if (user.reminder_exempt) continue            // ★ 専用フラグで除外（worker無効化に依存しない）
  if (workerId && !activeWorkerIds.has(workerId)) continue  // 既存ハックも当面維持（後方互換）
  ...
}
```

### 2. 送信先を「指定ユーザーの個人LINE」に変更
- グループID解決（`resolvedGroupIds` / `notify_group_id 未設定` early-return）を**リマインド送信からは撤去**。
- 受信者を取得：`is_reminder_recipient = true AND line_user_id is not null` のユーザー。
- メッセージ本文（`fullText`）先頭に転送依頼の1行を追加（例：`※このメッセージをグループに転送してください`）。
- 受信者ごとに個別 push（`pushLineMessagesResult(line_user_id, ...)`）。結果は現状同様 ok/fail を集約。
- 受信者ゼロ → 送信せず `result: '受信者未設定'`（グループへのフォールバックはしない＝廃止）。
- 受信者で `line_user_id` 無しは送信不可として結果に注記（`is_reminder_recipient` だが LINE未連携）。
- dry-run：従来の `unsubmitted` に加え、**送信予定の受信者一覧**（名前／連携有無）も返し、管理画面で事前確認できるようにする。

> 注：`notify_group_id` 自体は他機能（日報通知・notify-edit 等）で使うため**削除しない**。daily-reminder からの参照のみ外す。

## 管理画面（admin）UI 変更
### `pages/users.vue`
- 一覧に2列追加：「リマインド受信」「未送信チェック除外」。各行トグル（`is_reminder_recipient` / `reminder_exempt`）を anon update で保存。
- 「リマインド受信」ONかつ `line_user_id` 未連携の行には「LINE未連携」注意表示（受け取れないため）。
- select に新列・`line_user_id` を追加。

### `pages/settings.vue`（文言のみ）
- 未送信リマインドの説明を「グループに通知」→「**指定ユーザーの個人LINEへ通知（本人がグループへ転送）**」に更新。
- ドライラン結果に受信者プレビューが出る旨を踏まえ表示（既存の result 表示で対応可）。

## AC → E2E（Playwright・admin）
- **AC1**: ユーザー管理で「リマインド受信」をON/OFFでき、`is_reminder_recipient` に反映 → E2E（トグル→rest確認）
- **AC2**: ユーザー管理で「未送信チェック除外」をON/OFFでき、`reminder_exempt` に反映 → E2E
- **AC3**: `reminder_exempt=true` のユーザーは未送信者リストに出ない（worker無効化に非依存） → E2E（test-daily-reminder を dry-run 呼び出し、結果に当該ユーザーが出ないことを確認）
- **AC4**: 送信対象が `is_reminder_recipient=true`＋`line_user_id` 有りのユーザー（グループ宛にしない） → E2E（dry-run の受信者プレビューに当該ユーザーが入る／グループIDが対象でない）
- **AC5**: 受信者ゼロなら送信せず `受信者未設定` → E2E（dry-run）

> E2E補足：AC3〜5 は `test-daily-reminder` の **dry-run**（LINE送信なし）で検証＝外部依存なし。ローカルで `supabase functions serve` が必要なため、実装時に起動有無を確認し、難しければ AC1/AC2（UI＋DB）を必須とし AC3〜5 は dry-run 呼び出しでカバー（不可なら手動検証手順を残す）。

## デプロイ順序・後方互換性
1. **DB migration**（2列追加・追加のみ・後方互換）。
2. **受信者フラグの初期設定（データ）**：本番反映で送信ゼロ期間を作らないため、対象アカウント（シード）の受信者（大塚・尾崎・テストユーザー）に `is_reminder_recipient=true`、必要に応じ `reminder_exempt=true` を設定。尾崎さんは worker を再有効化＋`reminder_exempt=true`に移行可（任意）。※/ship 内の手動データ更新として扱う。
3. **Edge Functions deploy**（daily-reminder / test-daily-reminder）。← この時点でグループ投稿停止・DM開始。
4. **フロント(admin) deploy**（トグルUI）。
- ロールバック：function は前版へ再deploy（グループ投稿に戻る）、front は revert、列は残置で無害。

## スコープ外（残課題候補）
- 受信者の LIFF 連携（`line_user_id` 取得）導線の改善は別途。
- 既存の worker 無効化ハックの完全撤去（移行が済んだら `active` 判定skipを削除）は安定後に実施。
