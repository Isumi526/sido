
sidoの本番反映を、各本番操作の承認を取りながら進めるエージェント。

本番反映は **PR経由**。Merge は **人がタイミングを明示承認した時のみ** CCが `gh pr merge` で実行する（＝本番承認ゲート）。
CC は PR作成・承認後の migration適用 / Merge / functions deploy / スモークを行う（各操作ごとに人の承認）。
品質担保は **ローカルE2E全green＋Merge後の本番スモーク（ハードリロード必須）**（dev は Vercel preview 無効のため preview URL は使わない／案内しない）。

**承認を人に求める時は CLAUDE.md「人ボール報告の必須フォーマット（結論ファースト）」に従う**：画面は「🙋 [ship承認] PRタイトル／【決めてほしいこと】（例: 今Mergeしていいか）／【選択肢】A.今やる B.後で／【推奨】…」の構造で結論を先頭に。`--detail` は「何を待つか＋人がやる具体アクション」を1〜2行に圧縮（下記の各通知例は既にこの粒度）。

バックログDB: https://www.notion.so/6e7dd24739dd431688564b12f64d8ebd?v=3760ff81c56b8185a056000cd43639bb&source=copy_link

# 前提

- main = 本番(Vercel自動デプロイ)、dev = 同期用。本番Supabase ref = nrzzesbtvswoiouhldvi。
- 本番反映は dev → PR → main。**CCは main へ直接 push しない**。Merge は人がタイミングを明示承認した時だけ CCが `gh pr merge` で行う（main保護＝gh認証経由・人承認前提）。
- dev は Vercel preview 無効（`vercel.json` の `git.deploymentEnabled.dev=false`）→ 有効な preview URL は出ない。品質担保は **ローカルE2E全green＋本番スモーク**。
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
     - **追加のみ** → 手順5で人の承認後にCCが psql で適用できる（後述）。
     - **破壊的を含む** → CCは適用しない。本番DBのバックアップ取得済みかを確認（★）し、未取得なら促して停止。人手のSQLエディタ実行＋事前バックアップを依頼する。
       - **停止する直前に LINE 通知（best-effort・失敗無視）**：
         `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "破壊的migrationあり。事前バックアップのうえSQLエディタで手動実行して" [--url "<セッションurl>"]`
   - **該当なし**：後続のPR本文に「migration: なし」と明記する。
   - これにより「migration適用漏れ」を Merge 前に人が必ず認識できる状態にする。

2.5 RLS/anon 監査ゲート（決定的・機械的／LLMレビューの二重化・読み取りのみ・自動）:
   - 独立AIレビュー（手順4.5）の RLS/anon 観点を **LLM非依存の機械監査** で二重化する。判定源は **`.kody/accepted.yml`（手順4.5 と共有）**。
   - **migration適用済の状態**（ローカル/shadow＝本番反映後と同一スキーマ）に対し実行：
     `node scripts/rls-audit.mjs --assert`（必要なら `--prod-readonly` で本番を読取専用監査＝SELECTのみ・書込なし）。
   - 判定：**allowlist外で「anon到達可 × RLS無効」= 🔴LEAK** が1件でもあれば `--assert` は非ゼロ終了。
   - **🔴LEAK あり → HALT**（本番反映に進まない）。違反テーブル一覧を提示し、停止直前に LINE 通知：
     `node scripts/notify-humanball.mjs --kind ship-blocked --task "<PRタイトル>" --detail "RLS監査で🔴LEAK N件(anon×RLS無効)。RLS有効化 or .kody/accepted.yml に追跡追記で再実行を" [--url "<セッションurl>"]`
     - 人間が「RLS有効化migration追加」または「accepted.yml にベースライン/追跡を追記」したら、この手順から再実行（再監査→0件で続行）。
   - **🔴LEAK 0 → 続行**。📋に監査サマリ（public表数・LEAK/warn/allowlist件数・verdict）を載せる。
   - これにより「Gemini が RLS露出を見落としても、機械監査が必ず止める」＝レビュー漏れの本番流入を二重に防ぐ。

3. PR作成（CCが自動）:
   - PR作成（本文に **migration有無**＝手順2の結果を必ず含める）：
     ```
     gh pr create --base main --head dev \
       --title "release: <本番反映する内容の要約>" \
       --body "<反映タスク一覧（Notion）／migration有無（あり=⚠️セクション/なし=明記）／後方互換性／スモーク観点>"
     ```
   - 作成後、PRのURLを表示する。

4. 品質担保（ローカルE2E全green・自動／preview は使わない）:
   - dev は Vercel preview 無効で **有効な preview URL は出ない** → preview 確認はしない・案内しない。
   - 代わりに **ローカルE2Eを全green** で品質担保する：`npm run test:e2e` を実行し、
     `tests/e2e/*.spec.ts`（`ls tests/e2e/*.spec.ts` で実体を列挙）の対象が全て green であることを確認する。
     - 今回の反映に関係する spec（admin系/liff系）は特に green を明示。1つでも fail なら停止して報告（本番反映に進まない）。
   - 残りの最終確認は **Merge後の本番スモーク（ハードリロード必須）**（手順8）で担保する。ここでは止まらない（自動）。

4.5 独立AIレビュー ゲート（本番反映の直前・自動）:
   - **本番に乗る差分**に対し独立レビュー（Claude非依存のGemini・temperature=0）を **2〜3回 union 実行**：
     `node scripts/independent-review.mjs --json --runs 3 "origin/main...origin/dev"`（JSONで `verdict` / `riskClass` / `accepted` を受ける）。
     - **どれか1回でも未acceptの critical/🔴 が出たら union に残り verdict=block**（非決定性に対し保守的＝prodゲートはfalse-negativeを避ける）。temperature=0＋N回unionで再現性を担保。
   - **verdict=block（＝未acceptの critical/🔴 が1件以上）→ HALT**：本番反映に進まない。findings を提示し、停止直前に LINE 通知して人間の対応（修正 or `.kody/accepted.yml` 追記）を待つ：
     `node scripts/notify-humanball.mjs --kind ship-blocked --task "<PRタイトル>" --detail "独立レビュー verdict=block（未accept🔴N件）。修正 or .kody/accepted.yml 追記で再実行を" [--url "<セッションurl>"]`
     - 人間が修正/accept追記したら、この手順から再実行（再度 review→verdict確認）。block の間は手順5以降に進まない。
   - **verdict=pass → 続行可（ただし本番反映は人間の1タップ confirm 後）**：停止直前に LINE 通知で要約提示し、明示confirmを待つ：
     `node scripts/notify-humanball.mjs --kind ship-ready --task "<PRタイトル>" --detail "独立レビュー verdict=pass / risk=<high|low> / accepted=[<rule:target>…]。確認後OKで本番反映へ" [--url "<セッションurl>"]`
     - **riskClass=high**（migrations/EF/`verify_jwt`/財務系/外部anon導線 に触れる 等）の時は特に、人間が中身を確認してから confirm する旨を明示。
     - 人間の明示confirm（「OK」「進めて」等）を得てから 手順5（migration適用）以降へ進む。confirm 前は prod-apply しない。
   - `accepted=[…]` は `.kody/accepted.yml` で追跡中の既知事項（block除外）。新たな未accept🔴が出たらここで必ず止まる＝レビュー漏れの本番流入を防ぐ。

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

6. ★本番承認ゲート（Mergeタイミング承認制・CC実行可）:
   - **Merge＝Vercel本番デプロイ自動実行**。本番影響が出るので、**人が「今Mergeして」等、本番を確認できるタイミングを明示した時だけ** CCが実行する。
   - タイミング待ちで停止する直前に LINE 通知（best-effort・失敗無視）:
     `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "<PR URL> Mergeタイミング待ち。本番を見れる時に「今Mergeして」で実行する" [--url "<セッションurl>"]`
   - 人がタイミングを明示しない限り **CCはMergeせず待機**（勝手にMergeしない）。
   - 人が「今Mergeして」等と返したら、CCが実行：`gh pr merge <PR番号> --merge`（main保護はgh認証＝人承認が前提）。

7. Merge完了後、main最新を取り込み（`git fetch origin main`）、残りの本番操作（各★承認）:
   - **各★承認で停止する直前に LINE 通知（best-effort・失敗無視）**。同じ停止で複数承認をまとめて聞く場合は通知も1回にまとめる（連投しない）。
   - edge functions deploy が要る場合 → ★承認 → 本番refへ 1つずつ deploy。停止直前に：
     `node scripts/notify-humanball.mjs --kind ship承認 --task "<PRタイトル>" --detail "functions deploy承認待ち。N個のfunction(<名前>)を本番refへdeploy" [--url "<セッションurl>"]`

8. スモーク（自動・本番URL）: テストアカウントで主要動線（日報・通知・配信反映など）を確認し報告。
   - **必ずハードリロード**（キャッシュ無効・Cmd/Ctrl+Shift+R 相当）で確認する。Vercelデプロイ直後は旧バンドルがキャッシュされ、ハードリロードしないと反映前の画面を見て誤判定する。
   - 異常があれば即停止して報告。
   - 異常なければ：対象の本番待ちタスクのNotionステータスを「完了」に更新（完了日も入れる）。
   - 更新履歴に追記（管理画面トップ）: 反映内容ごとに
     `node scripts/add-dev-update.mjs "<1行要約>" "<該当ページlink>"` を実行（link は admin内パス等、無ければ省略）。
     反映タスク1件につき1行を基本に、粒度は荒くてOK。

9. 自走再開（スモーク異常なし & 人ボール残なし & Notion完了 & 更新履歴追記まで終わったら）:
   - 本番反映が完了しスモーク異常が無ければ、**続けて /run のループに入り、次のdev作業を自走再開する**。
   - 異常があった場合・人ボール待ちが残る場合はここで停止して報告（/run には入らない）。

厳守:

- **main へ直接 push しない**。Merge は **人がタイミングを明示承認した時のみ** CCが `gh pr merge` で実行（タイミング未指定なら待機）。
- migration適用 / Merge / functions deploy は必ず人の承認を取る。承認なしに実行しない。
- **migration適用は「追加のみDDL」に限る。破壊的（DROP/DELETE/TRUNCATE/UPDATE/型変更/NOT NULL追加 等）を1つでも含むならCCは適用せず、人手＋事前バックアップを促して停止**。
- migration適用は Merge（＝Vercel本番デプロイ）より前に行う。
- preview は使わない（dev preview 無効）。品質担保はローカルE2E全green＋本番スモーク（**ハードリロード必須**）。
- supabase db push は絶対にしない。`SUPABASE_PROD_DB_URL` の値はログ/チャットに残さない。
- **停止＝LINE通知（例外なし）**：人の入力・操作・承認待ちで止まる時は直前に必ず notify-humanball.mjs（best-effort）。「対話中だから」を理由にスキップしない（見られているか判断できないため常に通知）。1停止で複数承認をまとめる時のみ通知1回。
- **独立AIレビュー（手順4.5）で verdict=block（未acceptの🔴）の間は、本番反映に進まない**。pass でも本番反映は人間の1タップ confirm 後。通知 kind は `ship-blocked` / `ship-ready`（Mergeタイミング承認の `ship承認` とは別文面で混線させない）。
- スモークで異常があれば即停止して報告。
- .env はコミットしない。
