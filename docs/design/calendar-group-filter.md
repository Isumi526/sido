# 設計書: 予定管理カレンダーをグループで絞り込む

- Notion: 作業者がグループメンバーごとにカレンダー表示を絞り込むことができる（id 末尾 `c06aa82a`）
- エピック: 予定管理 / 優先順位: 高 / スコープ: **liff のみ・DB変更なし**

## 1. 背景・目的
LIFF>予定管理（カレンダー）は現状アカウント内の**全作業員を常に列表示**している。
作業者が「自分の所属グループのメンバーだけ」に絞って見られるようにする。

## 2. 受け入れ条件(AC)（要件確定後）
- AC1: カレンダー上部にグループ選択ドロップダウンがあり、初期値は「全員」（従来どおり全作業員表示）
- AC2: 自分が参加しているグループを選ぶと、そのグループのメンバー（作業員）の列だけ表示される
- AC3: 「全員」を選ぶと絞り込みが解除され全作業員に戻る
- AC4: 選んだグループは localStorage に記憶し、次回開いた時に復元される
- AC5: 選択肢は「自分が参加しているグループのみ」（`fetchMyGroups` 準拠。他人のグループは出さない）

## 3. 調査結果（接続経路）
- カレンダー: `apps/liff/pages/calendar/index.vue`。列＝`sortedWorkers`（`loadWorkers()` で account 内 active 作業員を全件）。
  予定は `useSchedules.fetchSchedules()` で account 内全件取得し、`cellSchedules(date, workerId)` で配置。
- グループ: `useScheduleGroups.fetchMyGroups()` が「自分が参加するグループ」をメンバー付き
  （`members[].worker_id`）で返す。グループメンバーは **worker_id** で紐付く。
- → **表示する作業員列を、選択グループの `members[].worker_id` に絞るだけ**で実現。予定取得も
  cellSchedules も変更不要（列が消えれば該当予定も非表示）。**DB変更・クエリ変更なし。**

## 4. 変更内容（liff `calendar/index.vue` のみ）
### 状態
- `const groups = useScheduleGroups()`、onMounted で `groups.fetchMyGroups()` を呼ぶ。
- `selectedGroupId = ref<string | null>(null)`（null = 全員）。
- localStorage 永続化: キー `app_cal_group_{accountSlug}_{lineUserId}`。
  - onMounted: 保存値を読み、現存グループに含まれていれば復元（無ければ全員にフォールバック）。
  - selectedGroupId 変更を watch して保存。

### 絞り込み
- `memberWorkerIds = computed`:
  - selectedGroupId が null → null（絞り込みなし）
  - else 選択グループの `members.map(m => m.worker_id)` の Set。グループが見つからない/メンバー空 → 全員に戻す。
- `sortedWorkers`（既存の「自分→ピン→五十音」ソート）の**手前で** memberWorkerIds によるフィルタを噛ませる:
  ```ts
  const visibleWorkers = computed(() =>
    memberWorkerIds.value ? workers.value.filter(w => memberWorkerIds.value.has(w.id)) : workers.value)
  // sortedWorkers は visibleWorkers を並べ替える形に変更
  ```

### UI
- カレンダー上部（既存のヘッダ/操作バー付近）に `<select>` を追加:
  - 先頭 option「全員」(value="") ＋ `groups.groups.value` を name で列挙。
  - 代理モードや削除済みトグル等の既存UIと並べる（`no-print` 等の既存クラス流儀に合わせる）。
- グループが0件のときはドロップダウン自体を出さない（常に全員）。

> 注: 「自分」が選択グループに含まれない場合も仕様通りメンバーのみ表示（自分を強制表示しない）。
> 代理モード時も挙動は同じ（表示の絞り込みのみ。データ取得は変えない）。

## 5. DB / functions
**なし**。LIFF フロントのみ・後方互換（既定は従来と同じ全員表示）。

## 6. AC → E2E（Playwright, liff）
`tests/e2e/liff.calendar-group.spec.ts` を新規:
- seed（global-setup）: dev-user の worker（Worker 01）が参加する `schedule_groups`＋`schedule_group_members` を1つ用意（メンバー= Worker 01 のみ）。
- E2E-1 (AC1): `/calendar` を開く→グループ選択 `select` があり初期は「全員」。複数の作業員列が見える。
- E2E-2 (AC2/AC3): グループを選ぶ→列が Worker 01 のみに減る。「全員」に戻す→列数が戻る。
- E2E-4 (AC4): グループ選択後リロード→選択が復元される（localStorage）。
- seed が難しい場合の縮退: 最低限「selectが存在し『全員』で全列表示」をリグレ確認＋手動確認を明記。

## 7. デプロイ順序・後方互換性
- liff フロントのみ。/ship は liff の Vercel デプロイ1本。DB/functions ゲートなし。既定全員表示で後方互換。
