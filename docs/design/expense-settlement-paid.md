# 詳細設計: 月次精算「支払い済み」確定 ＋ 支払い区分登録（分割B）

> 親エピック: 経費管理 / 正典: [`docs/spec/expense.md`](../spec/expense.md)
> 土台A: [`docs/design/admin-expense-monthly-summary.md`](./admin-expense-monthly-summary.md)
> Notion: 管理者が、申請中の月次精算を「支払い済み」にでき、支払い区分を登録できる
> ステータス: 申請中 → 支払い済み（保存遷移）

## 1. 背景 / 目的
経費正典 §3 で「支払い済み」は **別ストーリーで設定** とされていた保存状態。本ストーリーで
管理者が **申請中の月次精算を「支払い済み」に確定** でき、その際 **支払い区分（銀行振込 / 手渡し）**
と **支払日** を登録できるようにする。支払い済みにした精算は「要対応（申請中）」一覧から外れる。

土台A（`apps/admin/src/pages/expenses.vue`）は読み取り＋差し戻し(C)まで実装済み。本ストーリーは
その settle-row に「支払い済みにする」操作を足し、`expense_settlements` に支払い情報列を追加する。

## 2. ユーザーストーリー
管理者として、申請中の月次精算を確認し、支払い区分と支払日を登録して「支払い済み」に確定したい。
それにより未対応の精算と支払い済みの精算を区別し、要対応一覧をクリーンに保ちたい。

## 3. 受け入れ条件(AC) → 実装対応
| AC | 実装 |
|---|---|
| AC1: 申請中を「支払い済み」に更新でき、更新後ステータスが支払い済みに変わる | settle-row に「支払い済みにする」ボタン → 支払いモーダルで確定 → `status='支払い済み'` を update |
| AC2: 支払い区分（銀行振込 / 手渡し）を選んで登録でき、一覧・詳細に反映される | モーダルで `payment_method` select 必須 ＋ `paid_on`(支払日) date。一覧バッジ＝「支払済（区分）」、詳細＝区分＋支払日表示 |
| AC3: 支払い済みにした精算は「要対応(申請中)」一覧から外れる | `todo` フィルタは `status==='申請中'` 抽出のまま。支払い済みは自動的に外れる（追加実装なし） |
| （取消・ユーザー判断で追加）支払い済み→申請中に戻せる | 詳細モーダルで「申請中に戻す」リンク → 確認 → `status='申請中'`・支払い情報をクリア |

## 4. データモデル（migration・追加のみ・後方互換）

新規 migration: `supabase/migrations/20260607110000_expense_settlement_payment.sql`

```sql
-- 月次精算 支払い情報（分割B）。expense_settlements への列追加のみ・後方互換。
alter table expense_settlements
  add column if not exists payment_method text,  -- 支払い区分: '銀行振込' | '手渡し'（支払い済み時に登録）
  add column if not exists paid_on        date;  -- 支払日（管理者入力。下請け請求 transfer_date と同方針）
```

- **後方互換**: 既存行・既存ステータス（申請中/差し戻し/支払い済み）に影響なし。列は nullable で追加のみ。
- `status='支払い済み'` を保存遷移として正式に使い始める（正典 §3 の予告どおり）。
- 支払日は date 型（時刻不要・下請け請求 `transfer_date` と一致）。確定時刻は `updated_at` で足りるため別列は設けない。
- RLS は既存どおり無効（テーブル方針継承）。

### ステータス遷移（本ストーリーで追加する辺）
```
申請中 ──支払い確定(区分+支払日)──▶ 支払い済み
支払い済み ──取消(申請中に戻す)──▶ 申請中   // payment_method/paid_on を null クリア
```

## 5. admin UI 変更（`apps/admin/src/pages/expenses.vue`）

### 5-1. 型・ステータス
- `PeriodRow.settlement` は `payment_method` / `paid_on` を含む（`select('*')` のため取得済み）。
- `STATUS_CLASS` は既存の `'支払い済み': 'paid'` を流用。

### 5-2. 一覧テーブル（ステータス列）
- `支払い済み` 行のバッジを「支払済（{payment_method}）」表記に。区分が無い旧データは「支払済」のみ。
  - 実装: `statusLabel` 算出時、`status==='支払い済み' && settlement.payment_method` なら
    `支払済（手渡し）` のように整形。バッジ class は `st-paid` 据え置き。

### 5-3. 明細モーダル settle-row
- **申請中のとき**: 既存「差し戻し」ボタンの隣に **「支払い済みにする」** ボタン（緑系、下請けの `btn-status-pay` 相当）を追加。
- **支払い済みのとき**: 「支払区分: 手渡し ／ 支払日: 2026-06-20」を表示し、右に小さく **「申請中に戻す」** リンク（下請けの `btn-status-link` 相当）。

### 5-4. 支払いモーダル（新規・下請け `payState` パターン流用）
```
「{workerName}（{shortLabel}）」を支払い済みにします。
支払い区分:  [ 銀行振込 ▼ / 手渡し ]   （必須）
支払日:      [ 2026-06-07 ]            （date・既定=今日・必須）
[キャンセル] [支払い済みにする]
```
- バリデーション: 区分未選択 or 支払日未入力なら確定ボタン disabled（下請けと同様）。
- 確定処理:
  ```ts
  await supabase.from('expense_settlements')
    .update({ status: '支払い済み', payment_method, paid_on, updated_at: now })
    .eq('account_id', accountId).eq('user_id', t.userId).eq('period_key', t.periodKey)
  ```
  → モーダル閉じ → `selected=null` → `load()` 再読込。

### 5-5. 取消（支払い済み→申請中）
- 「申請中に戻す」→ 日本語確認ダイアログ（下請けの `askConfirm` パターンを移植 or 簡易 confirm-box）。
  ```ts
  await supabase.from('expense_settlements')
    .update({ status: '申請中', payment_method: null, paid_on: null, updated_at: now })
    .eq(...)
  ```
- 注: 元の status が差し戻し由来でも、支払い済みからの取消先は **申請中** に統一（運用上、支払い対象＝申請中の母集団へ戻す）。

### 5-6. フィルタ
- 既存 `all` / `todo(申請中)` のまま。`todo` は `status==='申請中'` 抽出なので **AC3 を自動充足**。
  （`支払い済み` タブの追加は本ストーリー外。`すべて` で参照可能。）

## 6. liff / Edge Functions
- **変更なし**。LIFF 側は支払い済みを「支払い済み」と表示する分岐が既存（`expense/download.vue`）。
  支払い区分の作業員向け表示は本ストーリー要件外（必要なら別ストーリー）。
- メール通知（支払い確定通知）は AC に無いため本ストーリーでは送らない。`send-expense-application` は無改修。

## 7. デプロイ順序・後方互換
1. migration を本番適用（列追加のみ・既存に無影響）。→ /ship の人間ゲート。
2. admin 配信。古い admin が新列を無視しても動作（select * で無害）。新 admin が旧データ（payment_method=null）を
   「支払済」のみ表示でフォールバック。
- **ロールバック安全**: 列は残しても害なし。admin を戻しても DB の支払い済み行はそのまま。

## 8. AC → E2E（Playwright・`tests/e2e/admin.expense-paid.spec.ts`）
土台C `admin.expense-reject.spec.ts` を雛形に、seed は `expense_settlements` の申請中行（冪等 upsert）。

1. **AC1+AC2+AC3**: 申請中行 → 詳細 → 「支払い済みにする」→ 区分=手渡し・支払日入力 → 確定 →
   - 要対応(申請中)フィルタから `SEED_WORKER` が消える（AC3）。
   - すべて表示でバッジが「支払済（手渡し）」（AC1・AC2）。
2. **取消**: 支払い済み行 → 詳細 →「申請中に戻す」→ 確認 →
   - 要対応(申請中)フィルタに `SEED_WORKER` が戻る。
3. **バリデーション**: 支払いモーダルで区分・支払日未入力なら確定ボタン disabled。

## 9. スコープ外（残課題候補）
- 支払い確定/取消のメール通知。
- 一覧の「支払い済み」専用タブ・期間横断の支払い実績一覧。
- 支払い区分の作業員向け（LIFF）表示。
