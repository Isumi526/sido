// ============================================================
//  liff.other-expense-merge.spec.ts
//  日報フォームの「その他」「その他雑経費」を入力1本に統合した件（案B）:
//   - セクションは「その他」1つだけになる（「その他雑経費」は消える）
//   - 既存日報を編集で開くと、両方の明細が1つのリストに畳まれて出る
//   - ★再保存しても配列は元に戻る（接待交際費は entertainments のまま）
//     ＝現場別集計の「接待交際費」列と「ホーム」列の金額が入れ替わらない
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId } from './helpers'

const EDIT_DATE = '2026-10-14'

test.describe('その他/その他雑経費の入力統合（liff）', () => {
  let uid = ''

  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    const accountId = await getAccountId()
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true, note: 'E2E:その他統合',
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: {
            vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
            others: [{ label: 'E2E養生テープ', yen: 1100, tategae: false, fileUrls: [] }],
            entertainments: [{ label: 'E2E懇親会', yen: 2200, tategae: false, companions: 'E2E元請け 山田様', fileUrls: [] }],
          },
        }],
      }),
    })
  })

  test.afterEach(async () => {
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('「その他雑経費」セクションが無くなり、両方の明細が「その他」1つに畳まれる', async ({ page }) => {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await expect(page.locator('body'), 'その他雑経費セクションは消える').not.toContainText('その他雑経費')
    // 2件とも同じリストに出ている（v-model は value 属性を出さないので inputValue で見る）
    const labels = await page.locator('.lineitem-card input.input').evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).value))
    expect(labels, 'その他の明細').toContain('E2E養生テープ')
    expect(labels, '旧その他雑経費の明細も同じリストに畳まれる').toContain('E2E懇親会')
  })

  test('★再保存しても接待交際費は entertainments のまま（集計の列が入れ替わらない）', async ({ page }) => {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await expect
      .poll(async () => (await page.locator('.lineitem-card input.input').evaluateAll(
        (els) => els.map((e) => (e as HTMLInputElement).value))).includes('E2E懇親会'), { timeout: 15000 })
      .toBe(true)

    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.locator('input[type="checkbox"]').last().check().catch(() => {})
    // 編集モードは編集理由が必須になった（daily_report_edit_logs）。入れないと更新できない
    await page.getByTestId('edit-reason').fill('E2E: 再保存の回帰確認')
    await page.locator('button[type="submit"].btn-submit').click()
    await page.waitForTimeout(4000)

    const rows = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}&select=sites`)
    const exp = rows?.[0]?.sites?.[0]?.expenses ?? {}
    const ents = (exp.entertainments ?? []) as any[]
    const others = (exp.others ?? []) as any[]

    expect(ents.map((e) => e.label), '接待交際費は entertainments に戻る').toContain('E2E懇親会')
    expect(others.map((o) => o.label), 'それ以外は others に戻る').toContain('E2E養生テープ')
    expect(others.map((o) => o.label), '懇親会が others へ移動していない').not.toContain('E2E懇親会')
    // 金額の総額が変わっていない（統合で消えたり二重になっていない）
    const total = [...ents, ...others].reduce((s, x) => s + Number(x.yen || 0), 0)
    expect(total, '合計金額は不変').toBe(3300)
  })
})
