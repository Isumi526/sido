// ============================================================
//  admin.site-chat.spec.ts
//  現場ごとのチャット機能（①MVP: 認証済みユーザー間のテキストチャット・②ファイル共有）。
//  チャット一覧(/chats)から遷移するチャット詳細(/chats/:id)で、送信したメッセージが
//  一覧に表示され、他現場のメッセージは混ざらないことを検証する
//  （2026-07-11・2026-07-14 現場詳細タブ廃止→/chats/:idへ移動・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2E管理チャット現場A_${TS}`
const SITE_B = `E2E管理チャット現場B_${TS}`
let siteAId = ''
let siteBId = ''
let seedMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteAId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_A, active: true,
  }) }))[0].id
  siteBId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_B, active: true,
  }) }))[0].id
  seedMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteBId, sender_is_admin: false, sender_name: 'テスト作業員', body: `他現場メッセージadmin_${TS}`,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_messages?id=eq.${seedMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteBId}`, { method: 'DELETE' }).catch(() => {})
})

test('チャット詳細でメッセージを送信すると一覧に表示され、他現場のメッセージは混ざらない', async ({ page }) => {
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.page-title')).toContainText(SITE_A)

  const msgText = `E2E管理テストメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `他現場メッセージadmin_${TS}` })).toHaveCount(0)
})

test('チャット詳細から「現場設定へ」で現場詳細画面に遷移できる(2026-07-20)', async ({ page }) => {
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })
  await page.locator('[data-testid="chat-to-site-settings-link"]').click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteAId}$`), { timeout: 10000 })
  await expect(page.locator('h1')).toContainText(SITE_A)
})

test('チャットにファイル(PDF)を添付して送信すると、edge(site-chat-attachment-upload)経由でアップロードされファイルリンクとして表示される', async ({ page }) => {
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  await page.locator('[data-testid="chat-file-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/sample.pdf'))
  await expect(page.locator('.pending-file')).toContainText('sample.pdf')
  await page.locator('[data-testid="chat-send"]').click()

  const attLink = page.locator('.msg-attachment-file', { hasText: 'sample.pdf' })
  await expect(attLink).toBeVisible({ timeout: 15000 })
  await expect(attLink).toHaveAttribute('href', /^https?:\/\//)
})

test('ファイルをドラッグ&ドロップすると送信前プレビュー(pendingFile)に載る', async ({ page }) => {
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  const buffer = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample.pdf'))
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
    const file = new File([bytes], 'drag-drop-sample.pdf', { type: 'application/pdf' })
    dt.items.add(file)
    return dt
  }, buffer.toString('base64'))
  await page.locator('.chat-panel').dispatchEvent('dragover', { dataTransfer })
  await expect(page.locator('.drop-overlay')).toBeVisible()
  await page.locator('.chat-panel').dispatchEvent('drop', { dataTransfer })

  await expect(page.locator('.drop-overlay')).toHaveCount(0)
  await expect(page.locator('.pending-file')).toContainText('drag-drop-sample.pdf')
})

test('上限(15MB)を超えるファイルは送信前にクライアント側で弾かれ専用エラーが出る(アップロードもされない)', async ({ page }) => {
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  let dialogMessage = ''
  page.once('dialog', async (d) => { dialogMessage = d.message(); await d.accept() })
  let uploadCalled = false
  page.on('request', (req) => { if (req.url().includes('site-chat-attachment-upload')) uploadCalled = true })

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    const file = new File([new Uint8Array(20 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' })
    dt.items.add(file)
    return dt
  })
  await page.locator('.chat-panel').dispatchEvent('drop', { dataTransfer })
  await page.waitForTimeout(500)

  expect(dialogMessage).toContain('ファイルサイズが大きすぎます')
  await expect(page.locator('.pending-file')).toHaveCount(0)
  expect(uploadCalled).toBe(false)
})

test('画像は上限超過でも自動圧縮され送信できる(圧縮前20MB相当→圧縮後jpgとしてアップロード成功)', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  // 圧縮無しなら15MB上限に確実に引っかかる大きさの画像をcanvasで生成
  const dataTransfer = await page.evaluateHandle(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000; canvas.height = 3000
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 3000, 3000)
    grad.addColorStop(0, 'red'); grad.addColorStop(0.5, 'blue'); grad.addColorStop(1, 'green')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 3000, 3000)
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `hsl(${Math.random() * 360},100%,50%)`
      ctx.fillRect(Math.random() * 3000, Math.random() * 3000, 5, 5)
    }
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'big-photo.png', { type: 'image/png' }))
    return dt
  })
  await page.locator('.chat-panel').dispatchEvent('drop', { dataTransfer })
  await expect(page.locator('.pending-file')).toContainText('big-photo.jpg', { timeout: 10000 })

  await page.locator('[data-testid="chat-send"]').click()
  await expect(page.locator('.msg-attachment-img[alt="big-photo.jpg"]')).toBeVisible({ timeout: 15000 })
})

test('@入力で作業員候補が出て選択でき、送信するとメンション通知(site_chat_mentions)が作られる', async ({ page }) => {
  const accountId = await getAccountId()
  const mentionTargetName = `E2E管理メンション対象_${TS}`
  const target = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: mentionTargetName, role: 'site', active: true,
  }) }))[0]
  try {
    await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

    await page.locator('[data-testid="chat-input"]').pressSequentially(`@${mentionTargetName.slice(0, 8)}`)
    const item = page.locator('[data-testid="mention-item"]', { hasText: mentionTargetName })
    await expect(item).toBeVisible({ timeout: 10000 })
    await item.click()
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue(new RegExp(`@${mentionTargetName}`))

    await page.locator('[data-testid="chat-send"]').click()
    await expect(page.locator('.msg-body', { hasText: `@${mentionTargetName}` })).toBeVisible({ timeout: 10000 })

    const mentions = await restSrv(`site_chat_mentions?worker_id=eq.${target.id}&select=id,read_at`)
    expect(mentions.length).toBeGreaterThan(0)
    expect(mentions[0].read_at).toBeNull()
  } finally {
    await restSrv(`site_chat_mentions?worker_id=eq.${target.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${target.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('@allを選択して送信すると、その時点のaccount内の全アクティブworker宛にメンション通知が作られる', async ({ page }) => {
  const accountId = await getAccountId()
  const activeWorkers = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id`)
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  await page.locator('[data-testid="chat-input"]').pressSequentially('@')
  const allItem = page.locator('[data-testid="mention-item"]', { hasText: '@ALL（全員）' })
  await expect(allItem).toBeVisible({ timeout: 10000 })
  await allItem.click()
  await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('@ALL ')

  const msgText = `全員宛テスト_${TS}`
  await page.locator('[data-testid="chat-input"]').pressSequentially(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  const bodyLocator = page.locator('.msg-body', { hasText: msgText })
  await expect(bodyLocator).toBeVisible({ timeout: 10000 })
  await expect(bodyLocator.locator('.msg-mention', { hasText: '@ALL' })).toBeVisible()

  const [msg] = await restSrv(`site_chat_messages?site_id=eq.${siteAId}&body=eq.${encodeURIComponent(`@ALL ${msgText}`)}&select=id`)
  const mentions = await restSrv(`site_chat_mentions?message_id=eq.${msg.id}&select=worker_id`)
  expect(mentions.length).toBe(activeWorkers.length)
  await restSrv(`site_chat_mentions?message_id=eq.${msg.id}`, { method: 'DELETE' }).catch(() => {})
})

test('入力欄は改行に応じて自動的に高さが伸びる（メンション入力を伴わない通常メッセージでも・回帰防止）', async ({ page }) => {
  // #2026-07-13: onDraftInput()内のautoResizeDraft()呼び出しが「@メンション無し」時のearly return
  // より後ろにあり、メンションを含まない通常のメッセージでは一切リサイズされない不具合があった。
  await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })

  const input = page.locator('[data-testid="chat-input"]')
  const before = await input.evaluate((el: HTMLTextAreaElement) => el.offsetHeight)
  await input.pressSequentially('1行目\n2行目\n3行目\n4行目')
  const after = await input.evaluate((el: HTMLTextAreaElement) => el.offsetHeight)
  expect(after).toBeGreaterThan(before)
})

test('バルーン長押し→リプライで返信でき、送信メッセージに引用が付く(2026-07-20)', async ({ page }) => {
  const accountId = await getAccountId()
  const origMsg = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteAId, sender_is_admin: false, sender_name: 'テスト作業員', body: `リプライ元_admin_${TS}`,
  }) }))[0]
  try {
    await page.goto(`/chats/${siteAId}`, { waitUntil: 'networkidle' })
    const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `リプライ元_admin_${TS}` })
    await expect(bubble).toBeVisible({ timeout: 10000 })
    const box = await bubble.boundingBox()
    if (!box) throw new Error('bubble not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()

    const menu = page.locator('[data-testid="ctx-menu"]')
    await expect(menu).toBeVisible()
    await expect(menu.locator('button')).toHaveCount(2)
    await page.locator('[data-testid="ctx-reply"]').click()
    await expect(page.locator('[data-testid="reply-preview"]')).toContainText(`リプライ元_admin_${TS}`)

    const replyText = `返信_admin_${TS}`
    await page.locator('[data-testid="chat-input"]').fill(replyText)
    await page.locator('[data-testid="chat-send"]').click()

    const newRow = page.locator('.msg-row', { hasText: replyText })
    await expect(newRow).toBeVisible({ timeout: 10000 })
    await expect(newRow.locator('.reply-quote-text')).toContainText(`リプライ元_admin_${TS}`)
  } finally {
    await restSrv(`site_chat_messages?id=eq.${origMsg.id}`, { method: 'DELETE' }).catch(() => {})
  }
})
