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
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // 既に目的のページを開いている画面があれば、それを前に出すだけ（画面を増やさない）
    for (const c of list) {
      if (c.url === target && 'focus' in c) return c.focus()
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
          if (moved) return moved.focus()
        }
      } catch { /* このページを管理していない等で navigate できない → 下の伝言へ */ }
      try { same.postMessage({ type: 'open-url', url: target }) } catch { /* 伝えられなくても前には出す */ }
      return 'focus' in same ? same.focus() : undefined
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined
  })())
})
