# 詳細設計書: 作業員が登録した下請業者が次回から確実に選択できる

- Notionタスク: 作業員が登録した下請業者が次回から確実に選択できる（要件定義済み / 優先:高 / タグ:バグ）
- Notion ID: `3760ff81-c56b-80d2-996c-f825ff1fcbd6`
- 対象アプリ: **LIFF のみ**（admin / edge functions / DB 変更なし）

---

## 1. 背景・目的

日報フォームの「下請け業者」プルダウンで「その他（新規追加）」から業者を登録・送信すると、その業者は `subcontractors` テーブルに upsert される。
しかし「登録したのに翌日プルダウンに出てこない」という事象が報告された（例: 「香田」）。

### 調査結果（本番DB 読み取りで確認済み）
- 「香田」は `subcontractors` に **正しく存在**（`active=true` / `account_id` も sido 正・`created_at=2026-06-03T08:25:47Z`）。
- `account_id IS NULL` の不正レコードは **無し**。読み取りクエリ条件（`active=true AND account_id=該当`）に合致するため、本来は返るはず。
- 読み取り経路（Supabase 直 / GAS `getMaster` 経由）はどちらも同一条件で Supabase を引いており、フォールバックも新鮮。
- プルダウンは `master.subcontractorNames`（リアクティブ）を直接参照。

→ **データ・クエリ・描画は正常**。原因はクライアント側の「保存の確実性」と「一覧の鮮度保証」の2つのギャップに限定される。クライアントログが無いため特定端末の発火条件は再現不能だが、AC「**確実に**選択できる」を満たすため両ギャップを塞ぐ。

### 確定した2つの実害ギャップ
1. **保存が fire-and-forget＋silent catch**
   `apps/liff/composables/useReport.ts`（③ 新規マスタ保存）は `master.saveSub(...)` を await せず発火するだけ。`useMaster.saveSub()`（`apps/liff/composables/useMaster.ts:140-156`）は失敗を `console.warn` で握りつぶす。
   → 送信時に upsert が失敗しても**日報送信は成功扱い**になり、下請が黙って失われる（次回出ない）。
2. **フォーム表示時に最新一覧を保証しない**
   `report.vue` マウントの新規パスは `master.fetch()`（非force）。`useMaster.fetch()`（`useMaster.ts:43-57`）はキャッシュ有効時（30分 TTL）に**即座にキャッシュ値を返し**、Supabase 更新はバックグラウンド（await されない）。このバックグラウンド更新が失敗すると、その端末は古い一覧のまま固定され得る。編集パス（`report.vue:1209`）だけは `fetch(true)` で強制最新化済みで、新規パスと不整合。

---

## 2. ユーザーストーリー / 受け入れ条件(AC)

- 作業員として、日報フォームから新規の下請け業者を登録・送信したら、次回フォームを開いた際にその業者をプルダウンから選べる。

**AC**
- AC1: 日報フォームで「その他」から下請業者名を入力し送信 → `subcontractors` に該当 account で upsert される（保存完了を待ってから送信完了とする）。
- AC2: 保存（upsert）が失敗した場合、サイレントに成功扱いにせず検知できる（ログ＋失敗を握りつぶさない）。
- AC3: 次回フォームを開いた際、プルダウンに当該業者が（同端末・別端末いずれでも）表示される。
- AC4: 既存の現場名・元請け業者名の登録挙動も同様に堅牢化される（同じ fire-and-forget 経路のため巻き込み是正）。

---

## 3. 確定したい仕様（★承認ポイント）

下記2点の方針を承認いただきたい（推奨案を提示）。

- **方針A（推奨）: フォーム表示時は最新一覧を保証する**
  `report.vue` 新規パスのマウント取得を `master.fetch(true)` に変更（編集パスと統一）。コストは1回の軽量クエリ（現状 sido で35行）。Supuabase 失敗時は GAS（同じく Supabase 読み）にフォールバックするため鮮度は維持。
  - 代替: キャッシュ優先のまま（即描画）にして、`fetch()` のバックグラウンド更新失敗時に古い一覧で固定されないよう改修。→ 体感は速いが「確実に」を保証しづらい。**非推奨**。

- **方針B（推奨）: 提出時のマスタ保存を await し、失敗を検知する**
  `useReport.ts` ③ で `saveSite/saveContractor/saveSub` を `await Promise.allSettled([...])` で待機。失敗があれば `console.error` ＋（任意）軽い通知。送信完了画面に進む前にマスタ upsert を解決する。
  - 通知の出し方（トースト表示 or ログのみ）は要確認。**推奨: まずはログのみ**（送信フロー自体は止めない）。

---

## 4. データモデル・スキーマ

### 4-1. 関連スキーマ（既存・**変更なし**）
```sql
-- supabase/migrations/20260509500000_add_master_tables.sql
create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);
-- 20260509900000_multitenancy_cleanup.sql: unique(name, account_id)
-- RLS: disabled
```
（sites / contractors / vehicles / workers も同型）

### 4-2. migration
- **追加・変更なし**。完全後方互換。

---

## 5. 実装方針（LIFF のみ）

### 5-1. `apps/liff/composables/useReport.ts`（③ 新規マスタ保存）
fire-and-forget をやめ、保存完了を待機して失敗を検知する。
```ts
// ── ③ 新規現場・新規下請けを Supabase に保存（送信前に確実化）──
const saves: Promise<void>[] = []
for (const site of payload.sites) {
  if (site.siteName)        saves.push(master.saveSite(site.siteName))
  if (site.contractorName)  saves.push(master.saveContractor(site.contractorName))
  for (const sub of site.subcontractors) {
    if (sub.subcontractorName && sub.subcontractorName !== '__other__') saves.push(master.saveSub(sub.subcontractorName))
  }
}
const results = await Promise.allSettled(saves)
const failed = results.filter(r => r.status === 'rejected')
if (failed.length) console.error('[Report] マスタ保存に失敗:', failed)
```
※ `saveSub` 等は現状 try/catch で内部握りつぶし→ rejected にならない。**握りつぶしを解消**し（下記 5-2）、呼び出し側で検知する。

### 5-2. `apps/liff/composables/useMaster.ts`（saveSub / saveSite / saveContractor）
upsert エラーを握りつぶさず、`error` を throw（または呼び出し側へ伝播）する。ローカル state/cache 追加は upsert 成功後のみ。
```ts
async function saveSub(name: string) {
  if (!name.trim()) return
  const supabase  = useSupabase()
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) throw new Error('account not found') // 念のためのガード
  const { error } = await supabase
    .from('subcontractors')
    .upsert({ name: name.trim(), account_id: accountId }, { onConflict: 'name,account_id' })
  if (error) throw error
  if (!master.value.subcontractors.includes(name.trim())) {
    master.value = { ...master.value, subcontractors: [...master.value.subcontractors, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
    saveCache(master.value)
  }
}
```
（saveSite / saveContractor も同様）

### 5-3. `apps/liff/pages/report.vue`（マウント取得）
新規パスのマスタ取得を強制最新化に統一。
```ts
// 818行目付近
const masterPromise = master.fetch(true)   // 旧: master.fetch()
```
（編集パス 1209 は既に `fetch(true)`。整合する）

### 5-4. edge functions / admin / GAS
- **変更なし**。

---

## 6. AC→E2Eテストケース

`tests/e2e/liff.report.spec.ts`（liff project, dev モード）に追加。

- **新規 spec: 下請業者を新規登録→再訪でプルダウンに出る**
  1. `/report` を開きフォーム表示。
  2. 現場を選択（既存 spec 同様 `テスト現場A`）。
  3. 下請の `select` で `__other__`（その他）を選び、`業者名を入力` に一意名（例: `E2E下請_<タイムスタンプ的に固定可能な値>`)を入力。
     - dev モードは seed の test account。一意性は固定文字列＋既存重複回避（upsert なので再実行耐性あり）。
  4. 送信 → 完了画面。
  5. 再度 `/report`（リロード）→ 下請 `select` の option に当該業者名が含まれることを assert（`master.fetch(true)` により DB から再取得される）。
- **回帰**: 既存「日報入力→送信→完了画面」「編集モードで未送信バナーを出さない」が green のまま。

注: E2E はローカル（admin:3001 自動 / liff:3000 手動起動）。`npm run test:e2e` の liff project で実行し全 green を確認する。

---

## 7. デプロイ順序・後方互換性

- 順序: フロントのみ（DB→functions 不要）。`dev` 統合 → `/ship` で `main` マージ → Vercel(liff) 本番デプロイ。
- 後方互換: DB 変更なし。挙動変更は「保存を待つ」「フォーム表示時に最新取得」のみ。既存データ・既存フローに破壊的影響なし。
- ロールバック: フロントのみのためコミット revert で即時復旧可能。

---

## 8. 影響範囲

- `apps/liff/composables/useReport.ts`（保存待機・失敗検知）
- `apps/liff/composables/useMaster.ts`（saveSub/saveSite/saveContractor の握りつぶし解消）
- `apps/liff/pages/report.vue`（新規パスの `fetch(true)`）
- `tests/e2e/liff.report.spec.ts`（E2E 追加）

## 9. 残課題・将来検討（今回スコープ外）

- マスタ一覧の 30分キャッシュ戦略の見直し（リアルタイム性 vs 体感速度）。
- 保存失敗時のユーザー通知（トースト）UX。
- 「香田」二重・誤登録データのクリーンアップ要否（今回は不要・データ正常）。
