# Storage バックアップ（ファイル実体の世代バックアップ）

## なぜ必要か
Supabase の Database Backups は **Storage オブジェクトの実体を含まない**
（ダッシュボードに `Storage objects are not included` と明記）。
つまり DB 行は PITR で戻せても、領収書画像・車検証・請求書PDF・履歴書添付・
日報/チャット添付・帳票PDF の **実体ファイルは誤削除/上書き/バケット事故から戻せない**。
これを埋めるのが `scripts/backup-storage.mjs` による世代バックアップ。

## 方式
Supabase 内で完結する **別バケット複製** を採る（外部サービス契約なし）。
全バケットのオブジェクトを、非公開バケット `backups` へ

```
backups/<YYYY-MM-DD>/<元バケット名>/<元のパス>
```

の形でコピーする。日付プレフィックスで世代が残り、誤削除・上書きから
その日付までさかのぼって復元できる。

> 補足: チケット当初案(a)の「バケットの object versioning 有効化」は、
> Supabase がトグル/API/migration として公開していないため採れない。
> よってリポで完結する方式(b)＝複製を採用している。

## セットアップ（1回だけ）
`backups` バケットは migration で作る（追加のみDDL・非公開・policy無し）。

- ファイル: `supabase/migrations/20260822080000_storage_backups_bucket.sql`
- 本番適用: 人の承認のうえ Supabase SQL Editor もしくは psql で適用する
  （このスクリプト自体はバケットを作らない。無ければ upload が失敗する）。

`backups` は **policy を一切持たない非公開バケット**。storage.objects は RLS 有効なので
policy が無い＝anon/authenticated は一切触れず、**service_role だけ**が読み書きできる。

## 実行

### ローカル
```bash
node --env-file=.env scripts/backup-storage.mjs --dry-run   # 対象確認（書かない）
node --env-file=.env scripts/backup-storage.mjs             # 実行
```
`.env` / `apps/admin/.env` の `VITE_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を使う。

### 本番
本番 URL と service_role キーを **その場で env 渡し** する。
service_role キーは全バケットを跨いで読み書きできるので
**コミット/ログ/チャット/シェル履歴に残さない**（`.env` に本番 service_role は置かない方針）。

```bash
SUPABASE_URL=https://nrzzesbtvswoiouhldvi.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=****** \
  node scripts/backup-storage.mjs --dry-run     # まず件数を確認

SUPABASE_URL=https://nrzzesbtvswoiouhldvi.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=****** \
  node scripts/backup-storage.mjs               # 本実行
```

service_role キーは Supabase ダッシュボード → Project Settings → API → `service_role` から取得。

### オプション
| フラグ | 意味 |
|---|---|
| `--dry-run` | 何もコピーせず対象だけ表示 |
| `--bucket <name>` | そのバケットだけ対象にする |
| `--date <YYYY-MM-DD>` | プレフィックス日付を上書き（既定は当日UTC） |
| `--restore` | 復元モード（下記） |

## 復元
指定日のスナップショットから元バケットへ **書き戻す**。
**upsert で現行ファイルを上書きする**ため、必ず `--dry-run` を先に、
可能なら `--bucket` で対象を絞ること。

```bash
# 何が戻るか確認（書かない）
node scripts/backup-storage.mjs --restore --date 2026-08-22 --dry-run

# 1バケットだけ戻す（推奨: 影響範囲を絞る）
node scripts/backup-storage.mjs --restore --date 2026-08-22 --bucket site-attachments

# 当該日の全バケットを戻す
node scripts/backup-storage.mjs --restore --date 2026-08-22
```
本番へ復元する時も、バックアップと同じく `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を env 渡しする。

## 定期実行（cron）
このリポでは cron 登録まではしていない（スクリプト作成のみ）。日次で回すなら例:

- **GitHub Actions**（推奨・鍵は Actions Secrets に置く）: 日次 schedule で
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を secret から渡して
  `node scripts/backup-storage.mjs` を実行。
- **手元/サーバの crontab**: 例 `0 3 * * * cd /path/to/sido && node scripts/backup-storage.mjs`
  （env はラッパースクリプトで安全に注入。平文で crontab に鍵を書かない）。

## 保持（世代の掃除）
日付プレフィックスで無限に溜まるため、保持ポリシーは別途決める
（例: 30日より古い `backups/<date>/` を削除するジョブ）。当スクリプトは削除を行わない
（誤って世代を消さないため、掃除は明示的な別ジョブに分ける）。

## 注意
- 二重容量課金: 複製方式ゆえ Storage 使用量がおおむね世代分 増える。保持で調整する。
- 大容量ファイルは download→upload でメモリに載る。極端に大きいファイルがある場合は要検討。
- 🔴 高リスク作業。初回・本番は必ず `--dry-run` で件数を確かめてから実行する。
