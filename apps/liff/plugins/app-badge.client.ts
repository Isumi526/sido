// ============================================================
//  plugins/app-badge.client.ts
//  アプリアイコンの数字（バッジ）を、アプリのベルと同じ数に揃える（設計 A-1・確認事項#5=A・2026-09-27）。
//  ベルの数（useNotifBadge の totalBadgeCount: 未読のお知らせ＋やること）が変わるたびに setAppBadge、0 なら消す。
//  ★対応しているのはホーム画面に追加したアプリ（iOS 16.4+ など）だけ。非対応の環境では何もしない。
//  ★通知が届いた時（アプリを開いていない時）は Service Worker（public/sw-push.js）がサーバーの数えた数を出す。
//   アプリを開けば、ここで正確な数に直る。
// ============================================================
import { watch } from 'vue'
import { totalBadgeCount } from '~/composables/useNotifBadge'

export default defineNuxtPlugin(() => {
  if (typeof navigator === 'undefined') return
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (typeof nav.setAppBadge !== 'function') return
  watch(totalBadgeCount, (n) => {
    try {
      if (n > 0) void nav.setAppBadge!(n).catch(() => {})
      else void nav.clearAppBadge?.().catch(() => {})
    } catch { /* 非対応・権限なしは無視 */ }
  }, { immediate: true })
})
