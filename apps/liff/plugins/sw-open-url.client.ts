// ============================================================
//  plugins/sw-open-url.client.ts
//  スマホ通知を押した時、Service Worker（public/sw-push.js）から「このページを開いて」と伝えられたら移動する。
//
//  ★2026-09-27: iPhone のホーム画面アプリは、アプリが開いている最中に通知を押すと、アプリが前に出るだけで
//   ページが移動しないことがあった。SW 側はまず WindowClient.navigate で移動させ、それができない時にここへ伝言する。
//   移動先は同じドメインの URL だけ受け付ける（/admin/... は管理画面なので、画面ごと読み込み直す）。
// ============================================================
export default defineNuxtPlugin(() => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null
    if (!data || data.type !== 'open-url' || typeof data.url !== 'string') return
    let target: URL
    try { target = new URL(data.url, window.location.origin) } catch { return }
    if (target.origin !== window.location.origin) return
    if (target.href !== window.location.href) window.location.assign(target.href)
  })
})
