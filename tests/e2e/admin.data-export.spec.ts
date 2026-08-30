// ============================================================
//  admin.data-export.spec.ts
//  会社アカウント単位の全データ一括エクスポート（契約対応③）
//
//  ★なぜ要るか: 契約 別紙1§10 が「勤怠・日報・経費・台帳・取引先をCSV一括出力できる」と
//   書いているのに、実装は画面ごとのCSV/ZIPしか無く、契約と実態がズレていた。
//   解約時・利用停止中のデータ取得権（労基法109条の保存義務）への布石でもある。
//
//  ★このテストが守ること:
//   1. 実際にZIPが落ちてくる（画面だけ作って動かない、を防ぐ）
//   2. 他テナントのデータが混ざらない（一番まずい失敗）
//   3. 中身が空にならない（取得の上限で黙って切れていないか）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

let accountId = ''
let otherAccountId = ''
const OTHER_SITE = `E2E他社現場_${Date.now()}`

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 別テナントに、名前で見分けられる現場を1つ置く（混ざったら分かるように）
  const acc = await restSrv('accounts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slug: `e2e-exp-${Date.now()}`, name: 'E2Eエクスポート別テナント' }),
  })
  otherAccountId = acc[0].id
  await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: otherAccountId, name: OTHER_SITE, active: true }),
  })
})

test.afterAll(async () => {
  await restSrv(`sites?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
})

test('★ZIPが実際に落ちてきて、他テナントのデータが混ざらない', async ({ page }) => {
  await page.goto('/data-export', { waitUntil: 'networkidle' })

  const run = page.getByTestId('export-run')
  await expect(run, 'ダウンロードのボタンが出る（オーナー権限）').toBeVisible({ timeout: 15000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    run.click(),
  ])
  const path = await download.path()
  expect(path, '★ZIPが実際に落ちてくる').toBeTruthy()

  // ★jszip は admin 側の依存で、テスト側からは import できない。
  //  OSの unzip でほどいて中身を見る（環境に依存するが macOS/Linux には標準で入っている）。
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'e2e-export-'))
  execFileSync('unzip', ['-o', '-q', path!, '-d', dir])

  const { readdirSync, readFileSync } = await import('node:fs')
  const names = readdirSync(dir)
  expect(names.length, '中身がある').toBeGreaterThan(1)
  // ★ファイル名は英字。日本語のファイル名を入れると標準の解凍ソフトで文字化け・展開失敗する
  //  （実際にこのテストが展開できず発覚した）。何のファイルかは _index.csv で対応づける。
  expect(names.some(n => n === 'daily_reports.csv'), '日報のCSVが入る').toBe(true)
  expect(names.some(n => n === '_index.csv'), '何がどれだけ入っているかの一覧が入る').toBe(true)
  expect(names.every(n => /^[\w.-]+$/.test(n)), '★ファイル名に日本語を使わない（解凍で壊れる）').toBe(true)

  // ★他テナントの現場名が1文字も混ざっていないこと
  for (const n of names) {
    const text = readFileSync(join(dir, n), 'utf8')
    expect(text.includes(OTHER_SITE), `★他テナントのデータが混ざっている: ${n}`).toBe(false)
  }

  // 現場のCSVは自社ぶんが入っているはず（空のZIPを「成功」と誤認しない）
  const siteFile = names.find(n => n === 'sites.csv')
  expect(siteFile, '現場のCSVがある').toBeTruthy()
  const siteCsv = readFileSync(join(dir, siteFile!), 'utf8')
  expect(siteCsv.split('\n').length, '現場が1件以上入っている').toBeGreaterThan(1)
})
