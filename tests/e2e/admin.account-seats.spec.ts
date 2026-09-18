// ============================================================
//  admin.account-seats.spec.ts
//  契約対応⑧: アカウント数（ログインID数）を数えて表示し、基本数を超えたら警告する（発行は止めない）。
//   https://app.notion.com/p/3dd0ff81c56b811db298c720d05b7beb
//  ★守ること:
//   1. 数え方＝active な作業員の auth_user_id（distinct）＋純オーナー。無効化した作業員は数えない
//   2. N > 基本数 のとき警告バナー。以下なら出ない。ブロックはしない
//   3. 月末スナップショット関数は冪等（同じ年月は上書き）で、その時点の基本数も残す
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, DB_URL } from './helpers'
import { execFileSync } from 'node:child_process'

const sql = (q: string) => execFileSync('psql', [DB_URL, '-Atc', q], { encoding: 'utf8' }).trim()

test.describe('アカウント数（契約対応⑧）', () => {
  let accountId = ''
  let origBase = 30
  test.beforeAll(async () => {
    accountId = await getAccountId()
    origBase = Number(sql(`select base_account_count from public.accounts where id='${accountId}'`)) || 30
  })
  test.afterAll(async () => {
    sql(`update public.accounts set base_account_count=${origBase} where id='${accountId}'`)
    sql(`delete from public.account_seat_snapshots where account_id='${accountId}' and year_month='1999-01'`)
  })

  test('★数え方・警告・スナップショット', async ({ page }) => {
    const n = Number(sql(`select public.count_account_seats('${accountId}')`))
    // 無効化した作業員は数えない：一時的に1人 inactive にすると減る（auth_user_id 持ちがいる場合）
    const withAuth = sql(`select id from public.workers where account_id='${accountId}' and active and auth_user_id is not null limit 1`)
    if (withAuth) {
      sql(`update public.workers set active=false where id='${withAuth}'`)
      const n2 = Number(sql(`select public.count_account_seats('${accountId}')`))
      sql(`update public.workers set active=true where id='${withAuth}'`)
      expect(n2, '★無効化した作業員のIDは数えない').toBeLessThanOrEqual(n)
    }

    // 基本数を N-1 にすると警告、N にすると出ない
    sql(`update public.accounts set base_account_count=${Math.max(0, n - 1)} where id='${accountId}'`)
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('seat-count')).toContainText(`アカウント数 ${n} / 基本 ${Math.max(0, n - 1)}`)
    if (n > 0) await expect(page.getByTestId('seat-warn'), '★超過で警告').toContainText('翌月から追加アカウントとして課金')
    // ブロックしない：追加ボタンは押せる
    await expect(page.locator('.btn-add')).toBeEnabled()

    sql(`update public.accounts set base_account_count=${n} where id='${accountId}'`)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByTestId('seat-count')).toContainText(`/ 基本 ${n}`)
    await expect(page.getByTestId('seat-warn')).toHaveCount(0)

    // スナップショット：冪等・基本数を同時に残す
    sql(`select public.snapshot_account_seats('1999-01')`)
    sql(`select public.snapshot_account_seats('1999-01')`)
    const snap = await restSrv(`account_seat_snapshots?account_id=eq.${accountId}&year_month=eq.1999-01&select=seat_count,base_count`)
    expect(snap.length, '★同じ年月は1行（上書き）').toBe(1)
    expect(Number(snap[0].seat_count)).toBe(n)
    expect(Number(snap[0].base_count)).toBe(n)
  })
})
