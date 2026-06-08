# 経費 正典スペック（経費管理エピック 共通仕様）

> このファイルは経費管理エピックの **用語・状態・締切ルールの単一の正典**。
> admin / liff / functions / DB はすべてこの定義に従う。各ストーリーの設計書
> （`docs/design/expense-*.md`）はこのスペックを参照する。

## 1. 用語

| 用語 | 定義 |
|---|---|
| 経費明細 | `daily_reports.sites[].expenses` (JSON) から平坦化される1行の経費（車両/電車/宿泊/その他、`tategae`=個人建て替えフラグ付き） |
| 月次精算（精算） | **作業員 × 期(period)** の経費申請の単位。1精算 = 1 `expense_settlements` 行 |
| 期 / period_key | 半月単位。`YYYY-MM-first`（1〜15日）/ `YYYY-MM-second`（16〜末日） |
| 申請 | 作業員がその期の経費を確定し管理者へ提出する操作 |
| 差し戻し | 管理者が申請中の精算を作業員に戻す操作（理由必須） |

> 注: 「請求書 / 月請求書」という旧称は使わず **月次精算** に統一する。

## 2. 期（period）と締切ルール（JST）

申請単位は**半月（first/second）**。各期に固有の締切を持つ。

| 期 | 対象日 | **締切（JST）** |
|---|---|---|
| `YYYY-MM-first`  | 1〜15日   | **当月 18日 10:00** |
| `YYYY-MM-second` | 16〜末日  | **翌月 3日 10:00** |

- 締切判定は常に JST（Asia/Tokyo）で行う。
- 期の開始: first=1日 / second=16日。締切を過ぎた期は新規申請不可（救済を除く）。

### 締切アラートの表示期間（LIFFホーム・H）
申請受付〜締切のあいだだけホームに締切バナーを出す（期間外は出さない）。

| 期 | アラート表示期間（JST） |
|---|---|
| `YYYY-MM-first`  | **15日 〜 18日 10:00** |
| `YYYY-MM-second` | **翌月 1日 〜 3日 10:00** |

```
deadline(periodKey): Date(JST)
  [y, m, half] = split('-')
  half=='first'  → y年 m月 18日 10:00
  half=='second' → (m+1)月 3日 10:00   // 12月secondは翌年1月3日
```

## 3. ステータス（DB正典）

ステータス値（5種）: **未申請 / 申請中 / 支払い済み / 差し戻し / 期限超過**

実装上は「**保存する状態**」と「**導出する状態**」に分かれる:

| ステータス | 保存/導出 | 条件 |
|---|---|---|
| 未申請 | 導出（救済時のみ保存） | `expense_settlements` 行なし & 現在 ≤ 締切。例外：救済処置（D）で `status='未申請'` 行を作る（期限超過→未申請に戻し再申請可能化）。行があれば `row.status='未申請'` を返す |
| 期限超過 | 導出 | 行なし & 現在 > 締切 |
| 申請中 | 保存 | `status='申請中'` |
| 差し戻し | 保存 | `status='差し戻し'`（`reject_reason` あり） |
| 支払い済み | 保存 | `status='支払い済み'`（支払いストーリーで設定。本エピックの4件では書き込まない） |

**実効ステータス関数（共通ロジック）:**
```
effectiveStatus(settlementRow | null, periodKey, now):
  if row exists → row.status               // 申請中 / 差し戻し / 支払い済み
  else → now <= deadline(periodKey) ? '未申請' : '期限超過'
```

### 状態遷移
```
(未申請)──申請──▶ 申請中 ──差し戻し(理由必須)──▶ 差し戻し
                  │                              │
                  │◀────────── 再申請 ───────────┘
                  └──支払い確定(別story)──▶ 支払い済み

(締切超過で行なし) = 期限超過（申請不可）
救済(別story D): 期限超過/申請中 → 未申請（管理者操作）
```

### 作業員向け表示文言（LIFF）
DB値はそのまま、LIFF表示のみ言い換えてよい:
- 申請中 → 「申請済み」
- 期限超過 → 「申請期限切れ」
- 差し戻し → 「差し戻し（要再申請）」＋理由
- 未申請 → 「未申請」

## 4. データモデル: `expense_settlements`（新設・追加のみ）

```sql
create table expense_settlements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references accounts(id) not null,
  user_id       uuid references users(id) on delete cascade not null,
  period_key    text not null,                 -- 'YYYY-MM-first' | 'YYYY-MM-second'
  status        text not null default '申請中', -- 申請中 / 差し戻し / 支払い済み
  applied_at    timestamptz,                   -- 申請(成立)日時
  pdf_path      text,                          -- Storage(expense-receipts)上の申請PDFパス
  reject_reason text,                          -- 差し戻し理由（差し戻し時必須）
  rejected_at   timestamptz,
  notified_at   timestamptz,                   -- メール送信済み時刻（二重送信防止）
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (account_id, user_id, period_key)
);
-- LIFF は anon キーで読み書きするため RLS 無効（既存 daily_reports/expense_items と同方針）
alter table expense_settlements disable row level security;
```

- 行は **申請が発生した時にのみ作成**（未申請/期限超過は行なしで導出）。
- テナント分離: `account_id`。作業員: `user_id`（→ users → workers.name）。
- 後方互換: 追加のみ。既存テーブル変更なし。ストーリーA（月次集計）は引き続き
  `daily_reports` を集計し、必要なら本テーブルを left join して実効ステータスを表示できる。

## 5. settings キー（追加）

| key | 用途 | 形式 |
|---|---|---|
| `expense_notify_emails` | 経費申請の通知先メール（複数） | JSON配列 または カンマ区切り文字列 |

## 6. PDF / メール

- **PDF**: 申請時に LIFF クライアントが既存の経費表レイアウト（`/expense/download`）から
  jsPDF で生成 → `expense-receipts` バケットへ保存（パスを `pdf_path` に記録）。
- **メール**: edge function が Resend API で `expense_notify_emails` 宛に送信。
  PDF は Storage の `pdf_path` から取得して添付。
  - 二重送信防止: `notified_at` がセット済みなら送らない。差し戻し→再申請では
    申請時に `notified_at` を null クリアして1回だけ再送する。
  - function は LIFF が認証ヘッダ無しで叩くため **`--no-verify-jwt`** 必須。
  - `RESEND_API_KEY` は function secret として登録（本番は /ship の人間ゲート）。
