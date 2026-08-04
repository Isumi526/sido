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
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    // 既に同じチャットを開いているタブがあればそれを前面に出す（新しいタブを増やさない）
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined
    }),
  )
})
