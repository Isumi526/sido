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
        trains: [], others: [],
      },
      subcontractors: [],
    }],
  })
  console.log(`[e2e] feature reports シード OK (user=${userId})`)
}

export default async function globalSetup() {
  await ensureAdminUser().catch(e => console.warn('[e2e] admin user 作成失敗:', String(e)))
  await seedFeatureReports().catch(e => console.warn('[e2e] feature seed 失敗:', String(e)))
}
