// ============================================================
//  scripts/sync-shared.mjs
//  単一ソース shared/*.ts を各アプリの *.gen.ts へコピーする。
//  経費平坦化ロジックの二重化（admin/liff 手動コピー）による直し漏れを防ぐため、
//  共有ロジックは shared/ だけを編集し、本スクリプトで各アプリへ展開する。
//  使い方: npm run sync:shared  （shared/ を編集したら必ず実行してコミット）
//  ※ Vercel の workspace 解決問題を避けるため packages 化はせず、各アプリ内の
//    相対 import で解決できる生成ファイルとしてコミットする。
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 共有ソース → 各アプリの生成先（複数追加可）
const SHARES = [
  {
    src: 'shared/expense-flatten.ts',
    dests: [
      // report-storage.gen.ts が同階層から import する
      'supabase/functions/_shared/expense-flatten.gen.ts',
      'apps/admin/src/lib/expense-flatten.gen.ts',
      'apps/liff/composables/expense-flatten.gen.ts',
    ],
  },
  {
    // 現場名の正規化・site_id 解決。保存時(LIFF)・集計時(admin)・バックフィルで
    // 同じ結果にならないと同じ現場が別物として集計される（ルルレモン型バグ）
    src: 'shared/site-similarity.ts',
    dests: [
      // report-storage.gen.ts が同階層から import する
      'supabase/functions/_shared/site-similarity.gen.ts',
      'apps/admin/src/lib/site-similarity.gen.ts',
      'apps/liff/utils/site-similarity.gen.ts',
      // ★composables 配下にも置く。report-storage.gen.ts が同階層から import するため
      //  （shared 間の import は生成時に './name.gen' へ書き換わる＝同階層前提）
      'apps/liff/composables/site-similarity.gen.ts',
    ],
  },
  {
    // 日報を保存形に整える。LIFF と EF(submit-daily-report) の両方が使う
    src: 'shared/report-storage.ts',
    dests: [
      'apps/liff/composables/report-storage.gen.ts',
      // ★Edge Function からも使う。supabase/functions/ の外を import する EF は前例が無く、
      //  deploy 時にバンドルされるか手元で検証する手段（--dry-run）も無い。
      //  本番で boot エラーになると日報の保存が止まるので、既存の作法どおり _shared に置く。
      'supabase/functions/_shared/report-storage.gen.ts',
    ],
  },
  {
    // 稼働時間の料率別計算・人件費。★getRateLines は共有しない（ラベルの出し方が
    // liff=i18n / admin=直書きで違う）ので、各アプリ側に残してある
    src: 'shared/worker-hours.ts',
    dests: [
      'apps/admin/src/lib/worker-hours.gen.ts',
      'apps/liff/utils/worker-hours.gen.ts',
    ],
  },
  {
    src: 'shared/attendance-punch.ts',
    dests: [
      'apps/admin/src/lib/attendance-punch.gen.ts',
      'apps/liff/composables/attendance-punch.gen.ts',
    ],
  },
  {
    src: 'shared/schedule-core.ts',
    dests: [
      'apps/admin/src/lib/schedule-core.gen.ts',
      'apps/liff/composables/schedule-core.gen.ts',
    ],
  },
]

const HEADER = (srcRel) =>
  `// ⚠️ AUTO-GENERATED from ${srcRel} — DO NOT EDIT.\n` +
  `// 共有ロジックの正本は ${srcRel}。編集したら \`npm run sync:shared\` で本ファイルを再生成すること。\n\n`

/**
 * shared 同士の import を .gen 版へ向け直す。
 * ★shared/a.ts が './b' を import していると、生成先では b は 'b.gen' という名前で
 *  隣に置かれるため、そのままコピーすると解決できない（2026-08-15 に
 *  report-storage.ts が最初の相互 import を持ち込んで判明）。
 *  正典側は素の名前のままにしたいので、書き換えは生成時に行う。
 */
function rewriteSharedImports(body, sharedNames, { denoStyle } = {}) {
  // ★配布先で必要な形が違う。
  //  Deno(Edge Function) は import に**拡張子が必須**、Vite/Nuxt は**拡張子なし**を期待する。
  //  同じ shared を両方へ配るので、書き分けないとどちらかが必ず壊れる。
  //  ここを間違えると EF が boot エラーで落ち、日報の保存が止まる（2026-08-16 に踏んだ）。
  //  正典(shared/*.ts)側は Deno に合わせて拡張子つきで書く。
  const suffix = denoStyle ? '.gen.ts' : '.gen'
  let out = body
  for (const name of sharedNames) {
    out = out.replace(
      new RegExp(`(from\\s+['"]\\./)${name}(?:\\.ts)?(['"])`, 'g'),
      `$1${name}${suffix}$2`,
    )
  }
  return out
}

// 生成対象の shared モジュール名（相互 import の書き換えに使う）
const SHARED_NAMES = SHARES.map(({ src }) => src.replace(/^shared\//, '').replace(/\.ts$/, ''))

let changed = 0
for (const { src, dests } of SHARES) {
  const raw = readFileSync(resolve(ROOT, src), 'utf8')
  for (const dest of dests) {
    // supabase/functions 配下＝Deno（拡張子必須）。それ以外＝バンドラ（拡張子なし）
    const denoStyle = dest.startsWith('supabase/functions/')
    const out = HEADER(src) + rewriteSharedImports(raw, SHARED_NAMES, { denoStyle })
    const abs = resolve(ROOT, dest)
    mkdirSync(dirname(abs), { recursive: true })
    let prev = ''
    try { prev = readFileSync(abs, 'utf8') } catch { /* new file */ }
    if (prev !== out) { writeFileSync(abs, out); changed++; console.log(`✓ 生成: ${dest}`) }
    else console.log(`= 変更なし: ${dest}`)
  }
}
console.log(changed ? `\n${changed}ファイルを更新しました。コミットを忘れずに。` : '\nすべて最新です。')
