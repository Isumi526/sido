// ============================================================
//  links.ts — 関連アプリのURL解決（環境差を吸収）
//  作業員アプリ(LIFF)へのリンク等で使用。
// ============================================================

// 作業員アプリ(LIFF)のURLを返す。
//  優先: VITE_LIFF_URL（owner が明示設定）→ host から推定。
//  本番ルーティング: genlinks.app/admin（管理）から見た作業員アプリは genlinks.app/（同一オリジンのルート）。
export function liffAppUrl(): string {
  const envUrl = (import.meta.env.VITE_LIFF_URL as string | undefined)?.trim()
  if (envUrl) return envUrl
  if (typeof window === 'undefined') return '/'
  const host = window.location.host
  // 独自ドメイン構成（genlinks.app/ = 作業員・/admin = 管理）→ 作業員アプリは同一オリジンのルート
  if (host === 'genlinks.app' || host.endsWith('.genlinks.app')) return window.location.origin + '/'
  // 現状の別ドメイン本番（admin → liff）
  if (host.includes('sido-admin')) return 'https://sido-liff.vercel.app/'
  // ローカル開発（admin 3001 → liff 3000）
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `${window.location.protocol}//${window.location.hostname}:3000/`
  }
  // フォールバック（同一オリジンのルート）
  return '/'
}
