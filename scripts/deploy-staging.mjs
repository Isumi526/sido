#!/usr/bin/env node
// ============================================================
//  scripts/deploy-staging.mjs
//  いまの作業ツリーを「スマホでレビューするためのステージング」へ出す。
//
//  使い方:
//    node scripts/deploy-staging.mjs            # admin と liff の両方
//    node scripts/deploy-staging.mjs admin      # 片方だけ
//    node scripts/deploy-staging.mjs --check    # デプロイせず現状の接続先だけ検証
//
//  ★このスクリプトが存在する理由（手でやると事故る）:
//   Vercel の向き先は apps/<app>/.vercel/project.json で決まる。ステージングに出すには
//   これを一時的に書き換えるしかないが、**戻し忘れると次の本番デプロイが staging に行くか、
//   逆に staging のつもりで本番へ出る**。人間の注意力に頼る手順にしない。
//   → 退避 → 差し替え → deploy → finally で必ず復元 → 復元されたことを assert、まで自動でやる。
//
//  ★デプロイ後に「本当に本番Supabase・demoテナントを向いているか」を配信物から検証する。
//   2026-08-11 に `vercel env pull` が暗号化値を復号せず空文字を返すことに気づかず、
//   全 env を空で設定して「✓」と報告した事故がある。コマンドの成功では確認にならない。
// ============================================================
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const ORG = 'team_2x7BAJnlx3fLVXSeRgeNJWPr'
const APPS = {
  admin: {
    dir: 'apps/admin',
    stagingProjectId: 'prj_661fhc4InxxnuezMLPi2cBLXEntl',
    url: 'https://sido-admin-staging.vercel.app',
    prodProjectName: 'sido-admin',
  },
  liff: {
    dir: 'apps/liff',
    stagingProjectId: 'prj_D3RF34INTlF3tHIyYtlR7oJh288w',
    url: 'https://sido-liff-staging.vercel.app',
    prodProjectName: 'sido-liff',
  },
}
// 配信物に必ず入っているべきもの / 絶対に入っていてはいけないもの
const PROD_REF = 'nrzzesbtvswoiouhldvi'          // 本番Supabase ref（ステージングは本番DBを見る）
const MUST_TENANT = 'demo'                        // ★本番テナントを既定にしない

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

const link = (dir) => `${ROOT}/${dir}/.vercel/project.json`

/** デプロイ済みのURLを叩いて、接続先とテナントを配信物から確かめる */
async function verify(name, app) {
  const html = await fetch(app.url, { cache: 'no-store' }).then((r) => r.text()).catch(() => '')
  if (!html) return { ok: false, why: 'URL に到達できない' }

  // liff は runtimeConfig を HTML に埋める。admin は assets の JS に入る。
  let blob = html
  if (!blob.includes(PROD_REF)) {
    const assets = [...html.matchAll(/\/(?:assets|_nuxt)\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0])
    for (const a of assets.slice(0, 8)) {
      const js = await fetch(app.url + a).then((r) => r.text()).catch(() => '')
      if (js.includes(PROD_REF)) { blob = js; break }
    }
  }
  if (!blob.includes(PROD_REF)) {
    // ★「見つからない」を「安全」と読まない。空 env で出した時にここで気づける。
    return { ok: false, why: `接続先を確認できなかった（${PROD_REF} が配信物に無い）。env が空の可能性` }
  }
  // liff は runtimeConfig の accountSlug が効く。admin は「ログインした人の app_metadata」が正で、
  // env は後方互換のフォールバックにすぎない（apps/admin/src/lib/account.ts）。
  // なので env で分かる範囲だけ見て、本当の担保は下の checkLogin() で取る。
  const tenant = (blob.match(/accountSlug["':\s]+["']([^"']+)/) || [])[1]
  if (tenant && tenant !== MUST_TENANT) {
    return { ok: false, why: `★テナントが ${tenant} になっている（${MUST_TENANT} でないと本番データを触る）` }
  }
  if (/appEnv["':\s]+["']development/.test(blob)) {
    return { ok: false, why: '★APP_ENV=development（LIFF認証を飛ばして本番DBに身元不明で書く）' }
  }
  return { ok: true, tenant: tenant ?? '(埋め込み無し)' }
}

async function deployOne(name) {
  const app = APPS[name]
  const p = link(app.dir)
  if (!existsSync(p)) throw new Error(`${p} が無い。先に vercel link が要る`)

  const backup = `${p}.prod-backup`
  copyFileSync(p, backup)
  const before = JSON.parse(readFileSync(backup, 'utf8'))

  try {
    writeFileSync(p, JSON.stringify({
      projectId: app.stagingProjectId, orgId: ORG, projectName: `${app.prodProjectName}-staging`,
    }))
    console.log(`[${name}] デプロイ中…`)
    const out = sh('npx', ['vercel', 'deploy', '--prod', '--yes', '--cwd', app.dir])
    const msg = (out.match(/"message":\s*"([^"]+)"/) || [])[1] ?? 'ready'
    console.log(`[${name}] ${msg}`)
  } finally {
    // ★ここは何があっても通す。復元しないまま終わるのが最悪の事故。
    copyFileSync(backup, p)
    const after = JSON.parse(readFileSync(p, 'utf8'))
    if (after.projectId !== before.projectId) {
      throw new Error(`[${name}] ★本番リンクを復元できていない。手で ${backup} を ${p} に戻すこと`)
    }
    console.log(`[${name}] 本番リンク復元OK (${after.projectName ?? after.projectId.slice(0, 12)})`)
  }
}

/**
 * ★本当の担保: レビュー用ログインが demo テナントであることを、実際に認証して確かめる。
 *  admin はテナントをログインユーザーの app_metadata から取るので、env をいくら見ても分からない。
 */
async function checkLogin() {
  const env = readFileSync(`${ROOT}/apps/admin/.env`, 'utf8')
  const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.replace(/^"|"$/g, '').trim()
  const url = pick('VITE_SUPABASE_URL'), key = pick('VITE_SUPABASE_ANON_KEY')
  if (!url || !key) return { ok: false, why: 'apps/admin/.env から Supabase の値を読めない' }
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staging@email.com', password: 'sido-stg-2026!' }),
  }).then((x) => x.json()).catch(() => null)
  const slug = r?.user?.app_metadata?.account_slug
  if (!slug) return { ok: false, why: `レビュー用ログインが通らない（${r?.msg ?? r?.error_description ?? '不明'}）` }
  if (slug !== MUST_TENANT) return { ok: false, why: `★レビュー用ログインのテナントが ${slug}（${MUST_TENANT} であるべき）` }
  return { ok: true, slug }
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const targets = args.filter((a) => !a.startsWith('--'))
const names = targets.length ? targets : Object.keys(APPS)
for (const n of names) if (!APPS[n]) throw new Error(`不明なアプリ: ${n}（admin / liff）`)

if (!checkOnly) for (const n of names) await deployOne(n)

console.log('\n=== 接続先の検証（配信物を実際に取得して確認）===')
let bad = 0
for (const n of names) {
  const r = await verify(n, APPS[n])
  console.log(r.ok ? `  ✓ ${n}: 本番Supabase / テナント=${r.tenant}` : `  ✗ ${n}: ${r.why}`)
  if (!r.ok) bad++
}
const lg = await checkLogin()
console.log(lg.ok
  ? `  ✓ ログイン: staging@email.com は テナント=${lg.slug}（本番テナントではない）`
  : `  ✗ ログイン: ${lg.why}`)
if (!lg.ok) bad++
if (bad) {
  console.error('\n★検証に失敗した。この状態のURLを人に渡さない（間違った環境をレビューさせることになる）。')
  process.exit(1)
}
console.log('\nレビュー用URL:')
for (const n of names) console.log(`  ${n}: ${APPS[n].url}`)
console.log('  ログイン: staging@email.com / sido-stg-2026!（demoテナント）')
console.log('\n★ステージングは本番Supabaseに書く。本番テナントのアカウントではログインしないこと。')
