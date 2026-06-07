// ============================================================
//  tests/e2e/global-setup.ts （ローカルスタック向け）
//  - admin 実ログイン用の auth ユーザーを用意（signup・冪等）
//  - 機能テスト用データを local DB にシード（seed.sql の上に追加）
//    A: 元請け付き日報 / C: 立替(tategae)経費付き日報
//  ※ マスタ(Worker 01 等)・dev-user-id・通常日報は seed.sql が投入済み
// ============================================================
import { SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, getAccountId, rest, upsert } from './helpers'

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

async function ensureAdminUser() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  if (res.ok) console.log(`[e2e] admin auth user 作成: ${ADMIN_LOGIN_EMAIL}`)
  else console.log(`[e2e] admin auth user は既存 (${res.status})`)  // already registered 等
}

async function getDevUserId(accountId: string): Promise<string | null> {
  const rows = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.${DEV_LINE_ID}&select=id`)
  return rows?.[0]?.id ?? null
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
  await ensureAdminUser().catch(e => console.warn('[e2e] admin user 作成失敗:', String(e)))
  await seedFeatureReports().catch(e => console.warn('[e2e] feature seed 失敗:', String(e)))
  await seedScheduleGroup().catch(e => console.warn('[e2e] schedule group seed 失敗:', String(e)))
  await seedDevUpdate().catch(e => console.warn('[e2e] dev_update seed 失敗:', String(e)))
}
