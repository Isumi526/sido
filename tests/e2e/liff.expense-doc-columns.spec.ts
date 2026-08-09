// ============================================================
//  liff.expense-doc-columns.spec.ts
//  経費申請書（/expense/download）の明細の読みやすさ（2026-08-08 本番ユーザー報告）
//   ① 品名列に科目が出ていた … 個人経費は category に勘定科目が入るため、
//      品名列(expenseDisplayCategory)が「会議費」「旅費交通費」になっていた。
//      → 品名は note（実際の品名）優先、科目は別列に分ける。
//   ② 明細が日付順に並んでいない … 日報由来を全部 → 個人経費を全部 の順に push するだけで
//      ソートしていなかったため、途中で日付が戻り「立て替えた分が明細に無い」と誤認された。
//      → date 昇順に並べる。
//
//  ★シードは接頭辞 E2E帳票_ を持たせ、テスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, SEED_WORKER } from './global-setup'

const TS = Date.now()
const PREFIX = `E2E帳票_${TS}`
// 対象期は FEAT_EXP_PERIOD（YYYY-MM-second＝16日以降）。期内で日付が前後する2件を入れる。
const [Y, M] = FEAT_EXP_PERIOD.split('-')
const DATE_LATE  = `${Y}-${M}-28`
const DATE_EARLY = `${Y}-${M}-18`

const PERIOD_CHIP = `${parseInt(M, 10)}月後半`

let accountId = ''
let workerId = ''

async function selectTargetPeriod(page: import('@playwright/test').Page) {
  const chip = page.locator('button, .period-chip, [data-testid="period-chip"]').filter({ hasText: PERIOD_CHIP }).first()
  await expect(chip, `期チップ「${PERIOD_CHIP}」がある`).toBeVisible({ timeout: 15000 })
  await chip.click()
  await page.waitForTimeout(1200)
}

async function purge() {
  await restSrv(`personal_expenses?payee=like.${encodeURIComponent(PREFIX)}*`, { method: 'DELETE' }).catch(() => {})
  const left = await restSrv(`personal_expenses?payee=like.${encodeURIComponent(PREFIX)}*&select=id`)
  if ((left ?? []).length) throw new Error(`cleanup 未完了: ${left.length}件 残っている（接頭辞 ${PREFIX}）`)
}

test.describe('経費申請書の明細（品名/科目/並び順）', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    workerId = w[0].id

    // ★あとの日付を先に insert する。ソートが無いと登録順のまま 28日 → 18日 と並ぶ。
    for (const [date, payee, note] of [
      [DATE_LATE,  `${PREFIX}後`, `${PREFIX}品名_飲食代`],
      [DATE_EARLY, `${PREFIX}前`, `${PREFIX}品名_品川駅〜代々木駅`],
    ]) {
      await restSrv('personal_expenses', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          account_id: accountId, worker_id: workerId, date,
          account_category: '会議費', amount: 1234, payee, note, tategae: true,
        }),
      })
    }
  })

  test.afterAll(async () => { await purge() })

  test('★品名列には note（実際の品名）が出る。科目はその隣の別列に出る', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)

    const row = page.locator('tbody tr', { hasText: `${PREFIX}後` }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    const cells = await row.locator('td').allTextContents()
    // 列順: 月日 / 支払先 / インボイス番号 / 品名 / 科目 / ℓ / 現場名 / 使用車 / 金額 / 領収書
    expect(cells[3].trim(), '品名列は note').toBe(`${PREFIX}品名_飲食代`)
    expect(cells[4].trim(), '科目列は勘定科目').toBe('会議費')
    expect(cells[3], '★品名列に科目が出ていない（元の不具合）').not.toBe('会議費')

    // 見出しにも科目列がある
    const heads = await page.locator('thead th').allTextContents()
    expect(heads.map(h => h.replace(/\s/g, '')), '科目列の見出しが増えている').toContain('科目')
  })

  test('★明細が日付順に並ぶ（登録順で日付が戻らない）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 })

    // 表示は「M月D日」。行の日付を数値化して昇順であることを確認する。
    const dates = await page.locator('tbody tr td:first-child').allTextContents()
    const nums = dates.map((d) => {
      const m = d.match(/(\d+)\D+(\d+)/)
      return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : NaN
    }).filter((n) => !Number.isNaN(n))
    expect(nums.length, '明細に行がある').toBeGreaterThan(1)
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i], `${i}行目で日付が戻っている（${JSON.stringify(dates)}）`).toBeGreaterThanOrEqual(nums[i - 1])
    }

    // シードした2件は「先に入れた28日」より「後に入れた18日」が上に来る
    const idxEarly = dates.findIndex((_, i) => i >= 0 && nums[i] === parseInt(M, 10) * 100 + 18)
    const idxLate  = dates.findIndex((_, i) => i >= 0 && nums[i] === parseInt(M, 10) * 100 + 28)
    expect(idxEarly, '18日の行がある').toBeGreaterThanOrEqual(0)
    expect(idxLate, '28日の行がある').toBeGreaterThanOrEqual(0)
    expect(idxEarly, '★18日が28日より上（登録順ではなく日付順）').toBeLessThan(idxLate)
  })

  test('合計行の colspan がずれていない（列を増やしたので金額が右端に残る）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)
    const totalRow = page.locator('tfoot tr.total-row')
    await expect(totalRow).toBeVisible({ timeout: 15000 })
    const label = totalRow.locator('td').first()
    await expect(label).toHaveAttribute('colspan', '8')
  })
})
