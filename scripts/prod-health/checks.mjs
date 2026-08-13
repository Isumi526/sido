// ============================================================
//  scripts/prod-health/checks.mjs
//  本番ヘルスチェックの定義。runner(scripts/prod-health.mjs)がこの配列を回す。
//
//  ★なぜ「画面スモーク」ではなくここから作ったか（2026-08-13）
//   直近1ヶ月に本番で見つかった不具合は、どれも「画面は正常に開き、送信も成功する」ものだった。
//   牛田さんの日報が403で消えた件・「なんの修正か分からん」件・領収書の添付漏れ9件——
//   いずれも壊れたまま成功したように見えるので、ページを叩くだけの監視では1件も捕まらない。
//   捕まえられるのは「絶対に真であってはならないデータ条件」の定期監査だけ。
//
//  ★1件直したら1件足す。 事故を invariant に翻訳して置いていけば、
//   「同じ壊れ方が二度と起きない」ことが機械で保証される（＝修正が資産として積み上がる）。
//
//  ── チェックの書き方 ──
//   id       … 安定した識別子。baseline.json のキーになるので後から変えない
//   layer    … 1=不変条件 2=滞留 3=セキュリティ 4=本番スモーク（runnerが層で絞れる）
//   kind     … 'sql'（SQLを流す）/ 'probe','smoke'（async run() を呼ぶ・層3以降で使う）
//   severity … 'critical'=--assert で落とす / 'warn'=報告のみ
//   impact   … ★「違反すると業務に何が起きるか」を人の言葉で。通知にそのまま載る
//   origin   … 由来。実際に起きた事故を書く（なぜこの監査があるのか後任が分かるように）
//   sql      … key(安定ID) と detail(人が読む1行) の2列を返す SELECT。1行=1違反
//
//  ★sql は SELECT のみ。runner は read-only セッション（default_transaction_read_only=on）で
//   接続するので、書き込みを書いても物理的に落ちる。
// ============================================================

export const CHECKS = [
  // ────────────────────────────────────────────────
  //  層1: データ不変条件（絶対に真であってはならないこと）
  // ────────────────────────────────────────────────
  {
    id: 'dup-worker-auth',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '1つのログインに作業員が複数ぶら下がっている',
    impact: 'Edge Function が身元を特定できず、申請や編集が無言の403で消える。本人にも承認者にも何も出ない',
    origin: '2026-08-12 牛田さんの7/30日報が1週間承認待ちのまま消えていた件の真因',
    sql: `
      select w.account_id::text || ':' || w.auth_user_id::text as key,
             '作業員「' || string_agg(w.name, '」「' order by w.name) || '」が同じログインを共有' as detail
      from workers w
      where w.auth_user_id is not null
      group by w.account_id, w.auth_user_id
      having count(*) > 1`,
  },
  {
    id: 'pending-edit-empty-diff',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '編集申請の差分が空（何の修正か承認者に分からない）',
    impact: '承認は金額を確定させる操作なのに、中身が見えないまま承認ボタンを押させることになる',
    origin: '2026-08-12 大塚さんから「なんの、修正か こちら側がわからん」。computeDiff が出張フラグとガソリン代を受け取っていなかった',
    sql: `
      select p.id::text as key,
             to_char(p.submitted_at,'MM/DD') || ' ' || coalesce(p.submitted_by_name,'?')
               || '「' || coalesce(left(p.reason,24),'(理由なし)') || '」' as detail
      from daily_report_pending_edits p
      where p.status = 'pending'
        and (p.diffs is null or jsonb_array_length(p.diffs) = 0)`,
  },
  {
    id: 'edit-claims-receipt-but-none',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '「領収書を添付」と言っている編集申請に、領収書が1枚も無い',
    impact: '証憑なしの経費が承認待ちに積まれる。画面はプレビューが出て送信も成功するので誰も気づけない',
    origin: '2026-08-12 編集経路が uploadExpenseFiles を一度も呼んでおらず、9件・約59,000円が領収書ゼロで承認待ちだった',
    sql: `
      with items as (
        select p.id, p.submitted_at, p.submitted_by_name, p.reason,
               jsonb_array_length(coalesce(item->'fileUrls','[]'::jsonb)) as n
        from daily_report_pending_edits p
        cross join lateral jsonb_array_elements(coalesce(p.payload->'sites','[]'::jsonb)) site
        cross join lateral jsonb_each(coalesce(site->'expenses','{}'::jsonb)) cat(k, v)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(cat.v) = 'array' then cat.v else '[]'::jsonb end) item
        where p.status = 'pending'
          and p.reason ~ '(領収|添付|レシート)'
      )
      select id::text as key,
             to_char(min(submitted_at),'MM/DD') || ' ' || coalesce(min(submitted_by_name),'?')
               || '「' || coalesce(left(min(reason),24),'') || '」 添付' || sum(n)::text || '枚' as detail
      from items
      group by id
      having sum(n) = 0`,
  },
  {
    id: 'report-null-user',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '日報の user_id が null',
    impact: '本人の履歴に出てこない＝「送ったのに消えた」に見える。集計からも落ちる',
    origin: 'users 行が無い状態で日報が保存され得た経路（liff のテナント/作業員解決）',
    sql: `
      select r.id::text as key,
             to_char(r.date,'YYYY-MM-DD') || ' の日報（作成 ' || to_char(r.created_at,'MM/DD HH24:MI') || '）' as detail
      from daily_reports r
      where r.user_id is null`,
  },
  {
    id: 'dup-report-same-day',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '同じ人・同じ日の日報が重複している',
    impact: '集計が二重計上になる。編集しても別の行が表示され「直したのに戻る」現象になる',
    origin: 'users 行重複バグ（check-then-insert の競合）で日報が分裂した件',
    sql: `
      select r.user_id::text || ':' || r.date::text as key,
             to_char(r.date,'YYYY-MM-DD') || ' が ' || count(*)::text || ' 件' as detail
      from daily_reports r
      where r.user_id is not null
      group by r.user_id, r.date
      having count(*) > 1`,
  },
  {
    id: 'dup-users-row',
    layer: 1, kind: 'sql', severity: 'critical',
    title: '同じ LINE ユーザー / 作業員に users 行が複数ある',
    impact: '日報の紐付け先が申請のたびに揺れる。履歴が消えたり同じ日に戻ったりする',
    origin: '2026-07 users行重複バグ。一意 index ＋ upsert 化で塞いだので、これは再発検知',
    sql: `
      select 'line:' || u.account_id::text || ':' || u.line_user_id as key,
             'LINEユーザー ' || left(u.line_user_id, 12) || '… に users 行が ' || count(*)::text || ' 件' as detail
      from users u
      where u.line_user_id is not null
      group by u.account_id, u.line_user_id
      having count(*) > 1
      union all
      select 'worker:' || u.account_id::text || ':' || u.worker_id::text as key,
             '作業員 ' || coalesce(min(u.real_name),'?') || ' に users 行が ' || count(*)::text || ' 件' as detail
      from users u
      where u.worker_id is not null
      group by u.account_id, u.worker_id
      having count(*) > 1`,
  },
  {
    id: 'tategae-no-receipt',
    layer: 1, kind: 'sql', severity: 'warn',
    title: '立替精算なのに領収書が付いていない経費（直近30日）',
    impact: '精算時に証憑が出せない。金額が大きいものは税務上も問題になる',
    origin: '領収書添付漏れ9件の周辺監視。★人が単に付け忘れる場合もあるので warn（baseline で既知分を消す運用）',
    // ★trains / highways は除外する。ICカードやETCは構造的に領収書が出ないので、
    //  入れると常時100件超が鳴り続けて誰も見なくなる（本番実測で166件中118件がこの2費目だった）。
    //  「鳴りっぱなしの警告は無いのと同じ」なので、拾えないものは最初から対象にしない。
    sql: `
      select r.id::text || ':' || cat.k || ':' || item.ord::text as key,
             to_char(r.date,'MM/DD') || ' ' || cat.k || ' ¥'
               || to_char(coalesce((item.val->>'yen')::numeric,0),'FM999,999,999')
               || ' ' || coalesce(item.val->>'payee','') as detail
      from daily_reports r
      cross join lateral jsonb_array_elements(coalesce(r.sites,'[]'::jsonb)) site
      cross join lateral jsonb_each(coalesce(site->'expenses','{}'::jsonb)) cat(k, v)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(cat.v) = 'array' then cat.v else '[]'::jsonb end) with ordinality item(val, ord)
      where r.date >= current_date - interval '30 days'
        and cat.k not in ('trains', 'highways')
        and coalesce((item.val->>'tategae')::boolean, false)
        and coalesce((item.val->>'yen')::numeric, 0) > 0
        and jsonb_array_length(coalesce(item.val->'fileUrls','[]'::jsonb)) = 0`,
  },

  // ────────────────────────────────────────────────
  //  層2: 滞留検知（状態Xに長く居すぎ＝業務が詰まっている）
  //  ★人から申告が来る前に気づくのが目的。牛田さんの件は1週間気づけなかった。
  // ────────────────────────────────────────────────
  {
    id: 'pending-edit-stale',
    layer: 2, kind: 'sql', severity: 'critical',
    title: '編集申請が7日以上ほったらかし',
    impact: '作業員は「出したのに進まない」状態で待たされ続ける。給与・経費の締めに間に合わなくなる',
    origin: '2026-08-12 牛田さんの申請が承認待ちのまま1週間動かず、本人からの申告で初めて発覚した',
    sql: `
      select p.id::text as key,
             to_char(p.submitted_at,'MM/DD') || ' ' || coalesce(p.submitted_by_name,'?')
               || '（' || extract(day from now() - p.submitted_at)::int::text || '日経過）' as detail
      from daily_report_pending_edits p
      where p.status = 'pending'
        and p.submitted_at < now() - interval '7 days'`,
  },
  {
    id: 'report-not-notified',
    layer: 2, kind: 'sql', severity: 'warn',
    title: '日報が保存されたのに通知が飛んでいない（1日以上経過）',
    impact: '承認者が新しい日報に気づかない。通知が静かに死んでいても誰も分からない',
    origin: 'LINE の月間push上限(429)や Edge Function の 401 で通知だけが無言で止まる事故が複数回あった',
    // settings は (account_id, key, value) の key/value テーブル。value は text。
    // ★通知OFFのアカウントで鳴らしても意味が無いので、ONのテナントだけを対象にする。
    sql: `
      select r.id::text as key,
             to_char(r.date,'MM/DD') || ' の日報（保存 ' || to_char(r.created_at,'MM/DD HH24:MI') || '）' as detail
      from daily_reports r
      join settings s
        on s.account_id = r.account_id
       and s.key = 'notify_report_enabled'
       and lower(coalesce(s.value,'')) in ('true','1','on')
      where r.line_notified_at is null
        and r.created_at < now() - interval '1 day'
        and r.created_at > now() - interval '14 days'`,
  },

  // ────────────────────────────────────────────────
  //  層3: セキュリティプローブ（kind:'probe' / async run() を書く）
  //  層4: 本番スモーク（kind:'smoke' / demoテナントで実際に業務を通す）
  //
  //  ★runner は kind で分岐済みなので、ここに足すだけで動く。
  //   層3は「anonキーだけで何が読めるか」「公開バケットに何があるか」を毎日測り、
  //   許可済みリストから増えたら落とす（ratchet）想定。2026-08-13 に手で見つけた
  //   「旧バケットが public / daily_reports が anon で全行読める」はこれで自動検知できる。
  //   層4は本番DBに書くため、demoテナント限定・後始末必須の設計が要る（未着手）。
  // ────────────────────────────────────────────────
]

export const LAYER_NAMES = {
  1: 'データ不変条件',
  2: '滞留検知',
  3: 'セキュリティプローブ',
  4: '本番スモーク',
}
