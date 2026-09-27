// ============================================================
//  sw-push.js — 現場チャットの新着を通知する Service Worker
//
//  ★これは public/ に置く素の JS（バンドルされない）。SW は自分自身のURLを
//   スコープの基準にするので、ルート直下に置いてサイト全体をスコープにする。
//
//  ★動く環境は限られる（承知の上）: LINE webview では push の土台に乗らない。
//   現実的に効くのは iOS16.4+ Safari 等で「ホーム画面に追加」した standalone PWA。
//   非対応環境ではそもそも購読しない（composable 側で no-op）。
// ============================================================

// ★2026-09-27: 新しい版を取り込んだら、アプリの画面を全部閉じるのを待たずに切り替える。
//  切り替え待ちのままだと、直した通知の動きが端末に届かない（実機で「直したのに飛ばない」の一因）。
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

// 通知を押した先の URL を、アプリが起動した時に読めるよう端末の中に置いておく（置き手紙）。
//  iPhone のホーム画面アプリは、止められていたアプリを通知から起動すると openWindow の URL ではなく
//  前回（または最初）のページで開くことがある。アプリ側（plugins/sw-open-url.client.ts）が起動時・前に出た時に読んで移動する。
const OPEN_CACHE = 'push-open-url'
const OPEN_KEY = '/__push_open_url'
async function leaveOpenUrl(url) {
  try {
    const cache = await caches.open(OPEN_CACHE)
    await cache.put(OPEN_KEY, new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))
  } catch { /* 置けなくても通常の開き方は続ける */ }
}
// 既に押し先のページを開いていた時は置き手紙を消す（残すと、2分以内に普通に開いた時にも飛んでしまう）
async function clearOpenUrl() {
  try { await (await caches.open(OPEN_CACHE)).delete(OPEN_KEY) } catch { /* noop */ }
}

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = {} }

  const title = payload.title || '新着メッセージ'
  const body  = payload.body  || ''
  // クリックで開く先。招待リンク経由のゲストは token 付きURLしか開けないので
  // 配信側が組み立てたURLをそのまま使う。
  const url   = payload.url || '/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 同じ現場の通知はまとめる（連投で通知が積み上がらないように）
      tag: payload.tag || 'site-chat',
      renotify: true,
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    await leaveOpenUrl(target)
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // 既に目的のページを開いている画面があれば、それを前に出すだけ（画面を増やさない）
    for (const c of list) {
      if (c.url === target && 'focus' in c) { await clearOpenUrl(); return c.focus() }
    }
    // ★2026-09-27: 既にアプリが開いている時は、その画面を目的のページへ移動させる。
    //  iPhone のホーム画面アプリは、開いている最中に openWindow を呼ぶと**アプリが前に出るだけでページが移動しない**
    //  ことがある（実機で「通知を押してもアプリが開くだけ」だった）。navigate が使えない時は、アプリへ
    //  「このページを開いて」と伝える（plugins/sw-open-url.client.ts が受けて移動する）。
    const same = list.find((c) => { try { return new URL(c.url).origin === self.location.origin } catch { return false } })
    if (same) {
      try {
        if ('navigate' in same) {
          const moved = await same.navigate(target)
          // ★置き手紙は消さない: iPhone では navigate が返っても実際には移動していないことがあり得る。
          //  残してもアプリ側が1回読んだら消し、2分で無効になる
          if (moved) return moved.focus()
        }
      } catch { /* このページを管理していない等で navigate できない → 下の伝言へ */ }
      try { same.postMessage({ type: 'open-url', url: target }) } catch { /* 伝えられなくても前には出す */ }
      return 'focus' in same ? same.focus() : undefined
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined
  })())
})
