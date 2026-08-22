// ============================================================
//  admin.estimate-review5.spec.ts
//  2026-07-30 ユーザー通しレビュー（第5回）で出た5点
//   R51 新規見積の入口をステップ式に（図面が最初・案件名はファイル名から自動）
//   R52 押した時点でDBに保存しURLにIDを持たせる（ブラウザバックで入力が消える）
//   R53 材料抽出を並行処理に（進捗・バッジ通知・中断からの再開）
//   R54 明細入力ページの既定タブを案件情報に
//   R55 元請け（担当者含む）のマスタを見積の画面内で編集
//
//  ★解析AI(Gemini)は非決定・課金されるので呼ばない。EFの応答を差し替えて
//   「進捗が出る／画面を移っても続く／中断から再開できる」を決定的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const NAME_PREFIX = `E2Eレビュー5_${TS}`

/** ページ番号入りの最小PDF */
function makePdf(pages: number): Buffer {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

/** このテストが作った案件（下書きの仮名も含む）を消す */
async function cleanupProjects(ids: string[]) {
  for (const id of ids) {
    await restSrv(`estimate_drawing_extract_jobs?project_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_items?project_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_project_attachments?project_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
}
const created: string[] = []
test.afterAll(async () => {
  await cleanupProjects(created)
  const accountId = await getAccountId()
  // 名前を確定させたもの／確定させずに残った下書きの後片付け
  for (const like of [`${NAME_PREFIX}%`, '（案件名未入力）%']) {
    const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent(like)}&select=id`).catch(() => [])
    await cleanupProjects((pj ?? []).map((p: any) => p.id))
  }
  const cs = await restSrv(`contractors?account_id=eq.${accountId}&name=like.${encodeURIComponent(NAME_PREFIX + '%')}&select=id`).catch(() => [])
  for (const c of (cs ?? [])) {
    await restSrv(`contractor_contacts?contractor_id=eq.${c.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`contractors?id=eq.${c.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

/** 一覧から「＋新規見積」を押す。押した時点で案件が作られ、URLにIDが入るのが仕様（R52） */
async function pressNewEstimate(page: any): Promise<string> {
  await page.goto('/estimate-list', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-estimate"]').click()
  await expect(page.locator('[data-testid="wizard"]')).toBeVisible({ timeout: 20000 })
  const url = new URL(page.url())
  const id = url.searchParams.get('project') ?? ''
  expect(id, '★押した時点でURLに案件IDが入る（これが無いと戻った時に入力が消える）').toMatch(/^[0-9a-f-]{36}$/)
  created.push(id)
  return id
}

// ── R52: 押した時点でDBに保存し、URLにIDを持たせる ──────────────
test('AC1★(R52): 「＋新規見積」を押した時点でDBに行ができ、URLにIDが入る', async ({ page }) => {
  const id = await pressNewEstimate(page)
  const pj = await restSrv(`estimate_projects?id=eq.${id}&select=id,name,is_draft`)
  expect(pj.length, 'DBに案件が1件できている').toBe(1)
  expect(pj[0].is_draft, '案件名が未確定なので下書き').toBe(true)
  expect(pj[0].name, '仮名は人が見て未入力と分かる形').toContain('案件名未入力')
})

test('AC2★(R52): 図面を入れてから別画面に移り、ブラウザバックで戻っても図面が消えない', async ({ page }) => {
  const id = await pressNewEstimate(page)
  // ステップ1で図面を入れる（＝この時点で案件に紐づいて保存される）
  await page.locator('[data-testid="wiz-file"]').setInputFiles({
    name: `${NAME_PREFIX}_実施図面.pdf`, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="wiz-att-list"]')).toContainText('実施図面.pdf', { timeout: 20000 })

  // 担当者マスタを直しに行って戻る、という実際の操作（これで入力が消えていた）。
  // ナビのリンク＝アプリ内遷移 → ブラウザバック、が報告された操作そのもの。
  await page.locator('a[href="/contractors"]').first().click()
  await expect(page.locator('h1')).toContainText('元請け', { timeout: 15000 })
  await page.goBack()

  expect(new URL(page.url()).searchParams.get('project'), '戻ってもURLに案件IDが残る').toBe(id)
  await expect(page.locator('[data-testid="wiz-att-list"]')).toContainText('実施図面.pdf', { timeout: 20000 })
})

test('AC3(R52): 下書きは一覧で「下書き」と分かり、削除できる', async ({ page }) => {
  const id = await pressNewEstimate(page)
  await page.goto('/estimate-list', { waitUntil: 'networkidle' })
  await expect(page.locator(`[data-testid="estimate-draft-${id}"]`)).toBeVisible({ timeout: 15000 })
  page.once('dialog', (d: any) => d.accept())
  await page.locator(`[data-testid="estimate-del-${id}"]`).click()
  await expect.poll(async () => (await restSrv(`estimate_projects?id=eq.${id}&select=id`)).length,
    { timeout: 15000 }).toBe(0)
})

// ── R51: ステップ式の入口 ─────────────────────────────────
test('AC4★(R51): 最初のステップが図面で、案件名が図面のファイル名から自動で入る', async ({ page }) => {
  const id = await pressNewEstimate(page)
  // ステップ1＝図面（案件名を先に要求しない）
  await expect(page.locator('[data-testid="wiz-panel-1"]')).toBeVisible()
  await expect(page.locator('[data-testid="wiz-step-1"]')).toHaveClass(/on/)

  // 実ファイル名の形（先頭に日付・末尾に書類名）を投げる
  await page.locator('[data-testid="wiz-file"]').setInputFiles({
    name: `0603　${NAME_PREFIX}銀座リシャール見積もり.pdf`, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="wiz-att-list"]')).toContainText('銀座リシャール', { timeout: 20000 })
  await page.locator('[data-testid="wiz-next-1"]').click()

  // ★案件名が自動で入っている（先頭の日付と末尾の「見積もり」は落ち、案件名だけ残る）
  const nameBox = page.locator('[data-testid="wiz-name"]')
  await expect(nameBox).toHaveValue(/銀座リシャール$/)
  const auto = await nameBox.inputValue()
  expect(auto, '先頭の日付は落ちる').not.toContain('0603')
  expect(auto, '書類名は落ちる').not.toContain('見積')

  // 後から直せる
  const fixed = `${auto}改`
  await nameBox.fill(fixed)
  await page.locator('[data-testid="wiz-next-2"]').click()
  await expect(page.locator('[data-testid="wiz-panel-3"]')).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => {
    const pj = await restSrv(`estimate_projects?id=eq.${id}&select=name,is_draft`)
    return `${pj[0].name}/${pj[0].is_draft}`
  }, { timeout: 15000 }).toBe(`${fixed}/false`)
})

test('★ステップタブを押して行き来でき、2から離れても打った案件名が消えない', async ({ page }) => {
  // 2026-08-19 大塚さん向け通しレビュー: 「ステップタブをクリックで各ステップに移動できてもいい」
  // ★危ないのは案件名。以前は「次へ」を押した時だけ保存していたので、
  //  タブで飛べるようにすると打った名前が黙って消える。それを起こさないことを固定する。
  const id = await pressNewEstimate(page)
  await page.locator('[data-testid="wiz-skip-1"]').click()
  await expect(page.locator('[data-testid="wiz-panel-2"]')).toBeVisible()

  const NAME = `${NAME_PREFIX}タブ移動テスト`
  await page.locator('[data-testid="wiz-name"]').fill(NAME)

  // ステップ2 → 4 へタブで直接飛ぶ（「次へ」を押さない）
  await page.locator('[data-testid="wiz-step-4"]').click()
  await expect(page.locator('[data-testid="wiz-panel-4"]')).toBeVisible()

  // ★離れる時に保存されている
  await expect.poll(async () => {
    const pj = await restSrv(`estimate_projects?id=eq.${id}&select=name`)
    return pj[0]?.name
  }, { timeout: 15000 }).toBe(NAME)

  // 戻るのもタブでできる。入力値も残っている
  await page.locator('[data-testid="wiz-step-2"]').click()
  await expect(page.locator('[data-testid="wiz-panel-2"]')).toBeVisible()
  await expect(page.locator('[data-testid="wiz-name"]')).toHaveValue(NAME)
})

test('AC5(R51): 各ステップをスキップでき、終えると案件情報タブが開く', async ({ page }) => {
  await pressNewEstimate(page)
  await page.locator('[data-testid="wiz-skip-1"]').click()   // 図面は後で
  await expect(page.locator('[data-testid="wiz-panel-2"]')).toBeVisible()
  await page.locator('[data-testid="wiz-skip-2"]').click()   // 案件名も後で
  await expect(page.locator('[data-testid="wiz-panel-3"]')).toBeVisible()
  await page.locator('[data-testid="wiz-skip-3"]').click()   // 期限は未定
  await expect(page.locator('[data-testid="wiz-panel-4"]')).toBeVisible()
  await page.locator('[data-testid="wiz-skip-4"]').click()   // 元請けも後で

  // ステップ入力が終わると通常のタブ表示に戻り、案件情報タブが開いている（R54）
  await expect(page.locator('[data-testid="wizard"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="intake-request-date"]')).toBeVisible({ timeout: 15000 })
  expect(new URL(page.url()).searchParams.get('step'), 'URLからstepが落ちる').toBeNull()
})

// ── R54: 既定タブ ──────────────────────────────────────
test('AC6(R54): 既存の案件を開いた時も既定タブは案件情報', async ({ page }) => {
  const accountId = await getAccountId()
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: `${NAME_PREFIX}_既定タブ` }),
  })
  created.push(pj[0].id)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="tab-intake"]')).toHaveClass(/active/, { timeout: 15000 })
  await expect(page.locator('[data-testid="intake-request-date"]')).toBeVisible()
})

// ── R55: 元請け・担当者をこの画面で編集 ────────────────────────
test('AC7★(R55): 元請けが無くても画面内で追加でき、その場で案件に紐づく', async ({ page }) => {
  const accountId = await getAccountId()
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: `${NAME_PREFIX}_元請け追加` }),
  })
  created.push(pj[0].id)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })

  const CON = `${NAME_PREFIX}元請け`
  await page.locator('[data-testid="con-add-open"]').click()
  await expect(page.locator('[data-testid="con-modal"]')).toBeVisible()
  await page.locator('[data-testid="con-name"]').fill(CON)
  await page.locator('[data-testid="con-contact-name-0"]').fill('現場 太郎')
  await page.locator('[data-testid="con-contact-email-0"]').fill('taro@example.com')
  await page.locator('[data-testid="con-save"]').click()

  // ★画面遷移しない（見積の画面に居たまま）／追加した瞬間に選択肢へ入り、この案件の元請けになる
  await expect(page.locator('[data-testid="con-modal"]')).toHaveCount(0, { timeout: 20000 })
  expect(page.url(), '別の画面に飛ばされていない').toContain('/estimate-builder')
  await expect(page.locator('[data-testid="project-contractor"]')).toHaveValue(/[0-9a-f-]{36}/, { timeout: 15000 })
  await expect.poll(async () => {
    const p = await restSrv(`estimate_projects?id=eq.${pj[0].id}&select=contractor_id`)
    return p[0].contractor_id ? 'linked' : 'none'
  }, { timeout: 15000 }).toBe('linked')

  // 担当者も同じ画面から編集できる（追加した担当者が入っている）
  await page.locator('[data-testid="con-edit-open"]').click()
  await expect(page.locator('[data-testid="con-contact-name-0"]')).toHaveValue('現場 太郎')
})

// AC8/AC9/AC10（図面抽出の進捗・再開・部分失敗）は、材料抽出を見積ビルダーから
// 切り離した2026-08-21の変更で対象UIごと削除したため、本ファイルから除外した。
// 材料抽出そのものは独立ページ /drawing-materials 側で継続。
