// ============================================================
//  plugins/sw-open-url.client.ts
//  スマホ通知を押した時、その通知の押し先ページへ確実に移動させる。
//
//  ★2026-09-27（実機で「通知を押してもアプリが開くだけ」）: iPhone のホーム画面アプリは
//   - 開いている最中に押すと、アプリが前に出るだけでページが移動しないことがある
//   - 止められていたアプリを通知から起動すると、押し先ではなく前回（または最初）のページで開くことがある
//   ので、Service Worker（public/sw-push.js）の移動だけに頼らない。
//   (1) SW から「このページを開いて」と伝えられたら移動する
//   (2) 起動時・前に出た時に、SW が置いた「押し先の置き手紙」（Cache Storage）を読み、2分以内なら移動する
//   移動先は同じドメインの URL だけ受け付ける（/admin/... は管理画面なので、画面ごと読み込み直す）。
// ============================================================
const OPEN_CACHE = 'push-open-url'
const OPEN_KEY = '/__push_open_url'
const MAX_AGE_MS = 2 * 60 * 1000

function go(url: string) {
  let target: URL
  try { target = new URL(url, window.location.origin) } catch { return }
  if (target.origin !== window.location.origin) return
  if (target.href !== window.location.href) window.location.assign(target.href)
}

async function takeLeftUrl(): Promise<string | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(OPEN_CACHE)
    const res = await cache.match(OPEN_KEY)
    if (!res) return null
    await cache.delete(OPEN_KEY)   // 1回だけ使う（次に普通に開いた時に飛ばない）
    const { url, at } = await res.json() as { url?: string; at?: number }
    if (typeof url !== 'string' || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null
    return url
  } catch { return null }
}

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null
      if (data && data.type === 'open-url' && typeof data.url === 'string') {
        takeLeftUrl().finally(() => go(data.url as string))   // 置き手紙も同時に片付ける
      }
    })
  }

  const check = () => { takeLeftUrl().then((u) => { if (u) go(u) }) }
  check()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
})
