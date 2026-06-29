# プロジェクト 引き継ぎ & 運用ルール

## プロジェクト概要
内装施工会社向け 施工台帳自動化システム

## リポジトリ構成
```
/
├── apps/
│   ├── liff/          # LINE LIFF 日報入力フォーム（Nuxt3 / Vercel）
│   └── admin/         # 管理画面（Vite + Vue3 / Vercel）
├── packages/
├── supabase/
└── CLAUDE.md
```

## 技術スタック
- フロントエンド: Nuxt3 + Vue3 + TypeScript / Vercel
- 認証: LINE LIFF SDK
- バックエンド: Google Apps Script (GAS) / clasp管理
- DB: Supabase

## GAS開発フロー
```bash
cd apps/gas && clasp push
# デプロイはGASエディタで新バージョン作成
```

## ローカル開発フロー

```bash
# LIFF
cd apps/liff && npm run dev
# → http://localhost:3000 で確認（LIFF認証スキップ・テスターユーザーで動作）

# 管理画面
cd apps/admin && npm run dev
```

### ブランチ運用（A+運用：main一本デプロイ + dev はPC間同期用）

- **テストはローカル**（`npm run dev`）で行う。Preview URL は使わない。
- **`main` に push したときだけ** Vercel 本番デプロイが走る。
- **`dev` は「PC跨ぎの作業途中を同期する場所」**。Vercel のデプロイは無効化済み
  （各アプリの `vercel.json` に `git.deploymentEnabled.dev = false`）なので、
  dev に何回 push してもビルドは走らない＝本番に一切影響しない。

```bash
# ── 普段の開発（1台で完結する場合）──
# ローカルで編集・確認 → 完成したら main に直接 push
git add -A && git commit -m "..."
git push origin main          # ← ここで本番デプロイ1本だけ走る

# ── PCを跨いで作業途中を持ち越す場合 ──
# PC-A: 作業途中を dev に退避（デプロイ走らない）
git checkout dev && git merge main   # or 直接 dev で作業
git push origin dev
# PC-B: 続きを取得
git checkout dev && git pull origin dev
# 完成したら main にマージして本番へ
git checkout main && git merge dev
git push origin main          # ← ここで初めて本番デプロイ
```

※ Vercel は Hobby プランで同時ビルド1本。短時間に何度も push するとキューが詰まる
　ことがあるので「まとめて1回 push」が安全。

### 作業を巻き戻したい場合
```bash
# main を戻したいコミットに巻き戻し（事前に git log でハッシュ確認）
git checkout main
git reset --hard <戻したいコミットハッシュ>
git push origin main --force
```

## Phase別ロードマップ
- Phase 1 ✅ LINE日報→GAS自動転記・Gemini正規化・各種機能
- Phase 1.5 ✅ LINE LIFFフォーム（Nuxt3）・LIFF→GAS連携・Supabase・管理画面
- Phase 2 予定: 月次集計レポート・経費PDF自動生成
- Phase 3 予定: 複数テナント展開

## Pipeline設定（/run・/review・/ship harness 用・cc-pipeline 正本の `{{...}}` 解決元）
`.claude/commands/run.md`・`review.md`・`ship.md`（cc-pipeline 正本のコピー）の `{{...}}` はここと `.env` から解決する。
| キー | 実値 | 備考 |
|---|---|---|
| **APP_LAYOUT** | npm workspaces モノレポ | `apps/admin`(Vite/Vue・`vite --port 3001`) / `apps/liff`(Nuxt) / `apps/gas`(Google Apps Script・clasp) |
| **TYPECHECK** | `npm run typecheck`（=`--workspaces --if-present`） | |
| **BUILD** | `npm run build --workspaces --if-present` | admin=`vite build` / liff=`nuxt build` |
| **TEST** | `npm run test:e2e`（Playwright） | |
| **PLAYWRIGHT_PROJECTS** | `admin` / `liff` | `playwright.config.ts`（root） |
| **LOCAL_STACK** | supabase（標準 API 54321 / DB 54322 / Studio 54323） | `supabase start`。`LOCAL_DB_URL` は既定54322で不要 |
| **MIGRATIONS_DIR** | `supabase/migrations` | RLS は `account_id` 論理分離。anon公開キー前提の pre-RLS ベースラインあり（`.kody/accepted.yml` で追跡） |
| **DEPLOY_PLATFORM** | Vercel（admin/liff）＋ Supabase edge functions ＋ GAS(clasp) | |
| **DEPLOY_TRIGGER** | `auto-on-merge` | `main` Merge ＝ Vercel 自動デプロイ。edge functions / GAS は別途反映（ship 手順7 の edge deploy 該当） |
| **DEV_URL** | `http://localhost:3001`（admin） | liff は Nuxt dev |
| **PROD_BRANCH** | `main`／AUTO_MERGE_TARGET=`dev`／AUTO_TIER=`低`／MAX_WALL=`180` | |
| **本番 Supabase ref** | `nrzzesbtvswoiouhldvi` | 誤接続ガード／`--prod-readonly` 監査用 |
| **PROD_URL** | ⚠️**要確認**（sido 本番URL未記入） | ship 手順8スモークで使用。判明したらここに記入 |

### APP_LAYOUT_NOTES（/review が参照）
- 構成: `apps/admin`(管理画面・ブラウザ {{DEV_URL}}) ＋ `apps/liff`(Nuxt・LINEミニアプリ)。UI/ロジックは原則ブラウザ。**LINEアプリ内固有（友だち追加・トーク内 LIFF 起動・Flex体裁）は `⚠実機確認`**。
- 画面パス例（admin）: 下請け管理／現場／日報／月次集計 ※実パスは apps ルーティングに合わせる。
- 外部送信媒体＝**LINE（liff・GAS webhook 経由）・メール**（実送信は自分宛・隔離）。
- 本番: DEPLOY_TRIGGER=`auto-on-merge`（Vercel）。**Supabase edge functions 使用＝ship 手順7 で本番ref へ deploy 該当**。`NOTIFY_PREFIX=[sido]`。スモークの認可ガード対象＝GAS/edge webhook・公開リンク等。

## 自走ポリシー（被害範囲で判断）
判断軸：可逆 & dev内 = 自走。不可逆 / 本番 / 業務意図 = 人。

### 自走OK（人に聞かない・報告のみ）
- 要件定義済みの設計・実装・テスト・E2E
- featureブランチ作成（dev基点）→ devマージまで自動
- Notionステータス/設計書/spec更新、Inbox grooming、残課題キャプチャ、リファクタ、migrationファイルの「作成」（適用はしない）

**ステータス遷移は「進行中」を必ず経由**：実装に着手する瞬間に Notion を「進行中」へ更新する（遷移＝**要件定義済み →(着手)→ 進行中 →(実装完了)→ 本番待ち**）。これにより Notion 上で『今 CC が実装中の1件』が一目で分かる。同時に「進行中」になるのは**原則1件**（1タスクずつ自走するため）。中断中の進行中タスクを再開する場合は既に「進行中」なのでそのまま。更新は Notion API（notion-update-page 相当）または既存スクリプトで行う。

**「🤖AI実行中」タグで“CCが実装中”を可視化**：ステータス「進行中」には人の手作業タスク（AI無関係）も混ざり得るため、CC が実装している間だけ バックログDBの「タグ」（複数選択）に **「🤖AI実行中」**（絵文字込み・完全一致）を付け、人の進行中と区別する。これで Notion の「🤖 AI実行中」ビューには各案件のCCが今まさに実装中のタスクだけが映る。運用ルール：
- **着手時に付与**（ステータスを「進行中」にするのと同時。**既存タグは保持して追加**）。
- **本番待ちに上げる／人ボール化してスキップする／中断する** いずれの時も**外す**。
- 原則、同時に付くのは**1件だけ**（1タスクずつ自走するため）。
- **/run 開始時**、自案件（`BACKLOG_PROJECT_ID`）でタグが付いたまま残っているものがあれば**全部外す**（前回クラッシュ等の取り残しを自己修復）。

タグ更新は Notion API（notion-update-page 相当）で「タグ」プロパティを**既存配列を保ったまま** 追加/削除する。

### 人ボールに回す（この2つだけ。Notionに記録し、そのタスクはスキップ。ループは止めない）
- (A) 意図が要る：業務ルール/要件が曖昧で人にしか決められない分岐 → 「要回答」（質問＋案）で記録
- (B) 本番反映 → /ship の承認

**人の手で止まる時は必ず LINE 通知を送る（原則）**：CC が処理を止めて **人の入力・操作・承認を待つ** 状態に入る時は、止まる直前に必ず `notify-humanball.mjs` で本人に LINE 通知する。対象は人ボール（要回答/要対応/ship承認）だけでなく、**ship フロー内の各承認ゲート**（本番DBバックアップ確認待ち・migration適用承認待ち・Mergeタイミング待ち・functions deploy承認待ち 等）も含む。
```bash
node scripts/notify-humanball.mjs --kind <要回答|要対応|ship承認> --task "<タスク名>" --detail "<質問+案や理由>" [--url "<Remote Controlのセッションurl>"]
```
- `--detail` には **「何を待っているか」＋「人がやるべき具体アクション」** を1行で含める（例：「本番migration適用待ち。SQLエディタで2件のSQLを実行して」）。
- この通知は **「本人への個人通知」** であり、hard-stop の「外部一斉送信」には当たらない（許可）。
- 通知は best-effort。失敗しても無視して処理を続け、停止状態の表示は通常どおり行う。URL未設定（webhook無効）なら何もせず終了する。
- **例外なし**：「ユーザーとアクティブに対話中だから」を理由に通知をスキップしてはならない。CCは自分が見られているか判断できないため、**停止する時は常に通知する**。
- **1回の停止で複数の承認をまとめて聞く場合のみ、通知も1回にまとめてよい**（連投しない）。

### 人ボール報告の必須フォーマット（結論ファースト）
人ボール（要回答/要対応/ship承認）を人に提示する時は、**長い経緯説明から始めず、結論を先頭に置く**。画面出力（CC）・LINE通知（`--detail`）の両方に適用。

画面出力（CC）は必ずこの構造で：
```
━━━━━━━━━
🙋 [種別] タスク名
【決めてほしいこと】（1行。何を判断すればいいか）
【選択肢】
  A. （短く）
  B. （短く）
  C. （あれば）
【推奨】X — 理由1行
━━━━━━━━━
（背景・詳細は必要な時のみ、上記の下に最小限で。長い経緯は書かない）
```

ルール：
- **結論（決めてほしいこと＋選択肢）を必ず最初に置く**。背景説明から始めない。
- 人が「Aで」「Bで」と **一語で答えられる** 状態にする。選択肢が自明に絞れない時だけ自由回答を求める。
- 選択肢は **2〜4個・各1行**。長い説明を選択肢に書かない。
- 推奨は **1行＋理由1行** まで。
- 複数の人ボールをまとめる時は、各々をこの構造で **番号付きで並べる**。だらだら散文で書かない。
- **LINE通知（`--detail`）は特に短く**：「タスク名／A・B・Cどれ？／推奨X」が一目で分かる **1〜2行に圧縮**（種別は `--kind` で渡る）。例：`--detail "通知先の既定値どうする？ A=全員 B=管理者のみ／推奨A(現行踏襲)"`

### /run の優先順位決定（常に「今この案件で最優先の1件」を特定して前進）
判定対象は **`.env` の `BACKLOG_PROJECT_ID`（自案件）で絞った範囲**のみ（`next-target.mjs` が案件で絞る）。以下を上から評価し、該当する最優先1件を実行する：
1. **中断中の 進行中 / レビュー待ち** があれば最優先で再開。
2. 次に **要件定義済み（Ready）** を優先順位順（緊急>高>中>低、同率は作成日古い順）で実行。
3. **Ready が空なら 未整理（Inbox）** を優先順位順で **1件ずつ** 見て内容を判定：
   - **(a) 意図・業務判断が必要**（要件/仕様が曖昧で人にしか決められない、**または本文が空/不足で要件化の材料が無い**）→ 人ボール「要回答」として記録し、**LINE通知（質問＋案を添える）**。実装はしない。
   - **(b) 情報十分で要件化できる**（ストーリー・AC・スコープを本文から起こせる）→ CCが要件化（ストーリー＋受け入れ条件＋スコープ）し、ステータスを **要件定義済みに更新してから実装まで自走**。
   - 未整理を **1件処理したら必ず 1 に戻る**（Ready が生まれるか、(a)で止まるか、未整理が尽きるまで繰り返す）。
4. **Ready も未整理も無い** → 本当に手が無いので停止して報告（**LINE通知**）。

**重要：「未着手（未整理）だから検知できない」状態をなくす。** /run は Ready が無くても未整理から拾って前進させる（要件化 or 人ボール）。停止するのは「本当に手が無い時」だけ。

### 絶対に自走NG（hard stop）
- 本番デプロイ自動化 / mainへの直接push / db push
- データ削除・スキーマ破壊 / 認証・権限・課金・外部一斉送信の変更
- **本番migration適用は条件付きでCC実行可**（hard-stopから緩和）：人の明示承認（「実行して」等）＋**追加のみDDL**（ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT 等の非破壊DDL）に限り、CCが `.env` の `SUPABASE_PROD_DB_URL` 経由で psql 適用してよい。**破壊的変更**（DROP / DELETE / TRUNCATE / UPDATE / カラム型変更 / NOT NULL追加 等、既存データを失う・壊す可能性）が1つでも含まれるなら、CCは実行せず人手のSQLエディタ実行＋事前バックアップを促して停止する。`SUPABASE_PROD_DB_URL` の値はログ/チャットに残さない。db push は引き続き禁止（個別SQL適用のみ）。
- **mainマージは条件付きでCC実行可**（hard-stopから緩和）：人が **本番を確認できるタイミングを明示承認**（「今Mergeして」等）した時のみ、CCが `gh pr merge` で実行してよい。人がタイミングを明示しない限りCCはMergeせず待機する（勝手にMergeしない）。main ブランチ保護は維持（gh認証経由＝人承認が前提）。直接 push / 本番デプロイの自動化は引き続き禁止。

### 報告（毎ユニット・非ブロック）
- 1ユニット終えるごとに1行サマリ（何をdevに/本番待ちに/人ボールに）。承認は求めない。

### ユーザー直接指示のチケット化（Notionを正本に）
/run 中や通常会話で **ユーザーが直接実装タスクを指示** した場合も、一定規模以上のものは Notion バックログを正本として記録し、ステータスを完了まで辿る（Notion で一貫管理し、AI実行中ビュー・全体ボードに反映するため）。

**チケット化する**（ユーザー直接指示のうち、以下）：
- 機能追加（新しい画面・機能・エンドポイント等）
- バグ修正（挙動の不具合を直すもの）
- その他、後から「何をやったか」を追えるようにすべき規模の変更

**チケット化しない**（口頭指示のまま実装してよい）：
- タイポ・文言・色・余白などの軽微な見た目修正
- 1〜数行の些細な調整、設定値の変更
- 調査・確認・質問への回答など、成果物が残らない作業
- 既存チケットの作業中に付随する細かい修正（そのチケット内で処理）

判断に迷う規模なら、**チケット化する側に倒す**（記録を残す方が安全）。

**タイミング**：実装前でも、実装しながら/完了後でもよい（CCが適宜判断）。ただし **完了時には必ず Notion に存在し、ステータスが「完了」または「本番待ち」になっている** 状態にする。

**手順**：
1. Notion バックログにタスクを作る：
   - 案件＝自案件（`BACKLOG_PROJECT_ID`）
   - エピックは内容に応じて設定、タグは「機能追加」or「バグ」等
   - タスク名＋ストーリー＋AC＋スコープを、ユーザーの指示から起こす
   - 仕様に意図確認が必要なら人ボール（要回答）で確認
2. 着手時：ステータス「進行中」＋「🤖AI実行中」タグ
3. 実装→ローカル検証→devマージ→「本番待ち」に更新（タグを外す）
4. /run の通常フローと同じ品質担保（E2E green・本番スモーク）に乗せる
