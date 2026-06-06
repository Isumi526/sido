# 設計書: 管理画面「経費管理」— 作業員×月の経費一覧（確認の土台）

- Notion: 管理者が、作業員×月ごとの経費を管理画面の一覧で確認できる（id 末尾 `d039ae6c`）
- エピック: 経費管理 / 優先順位: 緊急 / タグ: 機能追加
- ステータス: 親エピック「管理者が作業員の経費状況を…管理できる」の分割ストーリー **A（確認の土台）**
- スコープ: **admin のみ。DB マイグレーションなし（読み取り中心・追加のみ）**

---

## 1. 背景・目的

管理者が、各作業員の経費を「対象月」単位で一覧把握できる土台を作る。
本ストーリーは **読み取り中心**。状態遷移（支払い確定 / 差し戻し / 救済）は後続ストーリー B/C/D。

## 2. 受け入れ条件(AC)

- AC1: 管理画面 > 経費管理 を開くと、作業員 × 対象月ごとに1行（合計金額・件数）が一覧表示される
- AC2: 各行に現在のステータスが表示され、判別できる
- AC3: 表示は自アカウント(account)配下の作業員に限定され、他テナントの経費は混在しない

---

## 3. データモデル調査の結論（重要）

経費データは**2系統**存在するが、運用上の正は ① である：

| 系統 | 実体 | UI 利用状況 |
|---|---|---|
| ① `daily_reports.sites[].expenses` (JSONB) | 日報内に埋め込まれた経費（車両/電車/宿泊/その他/接待 等、`tategae`=個人建て替えフラグ付き） | **稼働中**。LIFF `/expense/print`・`/expense/download` がこれを集計してPDF化 |
| ② `expense_items` テーブル | 手動明細CRUD（payee/registration_number/category/period_key 等） | **実質レガシー**。`addItem/getItems/deleteItem` はエクスポートのみで UI 呼び出し皆無 |

→ **本ページは ① を集計する**。これにより admin の一覧と、各作業員が出力する PDF の金額が一致する。

### 既存の集計ロジック（再利用元）
`apps/liff/composables/useExpense.ts` の `getExpenseRowsFromReportsById(userId, periodKey)`:
- `daily_reports`(is_working=true) の `sites[].expenses` を展開し `ExpenseRow[]` に平坦化
- ガソリン/軽油は `settings` の単価(`gasoline_rate_per_km`/`diesel_rate_per_km`)× 距離で金額算出
- `period_key` は半月単位（`YYYY-MM-first` = 1〜15日 / `YYYY-MM-second` = 16〜末日）

### 精算単位（半月）と「対象月」の関係
精算の最小単位は半月（first/second）。AC は「対象月ごとに1行」なので、
**1か月 = first + second の合算**を1行として表示する（月内訳は詳細で確認可能にする）。

### テナント分離
`daily_reports.account_id` が存在し、既存ページと同じく `.eq('account_id', accountId)` で絞れる。
作業員名は埋め込み select で取得（reports.vue と同一パターン）:
```ts
.from('daily_reports')
.select('id, date, is_working, sites, user_id, users(real_name, worker_id, workers(name))')
.eq('account_id', accountId)
// worker_name = r.users?.workers?.name ?? r.users?.real_name ?? '—'
```

## 4. DB マイグレーション

**なし（追加もなし）。** 既存 `daily_reports` / `settings` / `users` / `workers` の読み取りのみ。
→ /ship の人間ゲート（DB push）は発生しない。後方互換性100%。

> 設計判断: AC2 のステータスに本来含まれる「支払い済み」は、支払い状態を持つ
> テーブル（例 `expense_settlements`）が必要だが、状態の**書き込み**は後続ストーリー
> B/C/D の領域。本ストーリー（読み取りの土台）では DB を増やさず、
> **データから導出できるステータスのみ**を表示する（下記 §6）。

## 5. admin UI 変更

### ルーティング `apps/admin/src/router/index.ts`
- `import Expenses from '../pages/expenses.vue'` を追加
- `{ path: '/expenses', component: Expenses }` を追加

### サイドメニュー `apps/admin/src/App.vue`
- 「レポート」セクション内、`/site-reports`（現場別集計）の隣に追加:
  ```html
  <li><RouterLink to="/expenses" class="nav-link"><span class="material-symbols-rounded nav-icon">receipt_long</span>経費管理</RouterLink></li>
  ```

### 新規ページ `apps/admin/src/pages/expenses.vue`
- 月ナビゲーション（`site-reports.vue` の `shiftMonth` / `yearMonth` パターンを踏襲）
- 選択中の年月について:
  1. `getAccountId()` でアカウント特定
  2. `daily_reports` を `account_id` + `is_working=true` + 当月（1日〜末日）で取得（users/workers 埋め込み）
  3. `settings` から燃料単価を取得
  4. `useExpense.ts` の平坦化ロジックを移植/共有して各日報の経費行を算出
  5. **作業員(user_id)ごとに合算** → 1行（合計金額・件数・ステータス）
- 一覧テーブル列: 作業員名 / 件数 / 合計金額 / うち立替(tategae)合計 / ステータス
- 行クリックで詳細（その作業員のその月の経費明細＝平坦化行の一覧）をモーダル/パネル表示（site-reports.vue の `selected` パターン）
- 空状態: 「この月の経費がありません」

> 平坦化ロジックは現状 LIFF 専用 composable にある。admin から直接 import できないため、
> **admin 側に同等の純関数 `flattenExpenses(sites, rates)` を `apps/admin/src/lib/expenses.ts` として新設**し、
> useExpense の該当ロジックと同じ計算（同じ単価キー・同じカテゴリ・tategae 判定）を実装する。
> （将来の共通化は packages/ への切り出しを別タスク化＝残課題候補）

## 6. ステータスの導出（AC2）

DB に支払い状態が無いため、本ストーリーでは以下を**データから導出**して表示する:

| 表示ステータス | 条件 |
|---|---|
| 申請あり | その作業員のその月に経費行が1件以上ある |
| なし | 経費行が0件（当月に稼働日報はあるが経費未入力 等） |

- 「支払い済み」「申請中/差し戻し」など**状態遷移を伴うステータスは後続ストーリーで状態テーブル追加後に対応**する旨を、画面上に注記（または列ヘッダ補足）として明示。
- これにより AC2（「ステータスが表示され判別できる」, 例示は「等」）を、DB 変更なしで満たす。

## 7. AC → E2E ケース（Playwright）

`tests/e2e/admin.expenses.spec.ts` を新規作成（`admin.contractors.spec.ts` を雛形）:

- **E2E-1 (AC1)**: `/expenses` を開く → `h1` が「経費管理」/ 月ナビゲーションが表示 / シードデータのある月で作業員行に合計金額・件数が表示される
- **E2E-2 (AC2)**: 経費のある作業員行にステータス（「申請あり」）が表示される
- **E2E-3 (AC3)**: テナント分離 — 表示される作業員が当アカウント(seed/test)配下のみ（他テナント名が出ない）。`global-setup` のシード作業員のみが出ることで確認
- 既存 `global-setup.ts` のシード（日報＋経費 JSON）が当月に無い場合は、テスト内で月を該当期間へナビゲートする/または seed 期間を参照（`FEAT_C_PERIOD` 等の既存定数を活用）

## 8. デプロイ順序・後方互換性

- DB 変更なし → マイグレーション適用不要。
- admin のみのフロント追加（新ページ＋メニュー＋ルート＋純関数）。既存画面に影響なし。
- /ship 時は admin の Vercel 本番デプロイ1本のみ。人間ゲート（DB push）は不要。

## 9. スコープ外（残課題候補）

- 支払い確定 / 差し戻し / 救済の**状態管理**（`expense_settlements` 等のテーブル新設＝migration人間ゲート）→ 後続 B/C/D
- 平坦化ロジックの LIFF/admin 共通化（`packages/` 切り出し）
- `expense_items`（レガシーテーブル）の扱い整理（廃止 or 用途確定）
