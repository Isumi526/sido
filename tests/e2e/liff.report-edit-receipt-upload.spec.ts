// ============================================================
//  liff.report-edit-receipt-upload.spec.ts
//  編集モードでも領収書がアップロードされる（2026-08-12 本番障害）
//
//  何が起きたか:
//   uploadExpenseFiles を呼んでいたのは「新規送信の submit()」と「本日のガソリン代（即時）」の
//   2箇所だけで、編集モードには一度も無かった。作業員が領収書を選んでも fileUrls が空のまま
//   保留に入り、「◯◯の添付忘れ」という理由の申請に領収書が1枚も付いていなかった。
//   本番で9件・約59,000円（ホテル代25,163円/宿泊費15,098円を含む）が証憑なしで承認待ちだった。
//
//  ★画面はプレビューが出て送信も成功するので、作業員も承認者も気づけない。
//   だから「送信できた」ではなく「保留の payload に fileUrls が入ったか」で判定する。
//   実データが「7/12（ガソリン＝即時アップロード経路）だけ領収書1枚、他8件は0枚」だったのが動かぬ証拠。
//
//  接頭辞/日付固定のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId } from './helpers'

const EDIT_DATE = '2026-10-24'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const dummy = { name: 'receipt.png', mimeType: 'image/png', buffer: PNG }

let uid = ''
let accountId = ''

async function purge() {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
}

test.describe('編集モードの領収書アップロード', () => {
  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    accountId = await getAccountId()
    await purge()
    // 変更前: 駐車場代が1件あるが領収書は無い（本番の「添付忘れ」の状態）
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true,
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: {
            // ★駐車場代の明細は「車両あり」の時だけ画面に出る（report.vue: veh-subexpense）
            vehicles: [{ vehicleName: 'テスト車両', distanceKm: 10, fuelType: 'regular' }],
            highways: [], trains: [], hotels: [], others: [], entertainments: [],
            parkings: [{ yen: 800, payee: 'E2Eタイムズ', tategae: true, fileUrls: [] }],
          },
        }],
      }),
    })
  })

  test.afterEach(async () => { await purge() })

  async function openEdit(page: Page) {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
  }

  /** 保留に入った payload から領収書URLを全部拾う */
  async function pendingReceiptUrls(): Promise<string[]> {
    const rows = await restSrv(
      `daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=payload&order=submitted_at.desc&limit=1`)
    const p = rows?.[0]?.payload
    const urls: string[] = []
    for (const s of (p?.sites ?? [])) {
      for (const v of Object.values(s?.expenses ?? {})) {
        if (Array.isArray(v)) for (const it of v) urls.push(...((it as any)?.fileUrls ?? []))
      }
    }
    for (const g of (p?.gasoline_items ?? [])) urls.push(...((g as any)?.fileUrls ?? []))
    return urls
  }

  test('★編集で選んだ領収書が、保留の内容に実際に入る（本番で欠落していた）', async ({ page }) => {
    await openEdit(page)

    // 駐車場代の明細カードに領収書を添付する
    const pk = page.locator('.veh-subexpense .lineitem-card').first()
    await expect(pk).toBeVisible({ timeout: 20000 })
    await pk.locator('input[type="file"]').first().setInputFiles(dummy)

    await page.getByTestId('edit-reason').fill('駐車場代の領収書 添付忘れ')
    await page.getByTestId('report-submit').click()

    // ★「送信できた」で判定しない。保留の中身に URL が入ったかで判定する。
    await expect.poll(async () => (await pendingReceiptUrls()).length, { timeout: 30000 })
      .toBeGreaterThan(0)

    const urls = await pendingReceiptUrls()
    expect(urls[0], '実体のあるURLになっている').toMatch(/^https?:\/\//)
  })

  test('★添付しなかった編集では、URLを勝手に作らない（付いたように見せない）', async ({ page }) => {
    await openEdit(page)
    await page.getByTestId('edit-reason').fill('金額だけ直す')
    await page.getByTestId('report-submit').click()

    await expect.poll(async () => {
      const rows = await restSrv(
        `daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=id`)
      return rows?.length ?? 0
    }, { timeout: 30000 }).toBeGreaterThan(0)

    expect(await pendingReceiptUrls(), '無いものを在るように見せない').toHaveLength(0)
  })
})
