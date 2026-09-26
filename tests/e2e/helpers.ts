// ============================================================
//  tests/e2e/helpers.ts
//  E2E 共通：環境変数の読み込みと Supabase REST ヘルパー
//  接続先は【ローカルスタック】（apps/admin/.env.local が優先）。
//  RLS 無効テーブル（contractors / users / daily_reports 等）は
//  publishable(anon)キーで読み書きできるので、シード・後始末に使う。
//  admin 認証は実ログイン（auth.setup.ts）で行う。
// ============================================================
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}

// Playwright は repo ルートを cwd に実行される。.env.local（ローカル）を優先。
const env = {
  ...loadEnv(resolve(process.cwd(), 'apps/admin/.env')),
  ...loadEnv(resolve(process.cwd(), 'apps/admin/.env.local')),
}

export const SUPABASE_URL  = process.env.SUPABASE_URL      || env.VITE_SUPABASE_URL
export const ANON_KEY      = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
export const ACCOUNT_SLUG  = process.env.ACCOUNT_SLUG      || env.VITE_ACCOUNT_SLUG || 'test'
/** EF の置き場所。既定はローカルスタック経由。別プロセスで立てた EF を叩く時だけ FUNCTIONS_URL で差し替える */
export const FUNCTIONS_URL = process.env.FUNCTIONS_URL || `${SUPABASE_URL}/functions/v1`
/**
 * リマインド系 EF（reminder-auth）を cron として起動する共有シークレット。EF と同じ supabase/functions/.env から読む
 * （gitignore 対象＝ローカルで REMINDER_TRIGGER_SECRET=<任意の値> を足して functions serve を起動し直す）。
 * ★2026-09-25 から未設定では通さない（fail-closed）ので、他テナントを cron として回すテストはこれが要る。
 */
export const REMINDER_SECRET = process.env.REMINDER_TRIGGER_SECRET
  || loadEnv(resolve(process.cwd(), 'supabase/functions/.env')).REMINDER_TRIGGER_SECRET || ''

// psql 直接接続用（auth.users 等 REST 非公開のテーブルを操作するテスト向け）。
// ハードコード54322を避け、SUPABASE_URL のポートから逆算する（supabase CLI の既定割当＝ API port + 1 = DB port）。
// このプロジェクトのローカルスタックは 56321/56322 に固定（他プロジェクトと共存のため）なので
// 決め打ちすると環境が変わった時にサイレントに間違った(または存在しない)DBへ繋ぎにいく。
// 明示的に SUPABASE_DB_URL が設定されていればそちらを優先。
function deriveDbUrl(): string {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  try {
    const u = new URL(SUPABASE_URL)
    const apiPort = Number(u.port || 80)
    return `postgresql://postgres:postgres@${u.hostname}:${apiPort + 1}/postgres`
  } catch {
    return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  }
}
export const DB_URL = deriveDbUrl()

// admin 実ログイン用（ID=e2e → e2e@email.com）
export const ADMIN_LOGIN_ID   = process.env.ADMIN_LOGIN_ID   || 'e2e'
export const ADMIN_LOGIN_PASS = process.env.ADMIN_LOGIN_PASS || 'e2e-pass-1234'
export const ADMIN_LOGIN_EMAIL = `${ADMIN_LOGIN_ID}@email.com`

// 各アプリの URL（ローカル前提。必要なら env で上書き）
export const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3002'
export const LIFF_URL  = process.env.LIFF_URL  || 'http://localhost:3000'

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
}

// フロント(ブラウザ=JSTローカル時刻)基準の「今日」(YYYY-MM-DD)。
// new Date().toISOString().slice(0,10) はUTC日付を返すため、深夜0-9時JSTは
// フロントの「今日」と1日ズレる(2026-07-21未明のE2E実行で判明)。日付シードは必ずこちらを使う。
export function todayJST(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 「昨日の正午(JSTローカル)」のISO timestamp。固定オフセット(例:30時間前)で計算すると
// 深夜0-6時JSTの実行時に「一昨日」になってしまう(2026-07-21未明のE2E実行で判明)ため、
// 暦日ベースで昨日の日付を出してから正午に固定する。
export function yesterdayNoonJST(): string {
  const now = new Date()
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0)
  return y.toISOString()
}

/**
 * 公開キー(anon)から権限を全部剥がした表。シードは service_role で行う。
 *
 * ★ここに足すのは「本番で anon を締め出した」時だけ。テストが 401 で落ちたから
 *  逃がす場所ではない。アプリ側は Edge Function 経由に移した前提で、
 *  テストハーネスだけが直接 REST を使う。
 * ★「anon で読めない/書けない」こと自体を検証する spec は、この rest() ではなく
 *  各 spec 内の anonFetch を使うこと（ここを通すと service_role に化けて素通りする）。
 */
const ANON_LOCKED_TABLES = new Set([
  'attendance_logs', 'overtime_requests', 'report_edit_grants',
  'sites', 'contractors', 'site_subcontractors',
  'daily_reports',   // 2026-08-16 RLS化。読み書きは daily-reports-read / save-daily-report EF 経由
  'work_categories', 'site_category_hours',   // 2026-08-16 新設。最初からRLS有効・EF(master-data)経由
  // ★2026-08-30: ローカルの anon 権限を本番に合わせた（本番は workers への anon 書込を
  //  active/name/role/unit_price の4列に限定、push_subscriptions は権限ゼロ）。
  //  テストの下ごしらえ（permission_role を持つ承認者を作る等）は service_role で行う。
  'workers', 'push_subscriptions',
  // ★2026-08-30: 当初 using(true) にしていて、公開キーで全テナントのルール本文が読めていた。
  //  LIFFの打刻画面は attendance-log EF(service_role)経由で受け取るので anon 直読みは要らない。
  'account_attendance_rules',
])

export async function rest(pathAndQuery: string, init: RequestInit = {}): Promise<any> {
  const table = pathAndQuery.split('?')[0].split('/')[0]
  // ★書き込み（POST/PATCH/PUT/DELETE）は表を問わず service_role で行う（2026-09-26・RLS第2段A）。
  //  本番は anon の書き込み権限を全表から剥がした。テストの下ごしらえ・後始末はハーネスの都合であって
  //  「anon で書けること」を確かめているのではないので、anon に書かせる理由が無い。
  //  読み（GET）は従来どおり anon のまま＝anon で読めなくなった表は ANON_LOCKED_TABLES に足す。
  const isWrite = (init.method ?? 'GET').toUpperCase() !== 'GET'
  const base = isWrite || ANON_LOCKED_TABLES.has(table) ? srvHeaders : headers
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...base, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST ${res.status} ${pathAndQuery}: ${text}`)
  return text ? JSON.parse(text) : null
}

// service_role キー（RLS バイパス）。RLS を入れた表（purchase_orders 等）の
// シード/検証/後始末や、auth admin API（app_metadata 付与）に使う。ローカル専用。
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''
const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }

/** service_role で PostgREST を叩く（RLS バイパス・テスト専用） */
export async function restSrv(pathAndQuery: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...srvHeaders, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST(srv) ${res.status} ${pathAndQuery}: ${text}`)
  return text ? JSON.parse(text) : null
}

/** auth admin API（service_role）。app_metadata 付与等に使う。 */
export async function authAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...init,
    headers: { ...srvHeaders, ...(init.headers || {}) },
  })
}

/** test アカウントの id を返す */
export async function getAccountId(): Promise<string> {
  const rows = await rest(`accounts?slug=eq.${encodeURIComponent(ACCOUNT_SLUG)}&select=id`)
  if (!rows?.length) throw new Error(`account not found: ${ACCOUNT_SLUG}`)
  return rows[0].id
}

/**
 * 見積の案件(estimate_projects)をDBに直接作り id を返す（#40）。
 * 見積の入口を「見積一覧の＋新規見積」に一本化し、/estimate-builder 直打ちの新規カードを廃止したため、
 * E2E は案件をDBで用意して `/estimate-builder?project=<id>` へ直接遷移する。
 */
export async function createEstimateProject(name: string): Promise<string> {
  const accountId = await getAccountId()
  const rows = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name }),
  })
  return rows[0].id
}

/**
 * 見積もり機能のフィーチャーフラグ（settings.estimate_feature_enabled・2026-08-09 新設）。
 * アカウント単位の settings 行で、本番は 8/19 の解禁までOFF。
 *
 * ★E2E では「ONが既定」。global-setup が毎回ONで用意する。
 *  見積画面に到達する spec が40本近くある一方、OFFを主題にするのは
 *  admin.estimate-feature-flag.spec.ts の1本だけなので、多数派を既定に置く。
 *
 * ★★このフラグは spec をまたいで共有される（アカウント単位・playwright は workers:1 の直列）。
 *  OFFにしたまま test を抜けると、**アルファベット順でその後に来る見積系 spec が全部落ちる**。
 *  2026-08-15 に実際に起きた: feature-flag spec の afterAll が行を消していたため、
 *  admin.estimate-intake 以降〜admin.trade-dnd まで15本が「見積画面がダッシュボードへ
 *  リダイレクトされる」で失敗し、着地ゲートの合否が読めなくなっていた。
 *  一過性のフレークに見えるが、順序で決まる再現性100%の壊れ方をする。
 *  OFFにする spec は必ず restoreEstimateFeature() でONへ戻すこと。
 */
export const FEATURE_KEY_ESTIMATE = 'estimate_feature_enabled'

export async function enableEstimateFeature(): Promise<void> {
  const accountId = await getAccountId()
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: FEATURE_KEY_ESTIMATE, value: 'true', label: '見積もり機能の表示' }),
  })
}

/** スイートの既定（ON）へ戻す。行を消すのではなくONにするのが「戻す」の意味。 */
export async function restoreEstimateFeature(): Promise<void> {
  await enableEstimateFeature()
}

/** ★OFFを主題にする spec 専用。使ったら必ず restoreEstimateFeature() で戻すこと。 */
export async function disableEstimateFeature(): Promise<void> {
  const accountId = await getAccountId()
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.${FEATURE_KEY_ESTIMATE}`, { method: 'DELETE' })
}

/**
 * 「使う機能」（settings.feature.* ・2026-09-19 B-0）の汎用セッター。
 *  value=null は行を消す（＝登録簿の既定値に戻る）。
 *  ★在庫（feature.inventory）は既定OFF（ベータ）。在庫画面に到達する spec（admin.inventory / liff.inventory*）が
 *   通るよう global-setup が毎回ONにする。OFFを主題にする spec は必ず true へ戻すこと（見積フラグと同じ落とし穴）。
 */
export async function setFeatureFlag(settingKey: string, value: boolean | null): Promise<void> {
  const accountId = await getAccountId()
  if (value === null) {
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.${encodeURIComponent(settingKey)}`, { method: 'DELETE' }).catch(() => {})
    return
  }
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: settingKey, value: String(value), label: 'E2E' }),
  })
}
export const FEATURE_KEY_INVENTORY = 'feature.inventory'
export async function enableInventoryFeature(): Promise<void> { await setFeatureFlag(FEATURE_KEY_INVENTORY, true) }
/** 見積Excel連携（個別対応・既定OFF・E-1）。admin.estimate-excel* spec のために global-setup が ON にする */
export const FEATURE_KEY_ESTIMATE_EXCEL = 'estimate_excel_enabled'
export async function enableEstimateExcelFeature(): Promise<void> { await setFeatureFlag(FEATURE_KEY_ESTIMATE_EXCEL, true) }

// 現場マスタの責任者候補（現場管理者以上=admin/office/site_manager）のキャッシュ。
// 複数specがそれぞれ専用ワーカーを作ると無駄に増えるため、プロセス内で使い回す。
let _respWorkerId: string | null | undefined

/**
 * 現場マスタの追加/編集フォームは責任者(現場管理者以上)が必須(a472f7e)。
 * REST で直接 site を作る spec が admin UI の編集モーダルで保存(.btn-save)まで行う場合、
 * responsible_worker_id が無いと save() が「責任者を選択してください」で弾いて保存が完了しない。
 * 既存の候補を探し、無ければテスト専用の候補を1体作って使い回す（他specの実行順に依存しない）。
 */
export async function ensureResponsibleWorkerId(accountId: string): Promise<string> {
  if (_respWorkerId) return _respWorkerId
  const existing = await rest(`workers?account_id=eq.${accountId}&active=eq.true&permission_role=in.(admin,office,site_manager)&select=id&limit=1`)
  if (existing?.[0]?.id) { _respWorkerId = existing[0].id; return _respWorkerId! }
  const created = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: 'E2E責任者候補(共通)', role: 'site', permission_role: 'site_manager', unit_price: 20000, active: true, sort_order: 997 }),
  })
  _respWorkerId = created?.[0]?.id
  return _respWorkerId!
}

/** dev-user-id（LIFF devモード用ユーザー）の users.id を返す */
export async function getDevUserId(): Promise<string | null> {
  const accountId = await getAccountId()
  const rows = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  return rows?.[0]?.id ?? null
}

/**
 * 現場情報共有(site_shares・Part B・2026-07-17): LIFF devユーザーに指定現場の閲覧権を付与する。
 * sites/index.vue・chats/index.vue・site-chat/[id].vue が site_shares 基準に絞り込むようになった
 * ため、これらのページ/機能をテストするE2Eは対象現場ごとに本関数で共有登録しておく必要がある
 * （responsible_worker_id で現場責任者になっている場合は不要＝そちらは別途自動で見える）。
 */
export async function grantSiteShare(siteId: string): Promise<void> {
  const accountId = await getAccountId()
  const userId = await getDevUserId()
  if (!userId) { console.warn('[e2e] grantSiteShare: dev-user-id の users行が見つかりません'); return }
  await restSrv('site_shares', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, site_id: siteId, user_id: userId }),
  })
}

/** upsert（merge-duplicates）して representation を返す */
export async function upsert(table: string, onConflict: string, body: unknown): Promise<any[]> {
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  })
}

/**
 * 見積ビルダーのタブを開く（案件を開いた直後のレースに耐える版）。
 *
 * estimate-builder の loadItems() は完走時に builderTab を 'items' へ戻す。
 * 案件作成直後はこの読み込みがまだ飛んでいるため、早すぎるタブクリックが
 * 後から打ち消されて「要素はあるのに見えない／not stable」になる。
 * 目的のパネルが実際に見えるまでクリックし直す。
 */
export async function openBuilderTab(page: any, tab: string, probeSelector: string): Promise<void> {
  const { expect } = await import('@playwright/test')
  await expect(async () => {
    await page.locator(`[data-testid="tab-${tab}"]`).click()
    await expect(page.locator(probeSelector).first()).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 25000 })
}

/**
 * estimate-builder が各工種ブロックの末尾に常時確保する空行数。
 * apps/admin/src/pages/estimate-builder.vue の SPARE_ROWS と必ず一致させる
 * （ズレると「工種を足した直後の先頭行」を掴む spec が全部 index を外す）。
 */
export const EST_SPARE_ROWS = 1

/** 工種ブロックを追加した直後、その新ブロック先頭行の index を返す */
export async function newBlockFirstRow(page: any): Promise<number> {
  return (await page.locator('[data-testid^="item-name-"]').count()) - EST_SPARE_ROWS
}

/**
 * 非公開バケットのファイルを service_role で落として latin1 文字列で返す。
 * PDFの中身（非圧縮のコンテンツストリーム）を検査したい時に使う。
 */
export async function downloadStorage(bucket: string, path: string): Promise<{ data: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) return { data: null }
  const buf = Buffer.from(await res.arrayBuffer())
  return { data: buf.toString('latin1') }
}

/**
 * 「領収書が無い理由」の欄をまとめて埋める。
 *
 * ★2026-08-14 に経費の領収書添付が必須になった（無い場合は理由の記入が要る）。
 *  それ以前から在る spec は「金額だけ入れて送信する」形なので、そのままだと
 *  送信が弾かれる。領収書そのものが主題でない spec は、送信の直前にこれを呼んで
 *  必須条件を満たしてから本来の検証に進む。
 *  ※ 領収書必須化そのものの検証は liff.expense-receipt-required.spec.ts。
 */
export async function fillNoReceiptReasons(page: any, reason = 'E2E: 領収書なし'): Promise<number> {
  const inputs = page.locator('input[placeholder*="領収書が無い理由"]')
  const n = await inputs.count()
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i)
    if (await el.inputValue()) continue
    await el.fill(reason)
  }
  return n
}

/**
 * 中身の無い最小PDFを作る（ページ数だけ持つ）。
 * ★pdf-lib は apps/admin にしか無く、テストから解決できないので手で組む。
 * ★2026-08-19: 同じものが admin.estimate-drawing-{extract,send,quantity}.spec.ts に
 *  3つコピーされている。新しく書く分はここを使う（既存分は触ると壊しうるので据え置き）。
 */
export function makePdf(pages: number): Buffer {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

// ── spec 専用の作業員（共有作業員の奪い合いを無くす） ────────────────
//  ★背景: liff の日報系specは全部が1人の dev 作業員(dev-user-id)を共有していて、
//   「編集可能window（当日含む過去3日）の未送信日」という有限の資源を取り合っていた。
//   さらに一部の spec は workers.report_start_date を書き換える。結果、
//   「単独なら通るのに並列だと落ちる」テストが常態化し、それを何度も
//   「既存バグ」と誤記録してきた。雑音に紛れて本物の回帰が埋もれる。
//
//  解決: spec ごとに専用の作業員・users 行を持たせ、資源を共有しない。
//   liff は development モードで localStorage の dev_line_uid を身元に使う
//   （useLiff.ts）ので、ブラウザコンテキストに一度置けば全ページで効く。

/** spec 専用の作業員＋users 行を用意して line_user_id を返す（何度呼んでも同じ行） */
export async function ensureDevWorker(key: string): Promise<{ lineUserId: string; userId: string; workerId: string }> {
  const accountId = await getAccountId()
  const lineUserId = `dev-user-${key}`
  const name = `E2E専用_${key}`

  const found = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
  const workerId = found?.[0]?.id ?? (await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, active: true, role: 'site',   // role は factory/site のみ許容
      // ★登録日を遡らせる。未送信日の起点は max(service_start_date, 作業員登録日, report_start_date) なので、
      //  作りたてだと起点が当日になり未送信日が1日しか無い＝送信系テストの前提が崩れる。
      created_at: new Date(Date.now() - 90 * 86400e3).toISOString() }),
  }))[0].id

  const foundU = await restSrv(`users?line_user_id=eq.${encodeURIComponent(lineUserId)}&select=id`)
  const userId = foundU?.[0]?.id ?? (await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, line_user_id: lineUserId, worker_id: workerId, real_name: name }),
  }))[0].id

  // ★同意済みにしておく（2026-09-04）。個人データの同意ゲート(ConsentGate)は
  //  未同意だと全画面オーバーレイでポインタを奪うため、同意を主題にしない spec が
  //  「visible/enabled なのにクリックできない」で落ちる。しかもゲートは status EF の
  //  応答後に出るので、待ち時間の長い spec だけが踏む＝再現しにくいフレークになる。
  //  本番の既存作業員は同意済みで使っている状態が普通なので、その状態を既定に置く。
  //  ★ゲート自体の検証は liff.worker-consent.spec.ts が自分でこの行を消して行う。
  await restSrv('worker_consents', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId,
      consent_version: 1, consent_text: 'E2E: 同意済みの既定状態',
    }),
  }).catch(() => { /* 同意テーブルが無い環境（旧スキーマ）でも他specを止めない */ })

  return { lineUserId, userId, workerId }
}

/**
 * この spec は専用の作業員で動く、と宣言する。
 * 未送信日（当日含む過去3日）も自分用に作り直すので、他specに壊されない。
 * ★page.goto より前に呼ぶこと（addInitScript は以後の遷移すべてに効く）。
 */
export async function useDevWorker(page: any, key: string, opts: { login?: boolean } = {}): Promise<{ userId: string; workerId: string }> {
  const accountId = await getAccountId()
  const { lineUserId, userId, workerId } = await ensureDevWorker(key)
  await page.addInitScript((uid: string) => {
    try { window.localStorage.setItem('dev_line_uid', uid) } catch { /* 使えない環境は既定のまま */ }
  }, lineUserId)
  // ★その作業員として実際にログインした状態で開く（liff-test.ts の既定ログインを上書きする）
  if (opts.login !== false) await loginLiffAs(page, workerId)

  // 未送信日を自分用に確保する（起点を today-2 に寄せ、直近2日を空ける）。
  // ※古い日付に寄せてはいけない。3日より前はロック済みで送信ボタンが恒久disabledになる。
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dayBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d) }
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: dayBack(2) }),
  }).catch(() => {})
  for (const n of [0, 1, 2]) {
    await rest(`daily_reports?user_id=eq.${userId}&date=eq.${dayBack(n)}`, { method: 'DELETE' }).catch(() => {})
  }

  // 履歴（＝編集リンク）を必要とする spec のために、送信済みの日報を1件だけ置く。
  // today-2 を埋めると未送信日は today-1 / today の2日残る＝送信系テストの前提も満たす。
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: dayBack(2), is_working: true,
      note: 'E2E:専用作業員の履歴',
      sites: [{
        siteName: 'テスト現場A', workers: [], subcontractors: [],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  }).catch(() => {})

  return { userId, workerId }
}

// ── 作業員アプリ（LIFF）をログインした状態で開く（2026-09-26・RLS第2段A）─────────────
//  本番の作業員は全員メール/パスワードでログインしている（2026-09-16 実測）＝書き込みは authenticated で走る。
//  ところが E2E の作業員アプリは開発モード（ログイン無し＝anon）で動いていたので、anon の書き込み権限を
//  剥がすと「本番では起きない失敗」で大量に落ちる。本番と同じ形（ログイン済み）に揃える。
//  ・作業員ごとにログインを用意する（既に workers.auth_user_id があればそれを使う）
//  ・パスワードは全員共通（liff.worker-login が使う Worker 01 と同じ値＝上書きしても変わらない）
//  ・トークンは30分使い回す（1時間で切れる。ページ側で更新させるとリフレッシュトークンの再利用検知に当たる）
export const LIFF_LOGIN_PASS = 'worker-login-1234'
const liffSessions = new Map<string, { session: any; at: number }>()

/** 作業員に紐づくログイン（auth ユーザー）を用意して、ログインしたセッションを返す */
export async function workerSession(workerId: string): Promise<any> {
  const hit = liffSessions.get(workerId)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.session

  const w = (await restSrv(`workers?id=eq.${workerId}&select=id,account_id,auth_user_id`))?.[0]
  if (!w) throw new Error(`worker not found: ${workerId}`)
  const slug = (await restSrv(`accounts?id=eq.${w.account_id}&select=slug`))?.[0]?.slug
  const adminHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
  const appMeta = { account_slug: slug, worker_id: workerId }

  let email = ''
  if (w.auth_user_id) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${w.auth_user_id}`, {
      method: 'PUT', headers: adminHeaders,
      body: JSON.stringify({ password: LIFF_LOGIN_PASS, email_confirm: true, app_metadata: appMeta }),
    })
    email = (await r.json())?.email ?? ''
  }
  if (!email) {
    email = `liff-${workerId}@example.com`
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ email, password: LIFF_LOGIN_PASS, email_confirm: true, app_metadata: appMeta }),
    })
    let authId = (await r.json().catch(() => null))?.id
    if (!authId) {
      // 前回の実行で作ったまま worker 側の紐付けだけ消えている（worker を作り直した等）
      const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: adminHeaders }).then(x => x.json())
      authId = (list?.users ?? []).find((u: any) => u.email === email)?.id
      if (!authId) throw new Error(`auth user create failed: ${email}`)
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authId}`, {
        method: 'PUT', headers: adminHeaders,
        body: JSON.stringify({ password: LIFF_LOGIN_PASS, email_confirm: true, app_metadata: appMeta }),
      })
    }
    await restSrv(`workers?id=eq.${workerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ auth_user_id: authId }),
    })
  }

  const session = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: LIFF_LOGIN_PASS }),
  }).then(x => x.json())
  if (!session?.access_token) throw new Error(`worker login failed: ${email} ${JSON.stringify(session).slice(0, 200)}`)
  liffSessions.set(workerId, { session, at: Date.now() })
  return session
}

/** 既定の開発ユーザー（line_user_id='dev-user-id'・seed の Worker 01）の worker_id */
let defaultDevWorkerId = ''
export async function devUserWorkerId(): Promise<string> {
  if (defaultDevWorkerId) return defaultDevWorkerId
  const u = await restSrv(`users?line_user_id=eq.dev-user-id&select=worker_id`)
  defaultDevWorkerId = u?.[0]?.worker_id ?? ''
  if (!defaultDevWorkerId) throw new Error('dev-user-id の users 行に worker_id が無い（seed.sql 未適用?）')
  return defaultDevWorkerId
}

/** 作業員アプリの supabase-js が読むセッションの保存キー（sb-<host先頭>-auth-token） */
const LIFF_SESSION_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`

/**
 * この page を、指定の作業員としてログインした状態にする。★page.goto より前に呼ぶこと。
 * 後から呼んだ方が勝つ（addInitScript は登録順に走る）＝ useDevWorker で既定ログインを上書きできる。
 */
export async function loginLiffAs(page: any, workerId: string): Promise<void> {
  const session = await workerSession(workerId)
  const value = JSON.stringify({
    access_token: session.access_token, refresh_token: session.refresh_token, token_type: session.token_type,
    expires_in: session.expires_in, expires_at: session.expires_at, user: session.user,
  })
  await page.addInitScript(({ k, v }: { k: string; v: string }) => {
    try { window.localStorage.setItem(k, v) } catch { /* 使えない環境は anon のまま */ }
  }, { k: LIFF_SESSION_KEY, v: value })
}

/**
 * /checkin を開いた直後に出る「今日は稼働しますか？」ゲート（2026-08-31 追加）を通過する。
 *
 * ★このゲートは条件付きで出る（出勤打刻のとき・その日の日報がまだ無いときだけ）。
 *  「出るはず」と決め打ちで待つと退勤側のテストが必ずタイムアウトするので、
 *  ゲートか確認画面のどちらかが出るまで待って、ゲートなら押す、という形にしている。
 */
export async function passWorkStatusGate(page: any): Promise<void> {
  const gate   = page.getByTestId('ws-working')
  const header = page.locator('.checklist-header')
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await gate.isVisible().catch(() => false)) { await gate.click(); return }
    if (await header.isVisible().catch(() => false)) return
    await page.waitForTimeout(200)
  }
  throw new Error('稼働有無ゲートも打刻の確認画面も出なかった')
}

/**
 * 外部者（下請け業者・元請け）向けポータル /p/<token> の同意ゲートを通過する。
 * 同意は初回だけ・トークン単位で出るので「出れば押す」形にしている
 * （必ず出ると決め打ちすると、同意済みトークンを使うテストがタイムアウトする）。
 */
export async function passExternalConsent(page: any): Promise<void> {
  const agree = page.getByTestId('consent-agree')
  await agree.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await agree.isVisible().catch(() => false)) {
    await agree.click()
    await page.getByTestId('consent-gate').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  }
}

/**
 * 未提出日報の割り込みモーダル（ホーム起動時・2026-08-31）を出さないようにする。
 * ★画面全体を覆うのでハンバーガー等のクリックを塞ぐ。割り込み自体が主題でないテストは
 *  これを呼んでから goto すること（liff.report-nudge.spec.ts だけは呼ばずに検証する）。
 */
export async function suppressOverdueModal(page: any): Promise<void> {
  await page.addInitScript(() => {
    try { window.sessionStorage.setItem('overdue_report_dismissed', '1') } catch { }
  })
}
