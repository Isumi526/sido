# 設計書: 代理入力でも「翌日分の日報」ボタンを表示する

- Notion: ユーザーが代理入力の際、連日分の日報送信をスムーズに行える（id 末尾 `fe21c7d8`）
- タグ: バグ / 優先順位: 中 / スコープ: **liff のみ・DB変更なし**

## 1. 課題・目的
日報送信完了画面には「{翌日}の日報を入力する →」ボタンがあり、連続入力をスムーズにしている。
しかし **代理入力（proxy）モードでは表示されない**（自己入力時のみ表示）。代理で連日分を入力する
事務員等の手間になっている。

## 2. 受け入れ条件(AC)
- AC1: 代理入力で日報送信した際、翌日（次の未送信日）分へのリンクボタンが表示される
- AC2: ボタンをタップすると、代理状態を保ったまま次の未送信日の入力画面に遷移する

## 3. 原因（調査結果）
`apps/liff/pages/report.vue` の送信後処理 L1158:
```ts
// ④ 次の未送信日を取得してサクセス画面に表示（自分自身の分のみ）
if (!report.error.value && uid && !proxyT) {            // ← !proxyT で代理時は除外
  const next = await expense.getNextUnsubmittedDate(uid).catch(() => null)
  if (next && next !== 'NOT_CONFIGURED') nextUnsubmittedDate.value = next
}
```
`nextUnsubmittedDate`（ボタン表示条件 `v-if="!editSubmitted && nextUnsubmittedDate"`）が
**代理時はセットされない**ためボタンが出ない。
一方 `goToNextReport()` は proxy 状態に触れず次日付をフォームに入れるだけなので、
**代理状態を維持したまま次日へ遷移できる（修正不要）**。送信時点で `targetUserId`
（代理なら代理先 user.id / 自己なら自分 user.id）が確定済み。

## 4. 変更内容（1ブロックのみ）
`report.vue` L1158 のブロックを、`targetUserId` を使って自己・代理を統一:
```ts
// ④ 次の未送信日を取得してサクセス画面に表示（自己・代理とも）
if (!report.error.value && targetUserId) {
  const next = await expense.getNextUnsubmittedDateById(targetUserId).catch(() => null)
  if (next && next !== 'NOT_CONFIGURED') nextUnsubmittedDate.value = next
}
```
- 自己: `targetUserId = selfUser.id` → `getNextUnsubmittedDateById` は従来の `getNextUnsubmittedDate(uid)` と等価
- 代理: `targetUserId = 代理先 user.id` → 代理先の次の未送信日がセットされボタンが出る
- `goToNextReport()` は変更不要（proxy 状態を維持して次日をセット）

## 5. DBマイグレーション / functions
**なし**。LIFF フロントのみ。後方互換。

## 6. AC → E2E（Playwright）
代理モードE2Eは seed（can_proxy 作業員＋代理対象）の用意が必要で重い。本タスクは
ロジックが「送信後 `nextUnsubmittedDate` を targetUserId で必ずセット」に一本化される
小修正のため、E2E は以下で対応:
- 既存 `tests/e2e/liff.report.spec.ts`（自己入力）の「送信→完了画面」フローで
  **翌日ボタンが従来どおり出る**ことを確認（リグレッション防止）。
- 代理経路は、proxy seed が用意できれば追加。難しければ手動確認（dev で代理モード→送信→
  ボタン表示→タップ遷移）を報告に明記。

> 注: service_start_date 未設定だと `getNextUnsubmittedDate*` が 'NOT_CONFIGURED' を返し
> ボタンは出ない（自己も同様の既存仕様）。代理先に日報履歴が無い場合は開始日が返る。

## 7. デプロイ順序・後方互換性
- フロントのみ。/ship 時は liff の Vercel デプロイ1本。DB/functions ゲートなし。
