// ============================================================
//  admin.overtime-wage-deduction.spec.ts
//  8時間超の時間単価は「(日当 − 控除額) ÷ 8」（2026-09-09・佐谷さん確認済み）
//
//  ★背景
//   佐谷さん「残業等の時間給料はこちらから-8000して÷8ベースにする計算式に修正を」
//   → 確認の結果、条件は「残業」ではなく **8時間超**。
//     8時間までは日当ベース、9時間目からは (日当−8000)÷8 が基礎。
//   日当には移動・拘束など「8時間ぶんの労働」以外が含まれるため、
//   9時間目以降にも日当÷8を掛けると払い過ぎになる、という賃金規程。
//
//  ★控除額はアカウント単位の設定（settings.overtime_wage_deduction）。
//   コードに直書きすると他テナント（Hiromokkou 等）の金額まで狂う。
//
//  ★期待値が一意に効く作り
//   Worker 03（日当22,000）が 08:00-20:00＝実働10h（通常8h＋残業2h）。
//     控除なし: 8×2750 + 2×2750×1.25 = ¥28,875   ← 従来
//     控除8000: 8×2750 + 2×1750×1.25 = ¥26,375   ← 本仕様
//   通常時間まで控除してしまう実装だと 8×1750+… になり、どちらとも違う額になる。
//
//  ★発効日を見ていることも見る。
//   人件費は保存せず都度計算しているので、発効日を無視すると
//   過去の月次集計まで一斉に金額が変わる（＝過去の給与が動く事故）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E控除_${TS}`
const SITE = `E2E控除現場_${TS}`
const WORKER = 'Worker 03'   // seed: 日当 22,000

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
// 他specと衝突しない日（labor-cost は 17/18 を使う）
const day = new Date(`${ym}-14T00:00:00`).getDay() === 0 ? 15 : 14
const DATE = `${ym}-${String(day).padStart(2, '0')}`
/** 発効日＝この日報の当日。これより前は控除しない、を後段で確かめる。 */
const FROM = DATE

let accountId = ''
let devUserId = ''

test.describe.configure({ mode: 'serial' })

async function setSetting(key: string, value: string) {
  await rest('settings?on_conflict=key,account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, label: `E2E ${key}`, account_id: accountId, updated_at: new Date().toISOString() }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: TOKEN,
      sites: [{
        siteName: SITE,
        workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '20:00', breakMinutes: 60 }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      }],
    }),
  })
})

test.afterAll(async () => {
  // ★設定を必ず戻す。残すと他の人件費specが全部ずれる。
  await setSetting('overtime_wage_deduction', '0').catch(() => {})
  await setSetting('overtime_wage_deduction_from', '').catch(() => {})
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

async function openSite(page: any) {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const tab = page.locator('.tab', { hasText: SITE })
  await expect(tab).toBeVisible({ timeout: 15000 })
  await tab.click()
  return page.locator('.table-wrap')
}

test('控除が未設定なら従来どおり（日当÷8 を残業にも使う）', async ({ page }) => {
  await setSetting('overtime_wage_deduction', '0')
  await setSetting('overtime_wage_deduction_from', '')
  const table = await openSite(page)
  await expect(table, '控除なし＝¥28,875').toContainText('¥28,875')
})

test('★8時間超だけ (日当−8000)÷8 が基礎になる', async ({ page }) => {
  await setSetting('overtime_wage_deduction', '8000')
  await setSetting('overtime_wage_deduction_from', FROM)
  const table = await openSite(page)
  // 8×2750 + 2×1750×1.25 = 26,375
  await expect(table, '★残業2hだけ1750円ベース').toContainText('¥26,375')
  // 通常8hまで控除していたら 8×1750+4375 = ¥18,375 になる
  await expect(table, '通常8hまで控除していない').not.toContainText('¥18,375')
  await expect(table, '控除が効いている（従来額でない）').not.toContainText('¥28,875')
})

test('★発効日より前の日報には控除がかからない（過去の給与を動かさない）', async ({ page }) => {
  await setSetting('overtime_wage_deduction', '8000')
  // 日報の翌日を発効日にする＝この日報は対象外
  const d = new Date(`${DATE}T00:00:00`); d.setDate(d.getDate() + 1)
  const after = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await setSetting('overtime_wage_deduction_from', after)
  const table = await openSite(page)
  await expect(table, '発効日より前は従来どおり¥28,875').toContainText('¥28,875')
})
