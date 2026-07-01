// ============================================================
//  domainMigration.ts — 独自ドメイン(genlinks.app)移行の旧ドメイン案内＋リダイレクト
//  旧 admin ドメインでアクセスされたら「移行しました・5秒後に新URLへ」を出して遷移する。
//  ※ NEW_ORIGIN が空の間は完全に無効（本番影響ゼロ）。owner が新ドメイン稼働後に値を入れて有効化する。
//  ※ 配信方式は A=Vercel rewrites（genlinks.app/ = liff・genlinks.app/admin = admin）。
//     DNS / Vercel ドメイン割当て / 認証許可ドメインは owner 作業（人間ゲート）。
// ============================================================

// 新ドメインの admin ベースURL。空 = 移行案内オフ（既定）。例: 'https://genlinks.app/admin'
export const NEW_ADMIN_ORIGIN: string = ''

// 旧 admin ドメイン（ここでアクセスされた時だけ案内を出す）。
export const OLD_ADMIN_HOSTS = ['sido-admin-stism.vercel.app']

export const REDIRECT_SECONDS = 5

/** 現在の host が「旧ドメイン」かつ 新ドメインが設定済みなら、遷移先URL（パス保持）を返す。無効時は null。 */
export function migrationTargetUrl(): string | null {
  if (!NEW_ADMIN_ORIGIN) return null
  if (typeof window === 'undefined') return null
  const host = window.location.host
  if (!OLD_ADMIN_HOSTS.includes(host)) return null
  const base = NEW_ADMIN_ORIGIN.replace(/\/+$/, '')
  return base + window.location.pathname + window.location.search + window.location.hash
}
