// ============================================================
//  links.ts — 関連アプリのURL解決（環境差を吸収）
//  作業員アプリ(LIFF)へのリンク等で使用。
// ============================================================

// 作業員アプリ(LIFF)のURLを返す。
//  優先: VITE_LIFF_URL（owner が明示設定）→ host から推定。
//  独自ドメイン（2026-09-28 配置）: genlinks.app＝紹介ページ（LP）／app.genlinks.app＝作業員アプリ（/admin で管理画面も同じオリジン）／
//  admin.genlinks.app＝管理画面（PC 向け・別オリジン）。
export function liffAppUrl(): string {
  const envUrl = (import.meta.env.VITE_LIFF_URL as string | undefined)?.trim()
  if (envUrl) return envUrl
  if (typeof window === 'undefined') return '/'
  const host = window.location.host
  // 管理画面の独自ドメイン → 作業員アプリの独自ドメインへ
  if (host === 'admin.genlinks.app') return 'https://app.genlinks.app/'
  // 作業員アプリのドメインの /admin で開いている時 → 作業員アプリは同一オリジンのルート（ログインも共有）
  if (host === 'app.genlinks.app') return window.location.origin + '/'
  // 現状の別ドメイン本番（admin → liff）
  if (host.includes('sido-admin')) return 'https://sido-liff.vercel.app/'
  // ローカル開発（admin 3001 → liff 3000）
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `${window.location.protocol}//${window.location.hostname}:3000/`
  }
  // フォールバック（同一オリジンのルート）
  return '/'
}
