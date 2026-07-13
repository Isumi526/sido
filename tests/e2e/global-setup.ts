// ============================================================
//  tests/e2e/global-setup.ts （ローカルスタック向け）
//  - admin 実ログイン用の auth ユーザーを用意（signup・冪等）
//  - 機能テスト用データを local DB にシード（seed.sql の上に追加）
//    A: 元請け付き日報 / C: 立替(tategae)経費付き日報
//  ※ マスタ(Worker 01 等)・dev-user-id・通常日報は seed.sql が投入済み
// ============================================================
import { execSync } from 'node:child_process'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, DB_URL, getAccountId, rest, upsert } from './helpers'

export const DEV_LINE_ID = 'dev-user-id'
// seed.sql と一致
export const SEED_SITE = 'テスト現場A'
export const SEED_WORKER = 'Worker 01'
export const SEED_SUB = '下請A'
// 機能テスト用（当月＝admin日報一覧の既定月・経費の当期に出るよう動的）
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
export const FEAT_A_DATE = `${YM}-01`
export const FEAT_A_SITE = 'テスト現場B'
export const FEAT_A_CONTRACTOR = '元請A'
export const FEAT_C_DATE = `${YM}-05`        // day<=15 → first
export const FEAT_C_PERIOD = `${YM}-first`
// 経費申請(W1/H/C)テスト用: 後半(second)期は締切=翌月3日で常に未来 → 日付非依存
export const FEAT_EXP_DATE   = `${YM}-20`      // day>15 → second
export const FEAT_EXP_PERIOD = `${YM}-second`
// ATT: 出退勤カード表示テスト用（固定日・専用現場で他の日報と衝突させない）
export const FEAT_ATT_DATE = `${YM}-10`
export const FEAT_ATT_SITE = 'テスト現場D'    // 打刻あり（この日報のみが使う専用現場）
export const FEAT_ATT_NO_SITE = 'テスト現場B' // 打刻なし（— 表示の検証用・同一カード内）

// EF(Edge Functions)未配信の事前検査。
//  `supabase start` だけでは functions serve が別プロセスのため EF は配信されない。
//  漏れると EF依存spec＋liffフォーム群(マスタ読込=get-master EF)が「HTTP 000/40秒タイムアウトで
//  大量fail」し、原因不明のまま個々のspecタイムアウトを何十回も観測する羽目になる
//  （2026-07-08実測: 52失敗の主因）。ここで1回・数秒で疎通確認し、未配信なら即・明示的に落とす。
async function checkFunctionsServed() {
  const url = `${SUPABASE_URL}/functions/v1/get-master`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    // 到達さえしていればOK（account not found 等の4xxは「配信されている」証拠として十分）。
    console.log(`[e2e] EF疎通OK (get-master → HTTP ${res.status})`)
  } catch (e) {
    throw new Error(
      '[e2e] Edge Functions が応答しません（get-master に接続できない）。\n' +
      '  `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env` を別ターミナルで起動してから再実行してください。\n' +
      `  (${String(e)})`,
    )
  }
}

async function ensureAdminUser() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  if (res.ok) console.log(`[e2e] admin auth user 作成: ${ADMIN_LOGIN_EMAIL}`)
  else console.log(`[e2e] admin auth user は既存 (${res.status})`)  // already registered 等

  // RLS（purchase_orders 等）のテナント解決に使う app_metadata.account_slug を付与。
  // 無いと current_account_id()=null で admin が自 account を読めず締め出される。
  // ローカルGoTrue admin APIの鍵問題を避け、ローカルDBに直接SQL更新（テストハーネス＝local専用）。
  // 次ログイン時(auth.setup.ts)のJWTに app_metadata として乗る。
  try {
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}') where email='${ADMIN_LOGIN_EMAIL}'"`,
      { stdio: 'ignore' },
    )
    console.log(`[e2e] admin app_metadata.account_slug=${ACCOUNT_SLUG} 付与(SQL)`)
  } catch (e) { console.warn('[e2e] app_metadata 付与失敗:', String(e)) }
}

async function getDevUserId(accountId: string): Promise<string | null> {
  const rows = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.${DEV_LINE_ID}&select=id`)
  return rows?.[0]?.id ?? null
}

// liffの「次の未送信日」(getNextUnsubmittedDate)は report_start_date（無ければworker.created_at）
// を起点に today まで日毎に空きを探す。ローカルDBは何ヶ月もE2E実行を積み重ねており、当月の
// FEAT_*(01/05/10/20)以外の日は空きがちなので、起点が古いまま(例: 先月末)だと大昔の穴を
// 「次の未送信日」として返してしまい、その日は編集期限（当日含む過去3日）を過ぎてロック済み＝
// 送信ボタンが恒久的に disabled のまま→送信系specが軒並み40秒タイムアウトする
// （2026-07-01頃から報告されていたliffフォーム群の「click不全」の一因）。
// SEED_WORKERのreport_start_dateを毎回「編集可能windowの最古日」に更新し、スキャン起点を
// 編集可能windowの先頭に固定する。
// ※ ロック判定(useReportLock.ts)は diffDaysFromToday(date) >= LOCK_AFTER_DAYS(=3) でロック
//   ＝実際に編集可能なのは diff 0/1/2（today・today-1・today-2）の3日だけで、today-3は
//   既にロック境界（最初この off-by-one で today-3 を起点にしてしまい、真っ先に見つかる
//   「次の未送信日」がロック済みで送信ボタンが恒久disabledになる回帰を作り込んだ→ today-2 に修正）。
// 同時に、そのwindow内(today除く。todayはFEAT_ATTが使うことがあるため触らない)の既存日報を
// 削除して毎回まっさらにする＝1回のE2Eフルランで複数specが「新規送信」を行っても
// （report/ai-receipt/parking-highway-multi 等）枯渇して「送信済みです」に倒れにくくする。
async function ensureRecentReportStartDate(accountId: string) {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date()
  const start = new Date(today); start.setDate(start.getDate() - 2)
  const startStr = fmt(start)
  try {
    await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ report_start_date: startStr }),
    })
    const userId = await getDevUserId(accountId)
    if (userId) {
      for (let i = 1; i <= 2; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i)
        const ds = fmt(d)
        await rest(`daily_reports?user_id=eq.${userId}&date=eq.${ds}`, { method: 'DELETE' }).catch(() => {})
      }
    }
    console.log(`[e2e] ${SEED_WORKER}.report_start_date=${startStr} に更新＋直近3日をクリア（未送信日スキャンの枯渇防止）`)
  } catch (e) { console.warn('[e2e] report_start_date 更新失敗:', String(e)) }
}

async function seedFeatureReports() {
  const accountId = await getAccountId()
  const userId = await getDevUserId(accountId)
  if (!userId) { console.warn('[e2e] dev-user-id 未検出（seed.sql 未適用?）'); return }

  // A: 元請け付き日報
  await upsert('daily_reports', 'user_id,date', {
    user_id: userId, date: FEAT_A_DATE, is_working: true, account_id: accountId,
    note: 'E2E:元請けテスト',
    sites: [{
      siteName: FEAT_A_SITE, contractorName: FEAT_A_CONTRACTOR,
      workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
      expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
    }],
  })

  // C: 立替(tategae)経費付き日報。駐車=立替, 高速=立替でない → 全2行 / 立替1行
  await upsert('daily_reports', 'user_id,date', {
    user_id: userId, date: FEAT_C_DATE, is_working: true, account_id: accountId,
    note: 'E2E:立替テスト',
    sites: [{
      siteName: SEED_SITE,
      workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
      expenses: {
        vehicles: [{ vehicleName: '軽トラ1号', parkingYen: 500, parkingTategae: true, highwayYen: 1000 }],
        vehicleUrls: ['https://example.com/receipt-featc.jpg'],
        trains: [], others: [],
      },
      subcontractors: [],
    }],
  })
  // EXP: 経費申請テスト用（後半期）。駐車800=立替 / 高速1200=非立替
  await upsert('daily_reports', 'user_id,date', {
    user_id: userId, date: FEAT_EXP_DATE, is_working: true, account_id: accountId,
    note: 'E2E:経費申請テスト',
    sites: [{
      siteName: SEED_SITE,
      workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
      expenses: {
        vehicles: [{ vehicleName: '軽トラ2号', parkingYen: 800, parkingTategae: true, highwayYen: 1200 }],
        trains: [], others: [],
      },
      subcontractors: [],
    }],
  })

  // ATT: 出退勤表示テスト用日報（テスト現場D=打刻あり / テスト現場B=打刻なし）
  await upsert('daily_reports', 'user_id,date', {
    user_id: userId, date: FEAT_ATT_DATE, is_working: true, account_id: accountId,
    note: 'E2E:出退勤表示テスト',
    sites: [
      {
        siteName: FEAT_ATT_SITE,
        workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      },
      {
        siteName: FEAT_ATT_NO_SITE,
        workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '09:00', endTime: '18:00', breakMinutes: 60 }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      },
    ],
  })

  // 出退勤打刻（Worker 01 × テスト現場D × FEAT_ATT_DATE）。checkin 2件で「最早を出勤」も検証。
  // RLS で DELETE 不可のため、既存があればスキップして冪等にする。
  const workerRows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const siteRows   = await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(FEAT_ATT_SITE)}&select=id`)
  const workerId = workerRows?.[0]?.id
  const siteId   = siteRows?.[0]?.id
  if (workerId && siteId) {
    const dayLo = new Date(`${FEAT_ATT_DATE}T00:00:00+09:00`).toISOString()
    const dayHi = new Date(`${FEAT_ATT_DATE}T23:59:59+09:00`).toISOString()
    const existing = await rest(`attendance_logs?worker_id=eq.${workerId}&site_id=eq.${siteId}&checked_at=gte.${dayLo}&checked_at=lte.${dayHi}&select=id`)
    if (!existing?.length) {
      const mk = (type: string, hm: string) => ({
        site_id: siteId, worker_id: workerId, type,
        checked_at: new Date(`${FEAT_ATT_DATE}T${hm}:00+09:00`).toISOString(),
        agreed_rule_texts: [],
      })
      await rest('attendance_logs', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([mk('checkin', '08:02'), mk('checkin', '08:10'), mk('checkout', '17:35')]),
      })
    }
  } else {
    console.warn('[e2e] ATT seed: worker/site 未検出（テスト現場D マスタ未投入?）')
  }
  console.log(`[e2e] feature reports シード OK (user=${userId})`)
}

// 予定管理カレンダーのグループ絞り込みテスト用: Worker 01 のみのグループ
export const SCHED_GROUP_NAME = 'E2Eカレンダーグループ'

async function seedScheduleGroup() {
  const accountId = await getAccountId()
  const wrows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const wid = wrows?.[0]?.id
  if (!wid) { console.warn('[e2e] schedule group seed: Worker 01 未検出'); return }

  // 既存のE2Eグループを再利用（冪等）。無ければ作成
  let grows = await rest(`schedule_groups?name=eq.${encodeURIComponent(SCHED_GROUP_NAME)}&created_by=eq.${wid}&select=id`)
  let gid = grows?.[0]?.id
  if (!gid) {
    const created = await rest('schedule_groups', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: SCHED_GROUP_NAME, created_by: wid, default_share: false }),
    })
    gid = created?.[0]?.id
  }
  if (gid) {
    // メンバー = Worker 01 のみ（onConflictで冪等）
    await rest('schedule_group_members?on_conflict=group_id,worker_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ group_id: gid, worker_id: wid }),
    }).catch(() => {})
  }
  console.log(`[e2e] schedule group シード OK (group=${gid})`)
}

// 開発の更新履歴テスト用エントリ（毎回 archived=false にリセットして冪等化）
export const DEV_UPDATE_TITLE = 'E2E更新テスト項目'

async function seedDevUpdate() {
  const rows = await rest(`dev_updates?title=eq.${encodeURIComponent(DEV_UPDATE_TITLE)}&select=id`)
  if (rows?.length) {
    await rest(`dev_updates?id=eq.${rows[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ archived: false }),
    })
  } else {
    await rest('dev_updates', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ title: DEV_UPDATE_TITLE, link: '/settings', archived: false }),
    })
  }
}

export default async function globalSetup() {
  await checkFunctionsServed()   // 未配信なら即・明示エラーで落とす（catchしない＝個別spec大量timeoutを防ぐ）
  await ensureAdminUser().catch(e => console.warn('[e2e] admin user 作成失敗:', String(e)))
  await ensureRecentReportStartDate(await getAccountId()).catch(e => console.warn('[e2e] report_start_date 更新失敗:', String(e)))
  await seedFeatureReports().catch(e => console.warn('[e2e] feature seed 失敗:', String(e)))
  await seedScheduleGroup().catch(e => console.warn('[e2e] schedule group seed 失敗:', String(e)))
  await seedDevUpdate().catch(e => console.warn('[e2e] dev_update seed 失敗:', String(e)))
}
