// ============================================================
//  admin.faq-ai-review-badge.spec.ts
//  AIヘルプのナレッジ(FAQ)をFableに定期生成させる（2026-08-30運用者判断）:
//   - faq-generate EF が作った下書き(source='ai-fable'・is_active=false)は
//     FAQ画面で「AI生成・レビュー待ち」バッジとして分かるようにする
//     （人が手動で無効化しただけの行と区別する＝誤って放置しない）。
//   - faq-generate 本体（Notion/Gemini 呼び出し）は外部APIキーが要るため、
//     このE2Eでは対象にしない（EFのロジックはローカルで手動検証済み・
//     Notionレビューチケットの起票・重複起票防止・is_active=falseでの
//     挿入まで実データで確認済み）。ここではFAQ画面側の見え方だけを担保する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const AI_Q = `AI生成質問_${TS}`
const MANUAL_Q = `手動無効化質問_${TS}`
const TICKET_URL = 'https://app.notion.com/p/dummy-review-ticket'

let aiId = ''
let manualId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const [ai] = await restSrv('faq_entries', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, question: AI_Q, answer: 'AI生成の回答です',
      is_active: false, source: 'ai-fable', notion_ticket_url: TICKET_URL,
    }),
  })
  aiId = ai.id
  const [manual] = await restSrv('faq_entries', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, question: MANUAL_Q, answer: '人が作って無効化した回答', is_active: false }),
  })
  manualId = manual.id
})

test.afterAll(async () => {
  await restSrv(`faq_entries?id=in.(${aiId},${manualId})`, { method: 'DELETE' }).catch(() => {})
})

test('★AI生成の下書きだけ「AI生成・レビュー待ち」バッジが出る（手動無効化とは区別する）', async ({ page }) => {
  await page.goto('/faq', { waitUntil: 'networkidle' })
  await page.locator('.search').fill(TS.toString())

  const aiRow = page.locator('tr', { hasText: AI_Q })
  await expect(aiRow).toBeVisible({ timeout: 10000 })
  const badge = aiRow.getByTestId('faq-ai-review-badge')
  await expect(badge, '★AI生成の下書きにはレビュー待ちバッジが出る').toBeVisible()
  await expect(badge).toHaveAttribute('href', TICKET_URL)

  const manualRow = page.locator('tr', { hasText: MANUAL_Q })
  await expect(manualRow).toBeVisible()
  await expect(manualRow.getByTestId('faq-ai-review-badge'), '★手動で無効化しただけの行にはバッジを出さない').toHaveCount(0)
})

test('AI生成の下書きを「有効」にすると、レビュー待ちバッジが消える', async ({ page }) => {
  await page.goto('/faq', { waitUntil: 'networkidle' })
  await page.locator('.search').fill(TS.toString())

  const aiRow = page.locator('tr', { hasText: AI_Q })
  await aiRow.getByRole('button', { name: '編集' }).click()
  const modal = page.locator('.modal-overlay')
  await modal.getByRole('button', { name: '有効' }).click()
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal).toBeHidden({ timeout: 8000 })

  await expect(aiRow.getByTestId('faq-ai-review-badge'), '★有効化するとバッジが消える').toHaveCount(0)
})
