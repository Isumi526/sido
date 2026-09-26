// ============================================================
//  liff.checkin-rules-by-category.spec.ts
//  出退勤の確認ルールを作業区分（現場／工場／オフィス…）ごとに持てる（2026-09-13 亥角）。
//   - ルールを持つ区分が1つでもあれば打刻前に区分を選ぶ。出るルール＝共通＋その区分
//   - 区分を切り替えると、その区分のルールに入れ替わる（別区分のルールは出ない）
//   - 選んだ区分が attendance_logs.work_category_id に残る
//   - 区分ルールが無いテナントは従来どおり（区分の選択は出ない）＝ liff.checkin-common-rules が担保
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, passWorkStatusGate } from './helpers'

const TS = Date.now()
const RULE_COMMON = `E2E共通_${TS}`
const RULE_SITE   = `E2E現場だけ_ヘルメット_${TS}`
const RULE_OFFICE = `E2Eオフィスだけ_${TS}`
const CAT_SITE = `E2E区分_現場_${TS}`
const CAT_OFFICE = `E2E区分_オフィス_${TS}`
const CAT_FACTORY = `E2E区分_工場_${TS}`   // ★ルールを持たない区分（2026-09-14 伊藤さん「工場作業が選択できません」）

let accountId = ''
let workerId = ''
let catSiteId = ''
let catOfficeId = ''
let catFactoryId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
  const cats = await restSrv('work_categories', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([
    { account_id: accountId, name: CAT_SITE, sort_order: 900, active: true },
    { account_id: accountId, name: CAT_OFFICE, sort_order: 901, active: true },
    { account_id: accountId, name: CAT_FACTORY, sort_order: 902, active: true },
  ]) })
  catSiteId = cats.find((c: any) => c.name === CAT_SITE).id
  catOfficeId = cats.find((c: any) => c.name === CAT_OFFICE).id
  catFactoryId = cats.find((c: any) => c.name === CAT_FACTORY).id
  await restSrv('account_attendance_rules', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([
    { account_id: accountId, content: RULE_COMMON, timing: 'both', sort_order: 800, work_category_id: null },
    { account_id: accountId, content: RULE_SITE,   timing: 'both', sort_order: 801, work_category_id: catSiteId },
    { account_id: accountId, content: RULE_OFFICE, timing: 'both', sort_order: 802, work_category_id: catOfficeId },
  ]) })
})

test.afterAll(async () => {
  for (const c of [RULE_COMMON, RULE_SITE, RULE_OFFICE]) {
    await restSrv(`account_attendance_rules?content=eq.${encodeURIComponent(c)}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(
    new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())}`, { method: 'DELETE' }).catch(() => {})
  for (const id of [catSiteId, catOfficeId, catFactoryId]) await restSrv(`work_categories?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
})

async function clearRecentPunches() {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(since)}`,
    { method: 'DELETE' }).catch(() => {})
}

test('★区分を選ぶと「共通＋その区分」のルールだけが出て、切り替えると入れ替わる', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  const picker = page.getByTestId('rule-category-picker')
  await expect(picker, '★ルールを持つ区分があるので区分の選択が出る').toBeVisible({ timeout: 15000 })
  await expect(picker).toContainText(CAT_SITE)
  await expect(picker).toContainText(CAT_OFFICE)

  await page.getByTestId(`rule-category-${catSiteId}`).click()
  const list = page.locator('.rules-list')
  await expect(list).toContainText(RULE_COMMON, { timeout: 15000 })
  await expect(list).toContainText(RULE_SITE)
  await expect(list, '別区分のルールは出ない').not.toContainText(RULE_OFFICE)

  await page.getByTestId(`rule-category-${catOfficeId}`).click()
  await expect(list).toContainText(RULE_OFFICE, { timeout: 15000 })
  await expect(list).not.toContainText(RULE_SITE)
  await expect(list, '共通は常に出る').toContainText(RULE_COMMON)
})

// ★2026-09-14 伊藤さん「出退勤の項目で、工場作業が選択できません」。
//  ルールを持つ区分だけを選択肢にしていたため、現場作業にだけルールを入れた会社では工場作業が出なかった。
//  区分は打刻の work_category_id（日報の定時の既定にも効く）なので、ルールの有無で選べなくしない。
test('★ルールを持たない区分（工場作業）も選べ、その時は共通ルールだけが出る', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  const picker = page.getByTestId('rule-category-picker')
  await expect(picker).toBeVisible({ timeout: 15000 })
  await expect(picker, '★ルールが無い区分も選択肢に出る').toContainText(CAT_FACTORY)
  await page.getByTestId(`rule-category-${catFactoryId}`).click()
  const list = page.locator('.rules-list')
  await expect(list, '共通ルールは出る').toContainText(RULE_COMMON, { timeout: 15000 })
  await expect(list, '他区分のルールは出ない').not.toContainText(RULE_SITE)
  await expect(list).not.toContainText(RULE_OFFICE)
})

test('★選んだ区分が打刻に残り、退勤時はその区分が既定で選ばれる', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.getByTestId('rule-category-picker')).toBeVisible({ timeout: 15000 })
  await page.getByTestId(`rule-category-${catOfficeId}`).click()
  await expect(page.locator('.rules-list')).toContainText(RULE_OFFICE, { timeout: 15000 })

  const rows = page.locator('.rule-row')
  const n = await rows.count()
  for (let i = 0; i < n; i++) await rows.nth(i).click()
  await page.locator('.loc-get').first().click()
  const submit = page.getByRole('button', { name: '出勤を記録する' }).last()
  await expect(submit).toBeEnabled({ timeout: 20000 })
  await submit.click()

  const query = `attendance_logs?worker_id=eq.${workerId}&type=eq.checkin&order=checked_at.desc&limit=1&select=work_category_id,agreed_rule_texts`
  await expect.poll(async () => (await restSrv(query))[0]?.work_category_id ?? null, { timeout: 20000, message: '★選んだ区分が残る' })
    .toBe(catOfficeId)
  const log = (await restSrv(query))[0]
  expect(log.agreed_rule_texts).toContain(RULE_OFFICE)
  expect(log.agreed_rule_texts).toContain(RULE_COMMON)

  // 退勤: 出勤時の区分が既定で選ばれている
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.getByTestId(`rule-category-${catOfficeId}`), '出勤時の区分を引き継ぐ').toHaveClass(/on/, { timeout: 15000 })
  await expect(page.locator('.rules-list')).toContainText(RULE_OFFICE)
})

// ★2026-09-15 運用者指摘「間違ってルールがない区分を選択すると画面が戻れなくなって使いづらい」。
//  確認事項ゼロの区分を選ぶと即座に次のステップへ進み、区分を選び直す入口が消えていた。
//  → 選んだ直後はその画面に留めて「次へ」で進む／進んだ後も「区分：○○」の行から開き直せる。
test('★確認事項ゼロの区分を選んでも、留まって「次へ」で進み、進んだ後も区分を選び直せる', async ({ page }) => {
  await clearRecentPunches()
  // 共通ルールが1件でもあると「確認事項ゼロ」にならないので、この間だけ退避する
  const commons = await restSrv(`account_attendance_rules?account_id=eq.${accountId}&work_category_id=is.null&select=id`)
  const commonIds: string[] = commons.map((r: any) => r.id)
  if (commonIds.length) await restSrv(`account_attendance_rules?id=in.(${commonIds.join(',')})`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_category_id: catSiteId }) })
  try {
    await page.goto('/checkin', { waitUntil: 'networkidle' })
    await passWorkStatusGate(page)
    const picker = page.getByTestId('rule-category-picker')
    // 既定の区分（前回の区分 or 先頭）に確認事項が無いと自動で次へ進んでいるので、その時は行から開く
    await expect(picker.or(page.getByTestId('step-done-rules'))).toBeVisible({ timeout: 15000 })
    if (!(await picker.isVisible())) await page.getByTestId('step-done-rules').click()
    await expect(picker).toBeVisible()
    await page.getByTestId(`rule-category-${catFactoryId}`).click()

    // 自動で次へ進まず、確認事項なしの案内と「次へ」が出る
    await expect(page.locator('.no-rules-note'), '★確認事項ゼロでも画面が切り替わらない').toBeVisible({ timeout: 15000 })
    await expect(picker, '★区分をそのまま選び直せる').toBeVisible()
    await expect(page.locator('.rule-row')).toHaveCount(0)
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('location-step')).toBeVisible()

    // 進んだ後も「区分：○○」の行から戻れる
    const done = page.getByTestId('step-done-rules')
    await expect(done, '★確認事項ゼロでも戻る入口が残る').toBeVisible()
    await expect(done).toContainText(CAT_FACTORY)
    await done.click()
    await expect(picker).toBeVisible()
    await page.getByTestId(`rule-category-${catOfficeId}`).click()
    await expect(page.locator('.rules-list'), '選び直した区分のルールに切り替わる').toContainText(RULE_OFFICE, { timeout: 15000 })
  } finally {
    if (commonIds.length) await restSrv(`account_attendance_rules?id=in.(${commonIds.join(',')})`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_category_id: null }) }).catch(() => {})
  }
})
