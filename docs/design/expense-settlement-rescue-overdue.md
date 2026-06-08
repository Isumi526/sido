# 詳細設計: 期限超過の月次精算を「未申請に戻す」救済処置（分割D）

> 親エピック: 経費管理 / 正典: [`docs/spec/expense.md`](../spec/expense.md)
> 関連: [`expense-settlement-paid.md`](./expense-settlement-paid.md)（支払い／取消の admin パターン）
> Notion: 申請期限を超過した月次精算を未申請に戻せる（救済処置）

## 1. 背景 / 目的
締切（first=当月18日10:00 / second=翌月3日10:00 JST）を過ぎると、月次精算は **期限超過**（行なし＋締切超過で導出）
となり、LIFF の `canApply=（未申請 or 差し戻し）` 判定により作業員は申請できない。
本ストーリーは、管理者が **期限超過の精算を「未申請に戻す」** ことで、作業員が再申請できる状態へ救済する。

## 2. 受け入れ条件(AC) → 実装対応
| AC | 実装 |
|---|---|
| 期限超過を一覧で判別できる | 既存：`effectiveStatus` が `期限超過` を導出・`st-expired` バッジ表示（実装済み） |
| 期限超過を「未申請に戻す」操作で再申請可能にできる | 明細モーダルに **「未申請に戻す（救済）」** ボタン → `status='未申請'` 行を upsert |
| 救済操作は期限超過のものだけに表示（申請中等には出ない） | `v-else-if="selected.status === '期限超過'"` でのみ表示 |

## 3. 設計判断（救済の DB 表現）
- **問題**: 「期限超過」「未申請」はどちらも **行なしで導出**（正典 §3）。期限超過には DB 行が無く、`status` 列は
  `not null default '申請中'`。救済で「未申請」に戻すには行が要る。
- **採用案**: 救済時に **`status='未申請'` の行を upsert** する（救済時のみ `未申請` を保存値として使う）。
  - `effectiveStatus` は `行あり → row.status` を返すため、救済後は **未申請**（締切を過ぎても期限超過に再導出されない＝救済が効く）。
  - LIFF の `canApply` は `未申請` を許可済み → **作業員は既存フローでそのまま再申請可能**（LIFF 改修不要＝スコープ admin+DB に一致）。
  - admin `STATUS_CLASS['未申請']='todo'`、`要対応(申請中)` フィルタは `status==='申請中'` 抽出のため救済行は紛れない。
- **却下案**: 締切延長カラム / 管理者が直接 `申請中` 化 → 前者は行なし問題が残る・後者は作業員の申請PDF/確認を経ず実態とズレ（AC「未申請に戻す＝再申請可能」に反する）。
- **正典更新**: `docs/spec/expense.md §3` に「`未申請` は通常は導出だが、救済処置でのみ保存値として作られる（期限超過→未申請）」を追記。

## 4. データモデル
- **マイグレーション不要**。`expense_settlements.status` は `text`（CHECK制約なし）なので `'未申請'` を保存可能。
- 救済 upsert（onConflict: account_id,user_id,period_key）:
  ```ts
  { account_id, user_id, period_key, status: '未申請',
    applied_at: null, pdf_path: null, reject_reason: null, rejected_at: null,
    payment_method: null, paid_on: null, notified_at: null, updated_at: now }
  ```
  - 期限超過は行なし → insert で新規作成。万一行があるケースでも上書きで未申請化。
- 後方互換: 追加の列なし。既存ステータス（申請中/差し戻し/支払い済み）に影響なし。

## 5. admin UI（`apps/admin/src/pages/expenses.vue`）
- 明細モーダル settle-row に、期限超過時のみ救済ボタンを追加（既存の `undoPaid` パターンを流用）:
  ```html
  <button v-else-if="selected.status === '期限超過'" class="btn-rescue" @click="rescueOverdue(selected)">未申請に戻す（救済）</button>
  ```
  （`申請中`→差し戻し/支払い、`支払い済み`→申請中に戻す、`期限超過`→未申請に戻す、で出し分け）
- 確認ダイアログ（既存 confirm-box パターン）: 「〈作業員〉〈期〉を未申請に戻し、再申請できるようにします。よろしいですか？」
- `rescueOverdue` 関数: 上記 upsert → `selected=null` → `load()` 再読込。
- スタイル: `.btn-rescue`（`btn-pay` 系の控えめな枠ボタン）。

## 6. liff / Edge Functions
- **変更なし**（スコープ admin+DB）。救済後は `未申請` 行となり、既存の LIFF 申請フロー（`canApply` が未申請を許可）でそのまま再申請可能。
- 通知・PDF も既存の申請フローを通る（救済自体は通知しない）。

## 7. AC → E2E（Playwright・`tests/e2e/admin.expense-rescue.spec.ts`）
- seed: 締切を過ぎた期（前月など now>deadline）に作業員の経費（daily_reports）を入れ、settlement 行は作らない → **期限超過**。
  - 既存 `effectiveStatus` 上、前月 first/second は当月時点で締切超過。前月の経費 daily_reports を upsert（settlementなし）。
- ケース:
  1. admin で当該月へ移動 → 当該行が **期限超過** バッジで出る。モーダルに「未申請に戻す（救済）」ボタンがある。
  2. 救済クリック → 確認 → 行が **未申請** に変わる（バッジ `未申請`）。`expense_settlements` に status='未申請' 行ができる（REST 検証）。
  3. **申請中・支払い済みの行には救済ボタンが出ない**（出し分け検証）。

## 8. デプロイ順序・後方互換
1. DB migration: なし。
2. フロント: admin のみ（liff 無改修）。後方互換のため順不同で安全。
- ロールバック安全: 救済で作った `未申請` 行は削除すれば元の期限超過（導出）に戻る。admin を戻しても既存ステータスは無影響。

## 9. スコープ外（残課題候補）
- 救済の取り消し（未申請→期限超過へ戻す）。
- 救済の監査ログ列（`reopened_at` 等）。今回は行の存在＝救済済みで足りるため見送り。
- 救済後に再度締切を設ける（時限再オープン）。
