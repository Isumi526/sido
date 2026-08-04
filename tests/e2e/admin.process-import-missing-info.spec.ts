// ============================================================
//  admin.process-import-missing-info.spec.ts
//  工程表インポート: 取り込み結果の情報不足を検知して分かるようにする
//   - AI解析が読み取れなかった項目（開始日/終了日/工程名/現場名）を取込前に一覧で出す
//   - ★情報不足があっても取込自体はブロックしない（AC2）
//   - ★工程名が空の行だけは process_tasks.name の NOT NULL に弾かれ「取込全体」が
//     失敗するため、事前に予告して当該行のみ除外する（黙って全部落とさない）
//  ※AI解析(EF)はレスポンスをモックして決定的にする。実Geminiだと欠損を再現できないため。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, ensureResponsibleWorkerId } from './helpers'

const TS = Date.now()
const SITE = `E2E不足検知現場_${TS}`
let siteId = ''
let accountId = ''

/** EF(test-process-excel-import) のレスポンスを差し替える。欠損入りの解析結果を返す */
async function mockAnalyze(page: any, tasks: any[]) {
  await page.route('**/test-process-excel-import', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, tasks }),
    })
  })
}

/** Excelファイルに見えるダミーをドロップする（中身はEFをモックしているので読まれない） */
async function dropDummyXlsx(page: any) {
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer()
    d.items.add(new File([new Uint8Array([1, 2, 3])], 'dummy.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    return d
  })
  await page.locator('.import-drop').dispatchEvent('drop', { dataTransfer: dt })
}

test.describe('工程表インポートの情報不足検知', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const resp = await ensureResponsibleWorkerId(accountId)
    siteId = (await rest('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: resp }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★読み取れなかった項目（開始日/終了日）が取込前に一覧で出る', async ({ page }) => {
    await mockAnalyze(page, [
      { name: '完全な工程', site_name: SITE, start_date: '2026-09-01', end_date: '2026-09-05', assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
      { name: '開始日が読めない工程', site_name: SITE, start_date: null, end_date: '2026-09-10', assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
      { name: '両方読めない工程', site_name: SITE, start_date: null, end_date: null, assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
    ])

    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.btn-import').click()
    await dropDummyXlsx(page)

    await expect(page.locator('[data-testid="import-review"]')).toBeVisible({ timeout: 30000 })

    // ★全体バナーに不足の内訳が出る
    const note = page.getByTestId('import-missing-note')
    await expect(note, '情報不足の告知が出る').toBeVisible()
    await expect(note, '開始日の不足件数').toContainText('開始日 2件')
    await expect(note, '終了日の不足件数').toContainText('終了日 1件')
    await expect(note, '取込はブロックされないと伝える').toContainText('取込自体は可能')

    // ★行ごとにも不足が出て、どの工程か辿れる
    const cell = page.getByTestId('import-issue-0')
    await expect(cell).toContainText('開始日 2件')
    await cell.locator('details > summary').click()
    await expect(cell).toContainText('開始日が読めない工程')
    await expect(cell).toContainText('両方読めない工程')
  })

  test('★情報不足があっても取込はブロックされない（日付が空でも保存される）', async ({ page }) => {
    await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await mockAnalyze(page, [
      { name: `日付なし工程_${TS}`, site_name: SITE, start_date: null, end_date: null, assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
    ])
    page.on('dialog', (d) => d.accept().catch(() => {}))

    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.btn-import').click()
    await dropDummyXlsx(page)
    await expect(page.locator('[data-testid="import-review"]')).toBeVisible({ timeout: 30000 })

    await page.getByTestId('import-target-0').selectOption(siteId)
    await page.getByTestId('import-run').click()

    await expect.poll(async () => {
      const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name,start_date`)
      return rows?.length ?? 0
    }, { timeout: 20000 }).toBe(1)

    const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name,start_date`)
    expect(rows[0].name, '日付が空でも取り込まれる').toBe(`日付なし工程_${TS}`)
    expect(rows[0].start_date, '空の日付は null で入る').toBeNull()
  })

  // ★工程名が空の行を素通しすると NOT NULL 制約で insert 全体が落ち、
  //   「情報不足のせいで1件も取り込めない」状態になる。予告して当該行だけ落とす。
  test('★工程名が空の行は予告のうえ除外され、他の工程は取り込まれる', async ({ page }) => {
    await restSrv(`process_tasks?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await mockAnalyze(page, [
      { name: `名前あり工程_${TS}`, site_name: SITE, start_date: '2026-09-01', end_date: '2026-09-02', assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
      { name: '', site_name: SITE, start_date: '2026-09-03', end_date: '2026-09-04', assignee: null, site_manager: null, work_type: null, contract_amount: null, memo: null },
    ])
    const dialogs: string[] = []
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}) })

    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.btn-import').click()
    await dropDummyXlsx(page)
    await expect(page.locator('[data-testid="import-review"]')).toBeVisible({ timeout: 30000 })

    // ★取り込めない行があることを事前に予告する
    await expect(page.getByTestId('import-blocked-note'), '取り込めない行を事前に予告').toContainText('1件')

    await page.getByTestId('import-target-0').selectOption(siteId)
    await page.getByTestId('import-run').click()

    await expect.poll(async () => {
      const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name`)
      return rows?.length ?? 0
    }, { timeout: 20000 }).toBe(1)

    const rows = await restSrv(`process_tasks?site_id=eq.${siteId}&select=name`)
    expect(rows[0].name, '★名前のある工程は取り込まれる（全体が失敗しない）').toBe(`名前あり工程_${TS}`)
    expect(dialogs.join(' '), '完了時に除外件数を伝える').toContain('1件は取り込めませんでした')
  })
})
