# 詳細設計書: 管理画面の日報カードに出退勤時刻を並行して表示する

- **タスク**: 管理画面 > 日報カードに出退勤時刻を並行して表示する
- **Notion**: https://app.notion.com/p/3710ff81c56b800d99c4fe1d6d8f1665
- **slug**: `attendance-on-report-card`
- **タグ**: 改善 / 優先順位: 中
- **作成日**: 2026-06-04

---

## 1. 背景・目的

出退勤打刻機能（`attendance_logs`）は実装済みで、管理画面の専用ページ
`apps/admin/src/pages/attendance.vue` で打刻ログ一覧を確認できる。
一方、日報一覧（`apps/admin/src/pages/reports.vue`）の日報カードには、各現場の
「日報上の稼働時間（手入力 startTime〜endTime）」は出るが、**実際の打刻（出退勤）時刻**は出ない。

管理者が日報カードを見る際、日報の自己申告時刻と並べて実打刻時刻を確認できるようにし、
申告と打刻の突き合わせ（早出・残業・打刻漏れの把握）を一目で行えるようにする。

## 2. ユーザーストーリー / 受け入れ条件(AC)

- US: 管理者として、日報カードの各現場に実際の出勤・退勤打刻時刻が並んで表示されることで、
  申告時刻と実打刻のズレや打刻漏れをページ遷移なしに確認したい。
- **AC1**: 日報カードの各現場行に、その現場の **出勤 HH:MM / 退勤 HH:MM**（実打刻）が表示される。
- **AC2**: その日・その作業員・その現場の打刻が無い場合、出勤/退勤は **`—`** で表示される（打刻漏れが一目で分かる）。
- **AC3**: 同一現場・同一日に複数の checkin/checkout がある場合、**最初の checkin** を出勤、**最後の checkout** を退勤として集約表示する。
- **AC4**: 打刻時刻は **JST（Asia/Tokyo）** で表示される（`checked_at` は timestamptz / UTC 格納のため明示変換）。
- **AC5**: 既存機能（日報一覧・モーダル詳細・LINE通知・削除・各管理画面ページ）に回帰がない（既存E2Eが全green）。

## 3. 確定した仕様（ユーザー確認済み）

- **表示粒度**: 「**現場ごと**に表示」。日報カード内の各現場行に、その現場の出退勤時刻を並べる。
- **打刻なし時**: 「**`—` を表示**」。出勤/退勤の枠は残し、欠損が分かるようにする。
- **対象範囲**: 「**表示(read)のみ**」。打刻の編集・修正は対象外（別タスク）。
  → **DB変更なし・edge function変更なし**。`attendance_logs` の RLS(UPDATE/DELETE禁止/SELECT全許可) も変更しない。

## 4. データモデル・突き合わせ方式

### 4-1. 関連スキーマ（既存・変更なし）

```
daily_reports(user_id → users.id, date(date), sites(jsonb), account_id)
users(id, worker_id → workers.id, account_id)
attendance_logs(worker_id → workers.id, site_id → sites.id, type 'checkin'|'checkout', checked_at timestamptz)
sites(id, name unique, account_id)
```

- `daily_reports.sites` JSONB の各現場は **`siteName`（文字列）のみ**を持ち、`sites.id` 参照は持たない
  （`apps/liff/types/index.ts:90-99`、選択肢は `sites.name` 由来）。
- `attendance_logs` は `site_id`(UUID) を持つ。
- → **突き合わせは「`attendance_logs.site_id` を `sites.name` に逆引き」して、日報現場の `siteName` と文字列一致**で行う（site_id 直結は不可）。

### 4-2. 突き合わせキー

各打刻ログを次のキーで集約する:

```
key = `${worker_id}|${JSTの日付(YYYY-MM-DD)}|${現場名}`
値  = { checkin: 最も早い checkin の HH:MM, checkout: 最も遅い checkout の HH:MM }
```

- `worker_id`: 日報側は `r.users.worker_id`（`reports.vue` の既存 select に含まれる）と一致。
- 日付: `checked_at` を **Asia/Tokyo** に変換した `YYYY-MM-DD` を `daily_reports.date` と突き合わせ。
- 現場名: `attendance_logs.site_id` → `sites.name`。日報側は `resolveSiteName(site)`（既存関数）で解決。
  - `siteName === '__other__'`（新規現場・自由入力）は master 現場名と一致しないため打刻に紐づかず `—` 表示（仕様上許容）。

### 4-3. account 隔離

`attendance_logs` には `account_id` が無いが、**取得を「画面に出ている日報の worker_id 集合」に限定（`.in('worker_id', workerIds)`）** することで、
当該アカウントの作業員の打刻のみに絞られる（`reports` は `account_id` でフィルタ済みのため）。
→ テナント越境の取得は発生しない。

### 4-4. migration

- **追加なし**。後方互換性: 影響なし（DBスキーマ非変更・read専用）。

## 5. 実装方針（`apps/admin/src/pages/reports.vue` のみ）

### 5-1. データ取得（`load()` 内に追記）

既存の `daily_reports` 取得・`mapped` 生成の後に、次を追加:

1. `workerIds = [...new Set(mapped.map(r => r.users?.worker_id).filter(Boolean))]`
2. `workerIds` が空でなければ 1クエリで打刻取得:
   ```ts
   const { data: logs } = await supabase
     .from('attendance_logs')
     .select('worker_id, type, checked_at, sites(name)')
     .in('worker_id', workerIds)
     .gte('checked_at', `${dateFrom.value}T00:00:00+09:00`)
     .lte('checked_at', `${dateTo.value}T23:59:59+09:00`)
     .order('checked_at', { ascending: true })
   ```
3. `attendanceMap`（`ref<Record<string, {checkin?: string; checkout?: string}>>`）を構築:
   - 各 log について `dateStr = jstDate(checked_at)`, `siteName = log.sites?.name`。
   - `key = ${log.worker_id}|${dateStr}|${siteName}`。
   - `type==='checkin'`: 既に checkin があれば**上書きしない**（最早を保持。order asc なので最初に来たものが最早）。
   - `type==='checkout'`: 常に**上書き**（最遅を保持）。
   - 時刻は `jstTime(checked_at)`（`HH:MM`）。
4. ヘルパー（`<script setup>` 内に追加）:
   ```ts
   const TZ = 'Asia/Tokyo'
   function jstDate(iso: string): string {
     // 'en-CA' で YYYY-MM-DD を得る
     return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
   }
   function jstTime(iso: string): string {
     return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
   }
   function attendanceFor(r: any, site: any) {
     const wid = r.users?.worker_id
     const name = resolveSiteName(site)
     if (!wid) return null
     return attendanceMap.value[`${wid}|${r.date}|${name}`] ?? null
   }
   ```

> 取得失敗時（`logs` が null）は `attendanceMap` を空のままにし、全現場 `—` 表示（フォールバック）。
> 既存の `load()` の挙動・日報一覧描画はこの追加に依存せず動く（疎結合）。

### 5-2. 表示（カードの現場行 `.site-row`）

`reports.vue` の `.site-row`（行33-40）に出退勤の1要素を追加:

```html
<span class="attendance" v-if="true">
  🟢 出勤 {{ attendanceFor(r, site)?.checkin ?? '—' }}
  / 退勤 {{ attendanceFor(r, site)?.checkout ?? '—' }}
</span>
```

- 既存の `🕒 {{ startTime }}〜{{ endTime }}`（日報の申告時刻）はそのまま残し、その隣に実打刻を並置する（"並行して表示"）。
- スタイル `.attendance`（`work-time` と区別できる控えめな色、`font-variant-numeric: tabular-nums`）を `<style scoped>` に追加。

### 5-3. モーダル詳細（`.site-block`）への併記（同一仕様で軽微追加）

詳細モーダルの各 `.site-block`（行83-）にも、現場ブロックタイトル直下に同じ
「出勤/退勤（実打刻）」の1行を追加し、カードと表示を一致させる。
（AC はカード基準だが、UX 一貫性のため同時対応。read のみで追加コスト小。）

### 5-4. edge functions / その他

- **変更なし**。`_shared` import・再デプロイ対象なし。LIFF 変更なし。

## 6. AC→E2Eテストケース

### 6-1. seed 追加（`supabase/seed.sql`）

ローカルスタックでの検証用に以下を追加（本番非対象）:

1. 既存のサンプル日報（Worker 01・`current_date`・現場「テスト現場A」）の `sites` に
   **「テスト現場B」**（打刻なし側）を 1 件追加 → 1枚のカードに「打刻あり/なし」両現場を同居。
2. `attendance_logs` に Worker 01 ×「テスト現場A」×`current_date` の打刻を 2 件 seed:
   - checkin: `(current_date + time '08:02') at time zone 'Asia/Tokyo'`
   - checkout: `(current_date + time '17:35') at time zone 'Asia/Tokyo'`
   - `agreed_rule_texts` は `'{}'`（空配列, not null 制約のため）。`worker_id`/`site_id` は Worker 01 / テスト現場A を join で解決。
   - 複数集約(AC3)確認用に checkin をもう1件（`08:10`）追加し、表示は最早 `08:02` になることを担保。

### 6-2. 新規 spec `tests/e2e/admin.attendance-on-card.spec.ts`（admin project, storageState）

- 事前: `/reports` を開き Worker 01 を選択（既存 smoke と同パターン）。
- **AC1/AC3/AC4**: テスト現場A の行に `出勤 08:02` と `退勤 17:35` が表示される
  （`.report-card` 内の `.site-row` で「テスト現場A」を含む行に `08:02` / `17:35`）。
- **AC2**: テスト現場B の行に `出勤 —` / `退勤 —` が表示される。
- **AC5(回帰)**: 既存 `admin.smoke.spec.ts` の `.report-card` 表示テストが green のまま。

### 6-3. 既存E2E

- 既存全 spec（admin/liff）をローカルスタックで実行し、新規＋既存が全 green になるまで修正。

## 7. デプロイ順序・後方互換性

- DB migration なし・edge functions 変更なし → **順序依存なし**。
- フロント（admin）1ファイル中心の追加表示。`attendance_logs` は read のみ。
- 後方互換性: **完全後方互換**（既存カラム・RLS 不変、取得失敗時は `—` フォールバック）。
- 本番デプロイは別ゲート（本タスクでは実施しない）。

## 8. 影響範囲

- **変更**: `apps/admin/src/pages/reports.vue`（取得ロジック＋カード/モーダル表示＋style）。
- **追加**: `supabase/seed.sql`（attendance seed・テスト現場B）、`tests/e2e/admin.attendance-on-card.spec.ts`。
- リスク: 低（read 専用・疎結合・フォールバックあり）。
  - 留意点: 現場名の文字列一致のため、`__other__`（自由入力新規現場）の打刻はカードに紐づかず `—` 表示（仕様上許容）。

## 9. 残課題・将来検討

- 出退勤の**編集・修正**（管理画面から）は別タスク（RLS UPDATE/DELETE 禁止のためポリシー変更が必要・スコープ大）。
- 日報JSONBに `siteId`(master参照) を持たせれば文字列一致依存を解消できる（将来のデータモデル改善）。
- 申告時刻と実打刻の乖離ハイライト（例: 30分以上のズレを色付け）は将来検討。
