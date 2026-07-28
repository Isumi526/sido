// ============================================================
//  admin.estimate-intake.spec.ts
//  見積Q5: 元請けからの案件受領登録・ステータス管理。
//
//  業務フロー（2026-07-27 認識合わせ §1）:
//    元請けから依頼受領 → 下請へ図面配布 → 見積回収 → 整理・検討 → 元請けへ提出
//    → 受注確定 → 現場へ昇華
//  本specは「入り口」＝受領登録と進捗管理を検証する。
//  Notion: 3aa0ff81c56b81f99bb2cdccdeee9399
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
let seq = 0
const projName = () => `E2E受領_${TS}_${++seq}`
let PROJ = ''

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E受領_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_project_attachments?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

async function openNewProject(page: any) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await page.locator('[data-testid="tab-intake"]').click()
}
const fetchProject = async (cols: string) => {
  const accountId = await getAccountId()
  const r = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=${cols}`)
  return r?.[0] ?? null
}

test('AC1: 依頼日・提出期限を登録できる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="intake-request-date"]').fill('2026-07-01')
  await page.locator('[data-testid="intake-request-date"]').dispatchEvent('change')
  await page.locator('[data-testid="intake-due-date"]').fill('2026-07-17')
  await page.locator('[data-testid="intake-due-date"]').dispatchEvent('change')
  await page.waitForTimeout(1500)

  await expect.poll(async () => {
    const p = await fetchProject('request_date,due_date')
    return `${p?.request_date}|${p?.due_date}`
  }, { timeout: 10000 }).toBe('2026-07-01|2026-07-17')
})

test('AC2: 提出期限までの残り日数がバッジで出て、超過すると警告色になる', async ({ page }) => {
  await openNewProject(page)
  // 明日が期限 → 「あと1日」
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.locator('[data-testid="intake-due-date"]').fill(iso(tomorrow))
  await page.locator('[data-testid="intake-due-date"]').dispatchEvent('change')
  const badge = page.locator('[data-testid="intake-due-badge"]')
  await expect(badge).toContainText('あと1日')
  await expect(badge).toHaveClass(/soon/)

  // 昨日が期限 → 超過
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  await page.locator('[data-testid="intake-due-date"]').fill(iso(yesterday))
  await page.locator('[data-testid="intake-due-date"]').dispatchEvent('change')
  await expect(badge).toContainText('期限を1日超過')
  await expect(badge).toHaveClass(/over/)
})

test('AC3: 失注にすると理由欄が出て保存され、削除せず残す旨が表示される', async ({ page }) => {
  await openNewProject(page)
  // 初期状態では理由欄は出ない
  await expect(page.locator('[data-testid="intake-lost-reason"]')).toHaveCount(0)

  await page.locator('[data-testid="intake-status"]').selectOption('lost')
  await page.waitForTimeout(1200)

  // 理由欄とアーカイブ方針の説明が出る（確認9: 削除せず単価の参考データとして残す）
  const reason = page.locator('[data-testid="intake-lost-reason"]')
  await expect(reason).toBeVisible()
  await expect(page.locator('[data-testid="intake-archive-note"]')).toContainText('削除せず残します')

  await reason.fill('他社が安かった')
  await reason.dispatchEvent('change')
  await page.waitForTimeout(1500)

  await expect.poll(async () => {
    const p = await fetchProject('status,lost_reason')
    return `${p?.status}|${p?.lost_reason}`
  }, { timeout: 10000 }).toBe('lost|他社が安かった')
})

test('AC4: 辞退も選べ、状態を戻すと理由がクリアされる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="intake-status"]').selectOption('declined')
  await page.waitForTimeout(1000)
  await page.locator('[data-testid="intake-lost-reason"]').fill('手が空かなかった')
  await page.locator('[data-testid="intake-lost-reason"]').dispatchEvent('change')
  await page.waitForTimeout(1500)
  await expect.poll(async () => (await fetchProject('status,lost_reason'))?.lost_reason, { timeout: 10000 })
    .toBe('手が空かなかった')

  // 対応中へ戻す → 状態と矛盾する理由は残さない
  await page.locator('[data-testid="intake-status"]').selectOption('draft')
  await page.waitForTimeout(1500)
  await expect.poll(async () => {
    const p = await fetchProject('status,lost_reason')
    return `${p?.status}|${p?.lost_reason ?? 'NULL'}`
  }, { timeout: 10000 }).toBe('draft|NULL')
})

test('AC5: 図面を添付でき、一覧に出て削除できる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: 'E2E図面.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%E2E test drawing\n'),
  })
  const list = page.locator('[data-testid="intake-att-list"]')
  await expect(list).toContainText('E2E図面.pdf', { timeout: 20000 })

  // DBにも登録されている
  const p = await fetchProject('id')
  await expect.poll(async () => {
    const a = await restSrv(`estimate_project_attachments?project_id=eq.${p.id}&select=name`)
    return a?.length ?? 0
  }, { timeout: 10000 }).toBe(1)

  // 削除
  page.once('dialog', d => d.accept())
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${p.id}&select=id`)
  await page.locator(`[data-testid="intake-att-del-${att[0].id}"]`).click()
  await expect.poll(async () => {
    const a = await restSrv(`estimate_project_attachments?project_id=eq.${p.id}&select=id`)
    return a?.length ?? 0
  }, { timeout: 10000 }).toBe(0)
})

test('AC6: 見積一覧に新しい状態ラベルが表示される', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="intake-status"]').selectOption('lost')
  await page.waitForTimeout(1500)

  await page.goto('/estimate-list', { waitUntil: 'networkidle' })
  const row = page.locator('tbody tr', { hasText: PROJ })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row).toContainText('失注')
})
