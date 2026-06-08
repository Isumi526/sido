
sidoの本番反映を、各本番操作の承認を取りながら進めるエージェント。

本番反映は **PR経由**。main への merge は人が GitHub 上でクリックする（＝本番承認ゲート）。
CC は PR作成と、承認後の migration適用 / functions deploy / スモークだけを行う（1つずつ承認）。

バックログDB: https://www.notion.so/6e7dd24739dd431688564b12f64d8ebd?v=3760ff81c56b8185a056000cd43639bb&source=copy_link

# 前提

- main = 本番(Vercel自動デプロイ)、dev = 同期用。本番Supabase ref = nrzzesbtvswoiouhldvi。
- 本番反映は dev → PR → main。**CCは main へ push も merge もしない**（人のMergeクリックのみ）。
- supabase db push は絶対禁止。DB変更は正式なmigration（追加のみ・後方互換）でのみ。
- **本番migration適用は、人の明示承認＋追加のみDDLに限りCCが psql で実行可**（`.env` の `SUPABASE_PROD_DB_URL`。値はログ/チャットに残さない）。破壊的を1つでも含むなら人手のSQLエディタ実行＋事前バックアップ（CCは実行しない）。適用は **Merge＝Vercel本番デプロイより前** に行う。

# 手順

1. プリフライト（読み取りのみ・自動／git状態・dev最新化）:
   - git log --oneline main..dev で「本番に乗る差分」を一覧化。
   - 差分に DB migration / edge functions変更 / 破壊的変更 が含まれるか分類して提示。
   - 本番待ちのNotionタスクを一覧化し、今回どれが反映されるか対応づけ。
   - 後方互換か・ロールバック可能かのリスク要約を出す。
   - dev を最新化： `git switch dev && git push origin dev`。

2. migrationチェック（事前検知①・読み取りのみ・自動）:
   - 今回 dev→main で入る差分に DB migration が含まれるか機械的に確認：
     `git diff --name-only origin/main...dev` で `supabase/migrations/` 配下の
     新規/変更ファイルを列挙する。
   - **該当あり**：後続のPR本文に「## ⚠️ migration あり」セクションを作り、
     ファイル名・概要・後方互換性（追加のみか／破壊的か）・本番適用要否を明記する。
     - **「追加のみ」か「破壊的を含む」かを機械的に判定して人に提示**する：
       - 追加のみ＝ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT 等の非破壊DDLのみ。
       - 破壊的＝DROP / DELETE / TRUNCATE / UPDATE / カラム型変更（ALTER ... TYPE）/ NOT NULL追加 等、既存データを失う・壊す可能性が1つでもある。
     - **追加のみ** → 手順6で人の承認後にCCが psql で適用できる（後述）。
     - **破壊的を含む** → CCは適用しない。本番DBのバックアップ取得済みかを確認（★）し、未取得なら促して停止。人手のSQLエディタ実行＋事前バックアップを依頼する。
       - **停止する直前に LINE 通知（best-effort・失敗無視）**：
         `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "破壊的migrationあり。事前バックアップのうえSQLエディタで手動実行して" [--url "<セッションurl>"]`
   - **該当なし**：後続のPR本文に「migration: なし」と明記する。
   - これにより「migration適用漏れ」を Merge 前に人が必ず認識できる状態にする。

3. PR作成（CCが自動）:
   - PR作成（本文に **migration有無**＝手順2の結果を必ず含める）：
     ```
     gh pr create --base main --head dev \
       --title "release: <本番反映する内容の要約>" \
       --body "<反映タスク一覧（Notion）／migration有無（あり=⚠️セクション/なし=明記）／後方互換性／スモーク観点>"
     ```
   - 作成後、PRのURLを表示する。

4. ★Vercel preview 確認依頼（事前検知②・停止・人ボール）:
   - PRに紐づく Vercel preview デプロイ（admin / liff **両方**）の URL を案内する。
     - 取得できない場合は「GitHubのPR画面 or Vercelダッシュボードで preview URL を確認して」と促す。
   - 人に対して、本番に出す前に preview URL 上で最低限これを確認するよう明示的に依頼して停止する：
     1. 今回反映する機能が preview 上で意図どおり動くか
     2. 主要画面（ログイン／一覧／今回の対象画面）が壊れてないか
     3. migration が絡む場合、preview が本番想定のスキーマ前提で動くか
   - **停止する直前に LINE 通知（best-effort・失敗無視）**：
     `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "preview確認待ち。admin/liffのpreview URLで動作確認して" [--url "<セッションurl>"]`
   - ※ /ship は main へのマージ操作はしない。Mergeは人がGitHub上でクリックする。

5. ★本番migration適用（追加のみ／Mergeより前・順序の罠回避）:
   - **重要：Merge＝Vercel本番デプロイ自動実行なので、migration は Merge より前に適用する**（新フロントが未適用スキーマを叩く事故を防ぐ）。
   - **追加のみDDLの場合のみ**、CCが適用してよい（破壊的を含むなら手順2で人手＋バックアップ依頼済み・ここはスキップ）：
     1. 適用承認の停止直前に LINE 通知（best-effort・失敗無視）:
        `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "本番migration適用待ち。追加のみN件、承認(「実行して」)で psql 適用する" [--url "<セッションurl>"]`
     2. 人が「実行して」等で明示承認したら、CCが `origin/main..dev` 差分の未適用 `supabase/migrations/` ファイルを **内容そのまま** 1つずつ psql で適用：
        `psql "$SUPABASE_PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql`
        - 接続URLは `.env` の `SUPABASE_PROD_DB_URL` を使う。**値はログ/チャットに出さない**（コマンドに直接書かず環境変数参照）。db push は使わない（個別SQL適用のみ）。
        - 追加のみ（ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT 等）であることを適用直前に再確認。破壊的が混ざっていたら中止して人へ。
     3. 適用後、**本番REST**で対象の列・テーブルの存在を検証してから次へ進む（例：`?select=<新列>&limit=0` が200か）。異常なら停止して報告。

6. ★本番承認ゲート（Mergeクリック・人ボール）:
   - PRの Merge クリック待ちで停止する直前に、本人に LINE 通知を送る（best-effort・失敗無視）:
     `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "<PR URL> のMergeクリック待ち" [--url "<セッションurl>"]`
   - 人が「preview で確認OK。Merge してええ」等と返したら、初めて本番反映へ進む。
   - Merge は人が GitHub 上でクリックする（CCはクリックしない）。Merge で Vercel本番デプロイが自動的に走る（CCは触らない）。

7. 人が「マージした」と返したら、main最新を取り込み（`git fetch origin main`）、残りの本番操作（各★承認）:
   - **各★承認で停止する直前に LINE 通知（best-effort・失敗無視）**。同じ停止で複数承認をまとめて聞く場合は通知も1回にまとめる（連投しない）。
   - edge functions deploy が要る場合 → ★承認 → 本番refへ 1つずつ deploy。停止直前に：
     `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "functions deploy承認待ち。N個のfunction(<名前>)を本番refへdeploy" [--url "<セッションurl>"]`

8. スモーク（自動・本番URL）: テストアカウントで主要動線（日報・通知・配信反映など）を確認し報告。
   - 異常があれば即停止して報告。
   - 異常なければ：対象の本番待ちタスクのNotionステータスを「完了」に更新（完了日も入れる）。
   - 更新履歴に追記（管理画面トップ）: 反映内容ごとに
     `node scripts/add-dev-update.mjs "<1行要約>" "<該当ページlink>"` を実行（link は admin内パス等、無ければ省略）。
     反映タスク1件につき1行を基本に、粒度は荒くてOK。

9. 自走再開（スモーク異常なし & 人ボール残なし & Notion完了 & 更新履歴追記まで終わったら）:
   - 本番反映が完了しスモーク異常が無ければ、**続けて /run のループに入り、次のdev作業を自走再開する**。
   - 異常があった場合・人ボール待ちが残る場合はここで停止して報告（/run には入らない）。

厳守:

- **main へは push も merge もしない**（人のMergeクリックのみ）。CCはPR作成と、承認後の migration適用（追加のみ）/ functions deploy / スモークだけ。
- migration適用・functions deploy は必ず1つずつ承認を取る。承認なしに実行しない。
- **migration適用は「追加のみDDL」に限る。破壊的（DROP/DELETE/TRUNCATE/UPDATE/型変更/NOT NULL追加 等）を1つでも含むならCCは適用せず、人手＋事前バックアップを促して停止**。
- migration適用は Merge（＝Vercel本番デプロイ）より前に行う。
- supabase db push は絶対にしない。`SUPABASE_PROD_DB_URL` の値はログ/チャットに残さない。
- スモークで異常があれば即停止して報告。
- .env はコミットしない。
