// ============================================================
//  scripts/seed-review-demo.mjs
//  ローカルでのレビュー用デモデータを一括投入する。
//
//  ★なぜ要るか: 見積・掛率・集計などは「データが無いと画面が空で確認できない」。
//   レビューのたびに手で作るのは現実的でないので、1コマンドで揃える。
//   すべて「レビュー用_」接頭辞。何度実行しても増殖しない（毎回作り直す）。
//
//  使い方:
//    node --env-file=.env scripts/seed-review-demo.mjs          # 投入
//    node --env-file=.env scripts/seed-review-demo.mjs --clean  # 片付け
//
//  ★ローカル(LOCAL_DB_URL)専用。ローカル以外を指していたら止める。
//  ★接続は psql 経由（他の scripts/*.mjs と同じ。pg は依存に無い）。
// ============================================================
import { spawnSync } from 'node:child_process'

const URL = process.env.LOCAL_DB_URL
if (!URL) { console.error('LOCAL_DB_URL が未設定です（.env）'); process.exit(1) }
if (!/(127\.0\.0\.1|localhost)/.test(URL)) {
  console.error('★ローカル専用です。LOCAL_DB_URL がローカルを指していません。')
  process.exit(1)
}
const CLEAN = process.argv.includes('--clean')

/** SQLを流す。値を返したい時は returning + -t -A で1行取る */
function sql(text, { quiet = true } = {}) {
  const r = spawnSync('psql', [URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', text], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('SQL失敗:', text.slice(0, 120))
    console.error(r.stderr?.trim())
    process.exit(1)
  }
  if (!quiet && r.stdout.trim()) console.log(r.stdout.trim())
  // ★returning の値だけを取る。psql は "INSERT 0 1" のコマンドタグも出すので、
  //  素の trim() だと UUID に "INSERT 0 1" がくっついて次のSQLが壊れる（実際に踏んだ）。
  return r.stdout.split('\n').map(l => l.trim()).filter(l => l && !/^(INSERT|UPDATE|DELETE|SELECT)\b/.test(l))[0] ?? ''
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const ACC = sql(`select id from accounts where slug='test' limit 1`)
if (!ACC) { console.error('test アカウントが見つかりません'); process.exit(1) }
const USR = sql(`select id from users where line_user_id='dev-user-id' limit 1`)
const P = 'レビュー用_'
const like = q(P + '%')

// ── 片付け（依存の逆順）──
sql(`delete from estimate_items where account_id=${q(ACC)} and item_name like ${like}`)
sql(`delete from estimate_projects where account_id=${q(ACC)} and name like ${like}`)
sql(`delete from estimate_supplier_trade_rates where account_id=${q(ACC)} and note like ${like}`)
sql(`delete from estimate_supplier_rates where account_id=${q(ACC)} and note like ${like}`)
sql(`delete from estimate_trades where account_id=${q(ACC)} and name like ${like}`)
sql(`delete from subcontractors where account_id=${q(ACC)} and name like ${like}`)
sql(`delete from contractors where account_id=${q(ACC)} and name like ${like}`)
sql(`delete from daily_reports where account_id=${q(ACC)} and sites::text like ${q('%' + P + '%')}`)
sql(`delete from sites where account_id=${q(ACC)} and name like ${like}`)
if (CLEAN) { console.log('✓ レビュー用データを片付けました'); process.exit(0) }

// ── 1) 集計リンク用: 無効化済みの現場＋過去(2026-06)の日報3件 ──
//   「終わった現場の集計を見たい」（今井さん要望）をそのまま再現する状況
const siteId = sql(`insert into sites(account_id,name,name_kana,active)
  values(${q(ACC)}, ${q(P + '終了現場')}, 'れひゆうようしゆうりようけんは', false) returning id`)
for (const d of ['2026-06-10', '2026-06-18', '2026-06-25']) {
  const sitesJson = JSON.stringify([{
    siteName: P + '終了現場', site_id: siteId,
    workers: [{ workerName: 'Worker 01', startTime: '08:00', endTime: '17:00' }],
    subcontractors: [], expenses: {},
  }])
  sql(`insert into daily_reports(account_id,user_id,date,is_working,sites)
       values(${q(ACC)}, ${q(USR)}, ${q(d)}, true, ${q(sitesJson)}::jsonb)`)
}

// ── 2) 見積・掛率用: 元請け／商社2社／工種2つ／見積案件＋明細4行 ──
const conId = sql(`insert into contractors(account_id,name,active) values(${q(ACC)},${q(P + '丹青社')},true) returning id`)
// ★category='商社' が要る。見積マスタの「商社別単価」は協力業者の区分=商社だけを商社として扱う
//  （これを入れ忘れて「まだ商社がありません」になった・2026-08-30）
const supA  = sql(`insert into subcontractors(account_id,name,category,active) values(${q(ACC)},${q(P + '商社A')},'商社',true) returning id`)
const supB  = sql(`insert into subcontractors(account_id,name,category,active) values(${q(ACC)},${q(P + '商社B')},'商社',true) returning id`)
const trFloor = sql(`insert into estimate_trades(account_id,name,sort_order) values(${q(ACC)},${q(P + '床工事')},1) returning id`)
const trWall  = sql(`insert into estimate_trades(account_id,name,sort_order) values(${q(ACC)},${q(P + '壁・天井')},2) returning id`)

// 掛率: 「商社一律」と「商社×工種」を両方入れて、優先順位（工種別が勝つ）を見せる
sql(`insert into estimate_supplier_rates(account_id,supplier_id,rate,note)
     values(${q(ACC)},${q(supA)},0.80,${q(P + '一律80%')})`)
sql(`insert into estimate_supplier_trade_rates(account_id,supplier_id,trade_id,rate,note)
     values(${q(ACC)},${q(supA)},${q(trFloor)},0.65,${q(P + '床だけ65%')})`)
sql(`insert into estimate_supplier_rates(account_id,supplier_id,rate,note)
     values(${q(ACC)},${q(supB)},0.75,${q(P + '一律75%')})`)

const prj = sql(`insert into estimate_projects(account_id,name,client_name,contractor_id,status,construction_location)
  values(${q(ACC)},${q(P + '内装改修工事')},${q(P + '丹青社')},${q(conId)},'draft',${q('名古屋市中区')}) returning id`)
const items = [
  [trFloor, supA, 'タイルカーペット', '500×500', '枚', 120, 1800],
  [trFloor, supA, '長尺シート', '2mm厚', 'm2', 60, 3200],
  [trWall,  supB, '石膏ボード', '12.5mm', '枚', 200, 780],
  [trWall,  supB, 'クロス', '量産品', 'm2', 350, 950],
]
items.forEach(([trade, sup, name, spec, unit, qty, price], i) => {
  // amount は生成列（quantity×unit_price）なので入れない
  sql(`insert into estimate_items(account_id,project_id,trade_id,supplier_id,item_name,spec,unit,quantity,unit_price,sort_order)
       values(${q(ACC)},${q(prj)},${q(trade)},${q(sup)},${q(P + name)},${q(spec)},${q(unit)},${qty},${price},${i})`)
})

console.log('✓ レビュー用データを投入しました')
console.log('  SITE_ID(無効化・2026-06の日報3件) =', siteId)
console.log('  ESTIMATE_PROJECT_ID              =', prj)
