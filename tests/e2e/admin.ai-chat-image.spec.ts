// ============================================================
//  admin.ai-chat-image.spec.ts
//  AIチャット（admin > AIヘルプ）の画像添付:
//   - 複数枚を添付でき、送信前に1枚ずつ外せる
//   - 画像以外・サイズ超過・枚数超過は黙って落とさず理由を出す
//   - 画像は EF へ base64(inlineData用) で渡り、吹き出しにも表示される
//   - ★本文が空でも画像だけで送信できる（スクショを貼って「これ何？」の使い方）
//  ※ ai-chat EF は page.route でスタブする（実AIを叩かない）。
// ============================================================
import { test, expect } from '@playwright/test'

// 1x1 png（透明）
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** ai-chat をスタブし、EFが受け取った payload を記録する */
async function stubAiChat(page: import('@playwright/test').Page, seen: any[]) {
  await page.route('**/functions/v1/ai-chat', async (route) => {
    try { seen.push(JSON.parse(route.request().postData() ?? '{}')) } catch { seen.push(null) }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, answer: '画像を受け取りました。', isBug: false }),
    })
  })
}

const img = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') })

test.describe('AIチャットの画像添付', () => {
  test('複数枚を添付でき、1枚ずつ外せる', async ({ page }) => {
    await page.goto('/ai-help', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('ai-attach-input')).toBeAttached({ timeout: 10000 })

    await page.getByTestId('ai-attach-input').setInputFiles([img('a.png'), img('b.png'), img('c.png')])
    const strip = page.getByTestId('ai-attach-strip')
    await expect(strip.locator('.attach-item'), '3枚が並ぶ').toHaveCount(3)

    await strip.locator('.attach-remove').first().click()
    await expect(strip.locator('.attach-item'), '1枚外せる').toHaveCount(2)
  })

  test('画像以外と枚数超過は理由を出して弾く（黙って落とさない）', async ({ page }) => {
    await page.goto('/ai-help', { waitUntil: 'networkidle' })
    await page.getByTestId('ai-attach-input').setInputFiles([
      { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    ])
    await expect(page.getByTestId('ai-attach-error'), '画像以外は理由が出る').toContainText('画像以外')
    await expect(page.getByTestId('ai-attach-strip')).toHaveCount(0)

    // 上限4枚 → 5枚目は弾かれる
    await page.getByTestId('ai-attach-input').setInputFiles(
      ['1', '2', '3', '4', '5'].map((n) => img(`${n}.png`)))
    await expect(page.getByTestId('ai-attach-strip').locator('.attach-item')).toHaveCount(4)
    await expect(page.getByTestId('ai-attach-error')).toContainText('上限4枚')
  })

  test('★画像は base64 で EF に渡り、吹き出しにも出る（本文が空でも送れる）', async ({ page }) => {
    const seen: any[] = []
    await stubAiChat(page, seen)
    await page.goto('/ai-help', { waitUntil: 'networkidle' })

    // 本文なし・画像だけで送信ボタンが有効になる
    await expect(page.getByTestId('ai-send'), '添付前は押せない').toBeDisabled()
    await page.getByTestId('ai-attach-input').setInputFiles([img('shot.png'), img('shot2.png')])
    await expect(page.getByTestId('ai-send'), '画像だけでも送れる').toBeEnabled()
    await page.getByTestId('ai-send').click()

    await expect(page.locator('.msg.ai .bubble').last()).toContainText('画像を受け取りました', { timeout: 15000 })

    // EF に渡った payload を検証
    expect(seen.length, 'EFが呼ばれた').toBeGreaterThan(0)
    const payload = seen[seen.length - 1]
    expect(Array.isArray(payload.images), 'images配列で渡る').toBe(true)
    expect(payload.images.length, '2枚とも渡る').toBe(2)
    expect(payload.images[0].mimeType).toBe('image/png')
    expect(payload.images[0].data, 'base64本体（data: URLの接頭辞は含めない）').toBe(PNG_1x1)

    // 送信後は添付欄が空になり、自分の吹き出しに画像が出る
    await expect(page.getByTestId('ai-attach-strip')).toHaveCount(0)
    await expect(page.locator('.msg.user .bubble-img')).toHaveCount(2)
  })
})
