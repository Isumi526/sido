# 設計案：下請け業者向け トークン認証基盤（#2 AC3）

> ステータス：**設計レビュー待ち（未実装）**。本ドキュメントは承認をもらってから実装に入るための提案。
> 対象タスク：「下請け業者マスタ（…）＋トークン認証基盤」AC3。
> 親：見積→注文→請求エピック（[[subcontractor-detail-search]] / 設計メモ）。

## 1. 要件（Notion AC3 より）
- 推測困難なトークンを発行し、URL に付与する。
- トークンから**対象業者・対象文書**を一意に特定できる。
- **他業者のデータにアクセスできない**／**他テナント(account)のデータも見えない**。
- 業者は**フルログイン（パスワード）を作らない**＝トークンURL方式のみ。
- 用途：注文書の承諾(#3)・請求フォーム入力(別チケット)を、業者がメールのURLから行う土台。

## 2. 現状アーキテクチャと“効いてくる”制約
- 既存テーブルは **RLS無効**＋**anonキーで全開**、テナント分離は**アプリ側のコード**で担保（[[project_local_supabase_stack]] / メモ参照）。
- ⇒ **外部の業者クライアントに anon キーや直接 REST アクセスを絶対に渡せない**（渡すと他業者・他テナントを読めてしまう）。
- 結論：**業者向けの読み書きは 100% Edge Function 経由**にし、**サーバ側(service role)でトークン検証→スコープして必要分だけ返す**。業者ブラウザはトークンを持って Edge Function を叩くだけで、DBに直接触らせない。

## 3. 全体構成（提案）
```
[業者] --(メールのURL: /p/<token>)--> [業者ポータル(軽量Webページ)]
                                         |  fetch (token を body/headerで送る)
                                         v
                          [Edge Function: subcontractor-portal] (verify_jwt=false, service role)
                                         |  token検証→account/業者/文書をスコープ
                                         v
                                   [Supabase DB]
```
- 業者ポータル＝**トークンが無ければ何も出ない**静的に近いページ。anonキーでのDB直アクセスはしない（Edge Function のみ呼ぶ）。
- Edge Function が唯一の入口。トークン→`account_id`＋`subcontractor_id`＋許可文書 に厳密スコープ。

## 4. データモデル（追加のみ・案）
```sql
create table document_access_tokens (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) not null,
  subcontractor_id uuid references subcontractors(id) not null,
  -- 対象文書。purpose で用途を区別し、document_id で具体文書に紐付け
  purpose          text not null,            -- 'order_accept'(注文書承諾) / 'invoice_submit'(請求) 等
  document_type    text,                     -- 'purchase_order' / 'invoice' …（任意）
  document_id      uuid,                      -- 対象文書ID（業者単位トークンなら null）
  token_hash       text not null,             -- ★トークン“そのもの”は保存しない。SHA-256 ハッシュのみ保存
  expires_at       timestamptz,               -- 失効（null=無期限。運用で必須化を推奨）
  revoked_at       timestamptz,               -- 手動失効
  used_at          timestamptz,               -- 単回利用にする場合の使用済み記録
  last_accessed_at timestamptz,
  created_by       uuid references workers(id),
  created_at       timestamptz default now()
);
create index on document_access_tokens (token_hash);
create index on document_access_tokens (subcontractor_id);
alter table document_access_tokens disable row level security; -- 既存同様。ただし anon から触らせない（Edge専用運用）
```
- **平文トークンはDBに保存しない**（漏洩時の被害低減）。発行時に平文をメール送付し、DBには `token_hash=SHA-256(token)` のみ。検証は受領トークンをハッシュして突合。

## 5. トークン仕様
- **生成**：`crypto.getRandomValues` で 32 byte（256bit）→ base64url。推測・列挙不可能。
- **URL形**：`https://<portal>/p/<token>`（パスに置く。クエリよりログ残り考慮しパス＋短命運用）。
- **スコープ**：`token_hash` → 1レコード。そのレコードの `account_id`/`subcontractor_id`/`document_id` 以外は**一切返さない**。Edge Function は常にこの3つで `where` を縛る。
- **有効期限/失効**：`expires_at`（要：運用ポリシー決定）、`revoked_at`（注文書取消時など）、`used_at`（承諾は単回でもよい→要決定）。
- **テナント分離**：トークンに `account_id` が内包されるので、文書取得は必ず `account_id` も一致させる二重縛り。

## 6. Edge Function 設計：`subcontractor-portal`（`verify_jwt=false`）
- 入力：`{ token, action, payload? }`。
- `action='resolve'`：トークン検証→注文書/請求の**表示用データだけ**返す（業者名・対象現場・金額・承諾文言など）。無効/期限切れ/失効なら 404 相当（**存在を区別しない**＝列挙対策）。
- `action='accept'`（#3で使用）：承諾＋署名証跡を保存（別チケットだが基盤はここ）。
- `action='submit_invoice'`（請求チケットで使用）。
- 共通：service role でDBアクセス、CORS、レート制限（同一IP/トークンの試行回数制限）、`last_accessed_at` 更新、平文トークンを**ログに出さない**。
- 既存 `get-master`/`daily-reminder` と同じ Deno.serve＋createClient(service role) パターンに合わせる。

## 7. 業者ポータルの“置き場所”（★要判断）
業者は LINE ユーザーではないため、LIFF(LINE)には載せない。候補：
- **(P1) 既存 admin アプリ内の公開ルート** `/p/:token`（認証ガード除外）。実装が最小。ただし管理画面と同一オリジン。
- **(P2) liff(Nuxt)アプリに公開ルート** `/p/[token]`（LIFF初期化させない素のページ）。Nuxtの静的配信に乗る。
- **(P3) 新規の極小ページ/アプリ**。分離は綺麗だがデプロイ先が増える。
- 推奨：**P2(Nuxt素ルート)** か **P1**。いずれも「ページはトークンを Edge に渡すだけ」で、UIは最小。

## 8. セキュリティ要点（実装時チェックリスト）
- 256bit乱数・ハッシュ保存・列挙不可（無効と不存在を同じ応答に）。
- account/subcontractor/document の三重スコープを Edge で必ず適用。
- レート制限・試行ログ。HTTPSのみ。トークンを**ログ/チャット/エラーに残さない**。
- 失効導線（注文書取消・期限切れ）。承諾は単回化を推奨。
- E2Eで**他業者トークンで他業者文書が取れない**ことを明示的に検証（分離の証明）。

## 9. 既存機能との接続
- **#1 注文書発行**：発行時に `document_access_tokens` を1件発行（purpose=order_accept, document_id=注文書ID）→平文をメールURLに載せる（メール送信は#1 AC4・外部送信のため別途承認）。
- **#3 承諾＋署名**：`action='accept'` で同意日時/IP/署名画像/PDFハッシュを証跡保存（法務確認後）。
- **請求(別チケット)**：`action='submit_invoice'`。

## 10. 実装計画（承認後）
1. migration（追加のみ）：`document_access_tokens`。
2. Edge Function `subcontractor-portal`（resolve のみ先行）＋ `config.toml` に `verify_jwt=false`。
3. 業者ポータルの最小ルート（★決定した置き場所）。
4. 発行ユーティリティ（admin側：トークン生成→hash保存→URL組み立て）。※メール送信は#1で。
5. E2E：発行→resolveで自分の文書だけ取得／**他業者トークンでは取得不可**／期限切れ・失効で不可。
6. 本番反映時：migration（追加のみ＝/ship承認でCC適用可）＋ Edge Function deploy（/ship承認）。

## 11. 未決定事項（判断をください）
- **(a) ポータル置き場所**：P1(admin公開ルート) / P2(Nuxt素ルート) / P3(新規)。推奨 P2 または P1。
- **(b) トークン粒度**：文書単位（注文書1通=1トークン／推奨・最小権限）か、業者単位（1業者=1トークンで複数文書）か。推奨：**文書単位**。
- **(c) 有効期限**：無期限／発行から N 日／承諾まで。推奨：**長め(例 60日)＋失効可**、承諾は単回。
- **(d) 失効運用**：注文書取消・再発行時に旧トークン失効でよいか。
- **(e) メール送信基盤**：既存 Resend（`send-expense-application`）を流用予定。送信は#1で外部送信承認を取る前提でよいか。
