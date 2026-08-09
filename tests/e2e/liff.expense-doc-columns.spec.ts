// ============================================================
//  liff.expense-doc-columns.spec.ts
//  経費申請書（/expense/download）の明細の読みやすさ（2026-08-08 本番ユーザー報告）
//   ① 品名欄に科目が出ていた … 個人経費は category に勘定科目が入るため、
//      品名欄(expenseDisplayCategory)が「会議費」「旅費交通費」になっていた。
//      → 個人経費だけ note（実際の品名）を出す。note が無ければ空欄。
//   ② 明細が日付順に並んでいない … 日報由来を全部 → 個人経費を全部 の順に push するだけで
//      ソートしていなかったため途中で日付が戻り、「立て替えた分が明細に無い」と誤認された。
//      → date 昇順に並べる。
//
//  ★2026-07-31 レビュー決定の維持も同時に固定する（一度これを崩す実装を書いて気づいた）:
//    ・客先帳票に「科目」列は出さない（科目は社内画面だけ）
//    ・日報由来の品名は従来のマッピング（駐車代→P代 / 電車代→交通費）
//    詳細な回帰は liff.expense-payee-fallback.spec.ts が担保する。ここでは崩していないことだけ見る。
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

const PAYEE_LATE   = `${PREFIX}後`
const PAYEE_EARLY  = `${PREFIX}前`
const PAYEE_NONOTE = `${PREFIX}品名なし`
const ITEM_NAME    = `${PREFIX}飲食代`

// 列: 1月日 2支払先 3インボイス番号 4品名 5ℓ 6現場名 7使用車 8金額 9領収書
const C_ITEM = 'td:nth-child(4)'

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

test.describe('経費申請書の明細（品名/並び順）', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    workerId = w[0].id

    // ★あとの日付を先に insert する。ソートが無いと登録順のまま 28日 → 18日 と並ぶ。
    const seeds: [string, string, string | null][] = [
      [DATE_LATE,  PAYEE_LATE,   ITEM_NAME],
      [DATE_EARLY, PAYEE_EARLY,  `${PREFIX}品川駅〜代々木駅`],
      [DATE_EARLY, PAYEE_NONOTE, null],   // 品名(note)未入力 → 品名欄は空
    ]
    for (const [date, payee, note] of seeds) {
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

  test('★個人経費の品名欄には note（実際の品名）が出る。科目は出さない', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)

    const row = page.locator('.expense-table tbody tr', { hasText: PAYEE_LATE }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.locator(C_ITEM), '品名欄は note').toHaveText(ITEM_NAME)
    await expect(row.locator(C_ITEM), '★品名欄に科目が出ない（元の不具合）').not.toHaveText('会議費')
  })

  test('★品名(note)が未入力の個人経費は、品名欄が空になる（科目で埋めない）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)

    const row = page.locator('.expense-table tbody tr', { hasText: PAYEE_NONOTE }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.locator(C_ITEM), '空欄（科目名を出さない）').toHaveText('')
  })

  test('★明細が日付順に並ぶ（登録順で日付が戻らない）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)
    await expect(page.locator('.expense-table tbody tr').first()).toBeVisible({ timeout: 15000 })

    // 表示は「M月D日」。行の日付を数値化して昇順であることを確認する。
    const dates = await page.locator('.expense-table tbody tr td:first-child').allTextContents()
    const nums = dates.map((d) => {
      const m = d.match(/(\d+)\D+(\d+)/)
      return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : NaN
    }).filter((n) => !Number.isNaN(n))
    expect(nums.length, '明細に行がある').toBeGreaterThan(1)
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i], `${i}行目で日付が戻っている（${JSON.stringify(dates)}）`).toBeGreaterThanOrEqual(nums[i - 1])
    }

    // シードした2件は「先に入れた28日」より「後に入れた18日」が上に来る
    const idxEarly = nums.indexOf(parseInt(M, 10) * 100 + 18)
    const idxLate  = nums.indexOf(parseInt(M, 10) * 100 + 28)
    expect(idxEarly, '18日の行がある').toBeGreaterThanOrEqual(0)
    expect(idxLate, '28日の行がある').toBeGreaterThanOrEqual(0)
    expect(idxEarly, '★18日が28日より上（登録順ではなく日付順）').toBeLessThan(idxLate)
  })

  test('客先帳票に科目列を生やしていない（2026-07-31 レビュー決定の維持）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await selectTargetPeriod(page)
    const thead = page.locator('.expense-table thead')
    await expect(thead).toBeVisible({ timeout: 15000 })
    await expect(thead, '科目列は無い').not.toContainText('科　目')
    await expect(page.locator('.expense-table tbody'), '勘定科目名が出ない').not.toContainText('旅費交通費')
    // 合計行の colspan は元のまま（列を増やしていない証拠）
    await expect(page.locator('.expense-table tfoot tr.total-row td').first()).toHaveAttribute('colspan', '7')
  })
})
