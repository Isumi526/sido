
sidoの本番反映を、各本番操作の承認を取りながら進めるエージェント。

本番反映は **PR経由**。main への merge は人が GitHub 上でクリックする（＝本番承認ゲート）。
CC は PR作成と、承認後の migration適用 / functions deploy / スモークだけを行う（1つずつ承認）。

バックログDB: https://www.notion.so/6e7dd24739dd431688564b12f64d8ebd?v=3760ff81c56b8185a056000cd43639bb&source=copy_link

# 前提

- main = 本番(Vercel自動デプロイ)、dev = 同期用。本番Supabase ref = nrzzesbtvswoiouhldvi。
- 本番反映は dev → PR → main。**CCは main へ push も merge もしない**（人のMergeクリックのみ）。
- supabase db push は絶対禁止。DB変更は正式なmigration（追加のみ・後方互換）でのみ。

# 手順

1. プリフライト（読み取りのみ・自動）:
   - git log --oneline main..dev で「本番に乗る差分」を一覧化。
   - 差分に DB migration / edge functions変更 / 破壊的変更 が含まれるか分類して提示。
   - 本番待ちのNotionタスクを一覧化し、今回どれが反映されるか対応づけ。
   - 後方互換か・ロールバック可能かのリスク要約を出して停止。

2. バックアップ確認（★承認）: 本番DBのバックアップ取得済みかを確認。未取得なら促して停止。
   （DBスキーマ変更が無い回は、直近バックアップで可かを確認して進めてよい。）

3. PR作成（CCが自動）:
   - dev を最新化： `git switch dev && git push origin dev`
   - PR作成：
     ```
     gh pr create --base main --head dev \
       --title "release: <本番反映する内容の要約>" \
       --body "<反映タスク一覧（Notion）／migration有無／後方互換性／スモーク観点>"
     ```
   - 作成後、PRのURLを表示する。

4. ★停止・人ボール（本番承認ゲート）:
   - 「このPRをGitHubでMergeしたら本番反映やで。マージOK？」と尋ねて待つ。
   - ※ /ship は main へのマージ操作はしない。Mergeは人がGitHub上でクリックする。

5. 人が「マージした」と返したら、main最新を取り込み（`git fetch origin main`）、本番操作を順に（各★承認）:
   - DB migration適用が要る場合 → 追加のみ・後方互換を再確認 → ★承認 → 1つずつ適用
     （db pushではなくmigration適用。不安が残るSQLは適用せず人に委ねる）。
   - edge functions deploy が要る場合 → ★承認 → 本番refへ 1つずつ deploy。
   - Vercel本番デプロイは main マージで自動的に走る（CCは触らない）。

6. スモーク（自動・本番URL）: テストアカウントで主要動線（日報・通知・配信反映など）を確認し報告。
   - 異常があれば即停止して報告。
   - 異常なければ：対象の本番待ちタスクのNotionステータスを「完了」に更新（完了日も入れる）。
   - 更新履歴に追記（管理画面トップ）: 反映内容ごとに
     `node scripts/add-dev-update.mjs "<1行要約>" "<該当ページlink>"` を実行（link は admin内パス等、無ければ省略）。
     反映タスク1件につき1行を基本に、粒度は荒くてOK。

7. 自走再開（スモーク異常なし & Notion完了 & 更新履歴追記まで終わったら）:
   - 本番反映が完了しスモーク異常が無ければ、**続けて /run のループに入り、次のdev作業を自走再開する**。
   - 異常があった場合・人ボール待ちが残る場合はここで停止して報告（/run には入らない）。

厳守:

- **main へは push も merge もしない**（人のMergeクリックのみ）。CCはPR作成と、承認後の migration / functions / スモークだけ。
- migration適用・functions deploy は必ず1つずつ承認を取る。承認なしに実行しない。
- supabase db push は絶対にしない。
- スモークで異常があれば即停止して報告。
- .env はコミットしない。
