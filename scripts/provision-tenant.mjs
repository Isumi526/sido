#!/usr/bin/env node
// ============================================================
//  scripts/provision-tenant.mjs
//  先行スタートプラン用のアカウント発行フロー（1コマンドCLI）
//
//  出所: 2026-07-28 打合せ「一旦僕の方でする形で、会社名。代表者名、代表者
//   メールアドレスをオオツカさん経由で僕に教えてもらったら、僕の方から
//   コマンド実行して作るような形で進めていきたい」
//   方向性決定（2026-08-30・運用者選択A）: 1コマンドCLIに整備。
//   会社名・代表者名・代表者メールを渡すと account作成＋トライアル契約行の
//   挿入＋初期ユーザー作成まで一括で行う。管理画面UIは対象外（過剰と判断）。
//
//  ★トライアル情報（billing_status/contract_started_at/trial_ends_at）は
//   「アカウントに無償/有償の状態を持たせる」チケット（2026-09-03）で追加した
//   3列をここでセットする。無償満了日は shared/billing-trial.ts と同じ計算
//   （契約成立月の翌月末日。45日固定ではない＝2026-09-01弁護士打合せで確定）。
//
//  ★安全策:
//   - 既定はローカル接続。本番へ発行する時は明示的に --prod を付ける
//     （このスクリプトは実在の顧客アカウントを作る＝取り消しにくい操作）。
//   - --prod 時は接続先URLが本番refを含むことを確認してから実行する。
//   - 発行後のログイン用パスワードは1回だけ画面に出す（保存しない）。
//   - slugが既に使われていたら止める（上書きしない）。
//
//  使い方:
//    node scripts/provision-tenant.mjs --name "株式会社サンプル" --rep "山田太郎" \
//      --email yamada@example.co.jp --slug sample-co [--prod]
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ★shared/billing-trial.ts と同じ計算（正本はそちら）。scripts/ から .ts を直接
//  importする前例が無く新たな依存を増やさないため、ここでは同じロジックを複製する。
//  計算式を変えたら両方に反映すること。
function computeTrialEndsAt(contractStartedAt) {
  const [y, m] = contractStartedAt.split('-').map(Number)
  const end = new Date(Date.UTC(y, m + 1, 0))
  const yyyy = end.getUTCFullYear()
  const mm = String(end.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(end.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROD_REF = 'nrzzesbtvswoiouhldvi'

function loadEnv(p) {
  const out = {}
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
  return out
}

function parseArgs(argv) {
  const out = { prod: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prod') { out.prod = true; continue }
    const m = a.match(/^--([a-z]+)$/)
    if (m && argv[i + 1] && !argv[i + 1].startsWith('--')) { out[m[1]] = argv[++i] }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const { name, rep, email, slug, fee } = args
if (!name || !rep || !email || !slug) {
  console.error('使い方: node scripts/provision-tenant.mjs --name "会社名" --rep "代表者名" --email "rep@example.com" --slug "会社スラグ" [--fee 月額円] [--prod]')
  console.error('  slug は英数字とハイフンのみ・ログインURLのテナント識別子になる')
  console.error('  --fee: 有償移行後の月額(円)。無償満了20日前告知ポップアップに使う。未指定でも作成できるが、')
  console.error('         設定するまでそのテナントには告知ポップアップが出ない（誤った金額を出さないフェイルセーフ）')
  process.exit(1)
}
if (!/^[a-z0-9-]+$/.test(slug)) { console.error(`✗ slug は英数字とハイフンのみ: "${slug}"`); process.exit(1) }
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error(`✗ メールアドレスの形式が不正: "${email}"`); process.exit(1) }
if (fee !== undefined && (!/^\d+$/.test(fee) || Number(fee) <= 0)) { console.error(`✗ --fee は正の整数(円)で指定: "${fee}"`); process.exit(1) }

const rootEnv = loadEnv(resolve(ROOT, '.env'))
const adminEnv = loadEnv(resolve(ROOT, 'apps/admin/.env'))

const URL = args.prod ? `https://${PROD_REF}.supabase.co` : (process.env.SUPABASE_URL || adminEnv.VITE_SUPABASE_URL)
const SERVICE_KEY = args.prod
  ? (process.env.SUPABASE_PROD_SERVICE_ROLE_KEY || rootEnv.SUPABASE_PROD_SERVICE_ROLE_KEY)
  : (process.env.SUPABASE_SERVICE_ROLE_KEY || rootEnv.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU')

if (!URL || !SERVICE_KEY) { console.error('✗ 接続情報が取得できません（.env / apps/admin/.env を確認）'); process.exit(1) }
if (args.prod && !URL.includes(PROD_REF)) { console.error(`✗ --prod なのに接続先が本番refを含まない: ${URL}`); process.exit(1) }
if (!args.prod && (URL.includes(PROD_REF) || !/127\.0\.0\.1|localhost/.test(URL))) {
  console.error(`✗ --prod を付けていないのに本番/リモートに向いている: ${URL}`); process.exit(1)
}

console.log(`接続先: ${args.prod ? '★本番★' : 'ローカル'} (${URL})`)
const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

// slug 重複チェック（上書きしない）
const { data: existing } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
if (existing) { console.error(`✗ slug "${slug}" は既に使われています。別のslugを指定してください。`); process.exit(1) }

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const trialEndsAt = computeTrialEndsAt(today)

// 1) アカウント作成（無償状態で開始。billing系3列は「アカウントに無償/有償の状態を持たせる」チケットで追加済み）
const { data: acct, error: acctErr } = await svc.from('accounts').insert({
  name, slug,
  billing_status: 'trial',
  contract_started_at: today,
  trial_ends_at: trialEndsAt,
  ...(fee !== undefined ? { monthly_fee_yen: Number(fee) } : {}),
}).select('id').single()
if (acctErr) { console.error('✗ アカウント作成に失敗:', acctErr.message); process.exit(1) }
console.log(`✓ アカウント作成: ${name} (slug=${slug}, id=${acct.id})`)
// ★account作成時のtriggerで work_categories / trade_type_presets が自動で標準行を持つ。
//  間違えて作った場合に削除するなら、先にこの2表を account_id で消してから accounts を消すこと
//  （FK制約で accounts 側から先には消せない）。
console.log(`  無償期間: ${today} 〜 ${trialEndsAt}（契約成立月の翌月末日）`)
if (fee !== undefined) {
  console.log(`  月額(有償移行後): ${Number(fee).toLocaleString()}円 ※満了20日前の告知ポップアップに使用`)
} else {
  console.log('  ⚠ 月額(--fee)未指定＝満了20日前の告知ポップアップは出ません。契約確定後に以下で設定してください:')
  console.log(`     update accounts set monthly_fee_yen = <円> where slug = '${slug}';`)
}

// 2) 代表者の認証ユーザーを作成（worker行を持たない「純オーナー」として登録）
//    パスワードは今回だけ生成して画面に出す。保存しない＝運用者が伝えて即変更してもらう想定。
const tempPassword = `${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`
const { data: created, error: userErr } = await svc.auth.admin.createUser({
  email, password: tempPassword, email_confirm: true,
  app_metadata: { account_slug: slug },
})
if (userErr) {
  console.error('✗ 認証ユーザー作成に失敗:', userErr.message)
  console.error(`  ★アカウント行(id=${acct.id})は作成済みです。手動で削除するか、メールアドレスを変えて再実行してください。`)
  process.exit(1)
}
console.log(`✓ 認証ユーザー作成: ${email}`)

// 3) accounts.owner_auth_user_id を紐付け（"worker行を持たない純オーナー"の判定に必須）
const { error: linkErr } = await svc.from('accounts').update({ owner_auth_user_id: created.user.id }).eq('id', acct.id)
if (linkErr) {
  console.error('✗ オーナーの紐付けに失敗:', linkErr.message)
  console.error(`  ★手動で accounts.owner_auth_user_id = '${created.user.id}' を id='${acct.id}' に設定してください。`)
  process.exit(1)
}

console.log('')
console.log('═══════════════════════════════════════════')
console.log(`  ${name} 様　アカウント発行完了`)
console.log('═══════════════════════════════════════════')
console.log(`  代表者: ${rep}`)
console.log(`  ログインID: ${email}`)
console.log(`  仮パスワード: ${tempPassword}`)
console.log(`  管理画面URL: ${args.prod ? 'https://sido-admin-stism.vercel.app/' : 'http://localhost:3001/'}`)
console.log('  ※このパスワードは今回しか表示されません。先方にお伝えください。')
console.log('═══════════════════════════════════════════')
