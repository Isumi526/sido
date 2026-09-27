// ============================================================
//  liff.push-open-url.spec.ts
//  スマホ通知を押した先のページへ、アプリ側が確実に移動する（plugins/sw-open-url.client.ts）。
//
//  ★2026-09-27 実機: iPhone のホーム画面アプリで通知を押しても、アプリが開くだけで押し先に移動しなかった。
//   Service Worker（public/sw-push.js）は押された時に押し先を Cache Storage に「置き手紙」として残し、
//   アプリは起動時・前に出た時にそれを読んで移動する。ここではアプリ側の読み取りを固定する
//   （notificationclick 自体はブラウザの自動操作では起こせないので、置き手紙を直接置いて確かめる）。
// ============================================================
import { test, expect } from './liff-test'

const OPEN_CACHE = 'push-open-url'
const OPEN_KEY = '/__push_open_url'

async function leave(page: import('@playwright/test').Page, path: string, ageMs = 0) {
  await page.evaluate(async ({ cacheName, key, path, ageMs }) => {
    const cache = await caches.open(cacheName)
    const url = new URL(path, location.origin).href
    await cache.put(key, new Response(JSON.stringify({ url, at: Date.now() - ageMs }), { headers: { 'Content-Type': 'application/json' } }))
  }, { cacheName: OPEN_CACHE, key: OPEN_KEY, path, ageMs })
}
async function hasNote(page: import('@playwright/test').Page) {
  return page.evaluate(async ({ cacheName, key }) => !!(await (await caches.open(cacheName)).match(key)), { cacheName: OPEN_CACHE, key: OPEN_KEY })
}

test('★通知の置き手紙があれば、アプリを開いた時に押し先のページへ移動し、置き手紙は1回で消える', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await leave(page, '/notifications')
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page, '押し先へ移動する').toHaveURL(/\/notifications$/, { timeout: 15000 })
  expect(await hasNote(page), '置き手紙は読んだら消える').toBe(false)

  // 次に普通に開いた時は移動しない
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await expect(page).not.toHaveURL(/\/notifications$/)
})

test('前に出た時（visibilitychange）にも置き手紙を読んで移動する', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await leave(page, '/calendar')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page).toHaveURL(/\/calendar/, { timeout: 15000 })
})

test('2分より古い置き手紙では移動しない（あとで普通に開いた時に飛ばない）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await leave(page, '/notifications', 3 * 60 * 1000)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await expect(page).not.toHaveURL(/\/notifications$/)
  expect(await hasNote(page), '古い置き手紙も片付く').toBe(false)
})
