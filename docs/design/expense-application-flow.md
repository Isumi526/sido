# 設計書（batch）: 経費申請フロー 4ストーリー

正典: `docs/spec/expense.md` を参照（用語・状態・締切・DBモデルはそこに集約）。

対象ストーリー（すべて 経費管理エピック / 進行中）:
| 略号 | タスク | 優先 | id末尾 | スコープ |
|---|---|---|---|---|
| W1 | 作業員が、LIFF画面から期限内に経費を申請できる | 高 | 5786cb5c | liff + DB |
| H  | 作業員が、LIFFホームで経費申請の締切を把握できる | 中 | 37160fcf | liff |
| C  | 管理者が、申請中の経費（月次精算）を差し戻しできる | 中 | dc83bff1 | admin + DB |
| M  | 経費申請時に、設定メール宛へPDFを自動送信する | 中 | ff85185b | admin + functions + DB |

## 採用した決定事項（ユーザー承認済み）
1. **精算単位 = 半月（first/second）個別申請**。締切は期ごと:
   first=当月18日10:00 / second=翌月3日10:00（JST）。
2. メール基盤 = **Resend API**（edge function、`RESEND_API_KEY` secret）。
3. PDF = **クライアント生成 → Storage保存 → メール添付**。
4. 差し戻し = **「差し戻し」状態 + 理由必須**。

---

## 0. 共通基盤（W1/C/M の土台）

### DB マイグレーション（新規・追加のみ）
`supabase/migrations/<ts>_expense_settlements.sql` に `expense_settlements` を新設
（DDL は正典 §4）。**→ /ship で本番DB push の人間ゲートが発生する。**

### 共通ロジック
- 締切計算 `deadlineForPeriod(periodKey): Date` と
  実効ステータス `effectiveStatus(row, periodKey, now)` を、LIFF/admin 双方に実装。
  - LIFF: `apps/liff/composables/useExpense.ts`（既存 period ユーティリティの隣）に追加。
  - admin: `apps/admin/src/lib/expenses.ts` に追加。
  - （将来は packages 共通化＝既存の残課題タスクに合流）

---

## 1. W1 — LIFF から期限内に申請（高）

### 画面
既存 `apps/liff/pages/expense/download.vue`（subtitle「経費申請書」、期バー・全経費/立替切替・印刷を持つ）を申請の入口にする。期バーで選んだ period の実効ステータスに応じて操作を出し分け:

| 実効ステータス | 表示・操作 |
|---|---|
| 未申請（締切内） | **「この期を申請する」ボタン**表示 |
| 申請中 | 「申請済み」バッジ。申請ボタン非表示 |
| 差し戻し | 「差し戻し（要再申請）」＋理由表示。**「再申請する」ボタン**表示 |
| 期限超過 | 「申請期限切れ」表示。申請ボタン非表示 |
| 支払い済み | 「支払い済み」バッジ |

### 申請アクション（クライアント）
1. 既存の経費表 DOM から **jsPDF + html2canvas で PDF 生成**（admin が既に jspdf 依存を持つ。LIFF に jspdf/html2canvas を追加）。
2. `expense-receipts` バケットへ `expense-applications/{account}/{user_id}/{period_key}.pdf` で upload（既存 anon insert ポリシーで可）。
3. `expense_settlements` を upsert（onConflict=account_id,user_id,period_key）:
   `status='申請中', applied_at=now, pdf_path=..., notified_at=null`。
4. メール送信 function を呼ぶ（M）。失敗してもDB申請自体は成立（メールは後追い再送可）。

### AC 対応
- 期限内かつ未申請→申請ボタン表示 ✔（ステータス出し分け）
- 申請で未申請→申請中、表示「申請済み」 ✔
- 期限外かつ未申請→ボタン非表示「申請期限切れ」 ✔
- 現在ステータスが分かる表示 ✔

---

## 2. H — LIFF ホームで締切把握（中）

### 画面
`apps/liff/pages/index.vue` の home-body 上部に **締切バナー**を追加。

- 表示条件: 「今が**締切アラート期間内**（first=15日〜18日10:00 / second=翌月1日〜3日10:00）
  かつ その期が未申請/差し戻し」のとき表示。`isInDeadlineAlertWindow()` で判定。
  - 複数該当する場合は締切が最も近い期を表示。期間外は出さない。
- 文言例: 「◯月後半分の経費申請は **◯月3日(火) 10:00** までです」。締切日時を明示。
- 締切超過後は非表示、または「申請期限切れ」に切替。

> 状態取得のため home でも `expense_settlements` を読む（user の当該 period 行有無）。

### AC 対応
- 期間内に締切案内が目立つ位置に表示 ✔
- 締切日時（◯日 10:00）明示 ✔
- 締切後は非表示/切替 ✔

---

## 3. C — admin で差し戻し（中）

### 画面
ストーリーA の `apps/admin/src/pages/expenses.vue` を拡張。月次の作業員行を
**期(first/second)単位の精算行**までドリルできるようにし、各精算に実効ステータスを表示。

- `expense_settlements` を当月の対象 period（first/second）で取得し、daily_reports 集計と突合。
- `status='申請中'` の精算に **「差し戻し」ボタン**。押下で理由入力モーダル（**理由必須**）。
- 差し戻し実行: `status='差し戻し', reject_reason=入力, rejected_at=now`。
- 「要対応（申請中）」一覧（フィルタ）からは差し戻し後に外れる ✔。

### AC 対応
- 申請中→差し戻すと再申請できる状態（差し戻し）に戻る ✔
- 差し戻し時に理由を残せる（必須）✔
- 差し戻した精算は要対応(申請中)一覧から外れる ✔

> 作業員への LIFF/LINE 通知は要件上スコープ外（別ストーリー）。差し戻しは
> 次回 LIFF 表示時に「差し戻し（要再申請）」として作業員が気づける。

---

## 4. M — 申請PDFを設定メール宛へ自動送信（中）

### settings（admin）
`apps/admin/src/pages/settings.vue` に **通知先メール（複数）** UI を追加。
キー `expense_notify_emails`（JSON配列）。複数行の追加/削除/保存。

### edge function（新規）`supabase/functions/send-expense-application`
- 入力: `{ accountSlug, user_id, period_key }`（LIFF 申請後に呼ばれる）。
- 処理:
  1. settlement 行を取得。`notified_at` がセット済みなら **送信スキップ**（二重送信防止）。
  2. `settings.expense_notify_emails`（account 単位）を取得。空なら送信スキップ（ログ）。
  3. `expense-receipts` の `pdf_path` をダウンロード（service role）。
  4. **Resend API** で添付メール送信（作業員名・期・金額を本文に）。
  5. 成功で `notified_at=now` を更新。
- `RESEND_API_KEY` を Deno.env から取得。**`--no-verify-jwt` でデプロイ**（LIFF が anon 呼び出し）。CORS 対応（既存 function 準拠）。
- 既存「経費PDF発行の機能（完了）」= LIFF クライアントの print/jsPDF。サーバー再生成はせず、**クライアント生成PDFを Storage 経由で再利用**（車輪の再発明回避）。

### AC 対応
- settings で通知先メールを複数登録・編集 ✔
- 申請(未申請→申請中)時に登録メール宛へPDF自動送信 ✔
- 送信は申請成立時のみ・二重送信しない（`notified_at`）。差し戻し後の再申請は
  申請時に `notified_at` クリア → 1回だけ再送 ✔

---

## 5. AC → E2E（Playwright）

| spec | 内容 |
|---|---|
| `tests/e2e/liff.expense-apply.spec.ts` | W1: 未申請期に申請ボタン→申請→「申請済み」表示。期限超過期はボタン無し |
| `tests/e2e/liff.expense-deadline.spec.ts` | H: ホームに締切バナー＋締切日時表示 |
| `tests/e2e/admin.expense-reject.spec.ts` | C: 申請中精算を理由付きで差し戻し→ステータス差し戻し、要対応一覧から消える |
| M(メール) | Resend は外部依存のため E2E では function 呼び出し成否＋`notified_at` 更新までを検証（実送信はモック/ローカルInbucketか送信スキップ確認）。settings UI の保存はE2Eで検証 |

- seed: `global-setup.ts` に当月 first 期の dev-user 経費（既存 FEAT_C を流用可）と、
  差し戻しテスト用の `expense_settlements`(申請中) 行を追加。
- 締切判定は「現在時刻」依存のため、テストは固定日付に依存しない作りにする
  （seed の期を現在月から動的生成、既存 `FEAT_C_PERIOD` パターン踏襲）。

## 6. デプロイ順序・後方互換性

1. **DB**: `expense_settlements` migration 適用（追加のみ・後方互換）。**/ship 人間ゲート**。
2. **functions**: `send-expense-application` を `--no-verify-jwt` でデプロイ＋`RESEND_API_KEY` secret 登録。**/ship 人間ゲート**。
3. **admin / liff**: Vercel 本番デプロイ（settings UI / 差し戻し / 申請 / 締切バナー）。
- 既存機能への破壊的変更なし。settlement 行が無い間は全期「未申請/期限超過」に導出され、現行表示と矛盾しない。

## 7. 実装順序（承認後・各 feature ブランチ / dev 基点）
1. 共通基盤（migration + 締切/実効ステータス関数）
2. **W1**（申請）← H/C/M の前提
3. **H**（締切バナー・小）
4. **C**（差し戻し）
5. **M**（settings + Resend function）← W1 完了後

各ストーリーごとに feature ブランチ・コミット・E2E green を満たしてから次へ。

## 8. 未決/リスク
- Resend のローカルE2E: 実送信は行わず、ローカルは Inbucket か「送信スキップ＋notified_at検証」で代替。
- LIFF への jsPDF/html2canvas 追加でバンドル増。print 既存導線は残す。
- ストーリーA（月次集計）に期別ステータス列を出す改善は任意（別タスク化候補）。
