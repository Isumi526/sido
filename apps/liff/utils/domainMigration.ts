// ============================================================
//  utils/domainMigration.ts — 独自ドメイン(genlinks.app)移行の旧ドメイン案内＋リダイレクト（liff側）
//  旧 liff ドメインでアクセスされたら「移行しました・5秒後に新URLへ」を出して遷移する。
//  ※ NEW_LIFF_ORIGIN が空の間は完全に無効（本番影響ゼロ）。owner が新ドメイン稼働後に値を入れて有効化する。
//  ※ 配信方式 A=Vercel rewrites（genlinks.app/ = liff）。DNS / Vercel / LIFF許可ドメインは owner 作業。
//  ※ LIFF経由(liff.line.me)のアクセスは host が異なるため対象外（旧vercel直アクセスのみ案内）。
// ============================================================

// 新ドメインの liff ベースURL。空 = 移行案内オフ（既定）。例: 'https://genlinks.app'
export const NEW_LIFF_ORIGIN: string = ''

// 旧 liff ドメイン（ここで直アクセスされた時だけ案内を出す）。
export const OLD_LIFF_HOSTS = ['sido-liff.vercel.app']

export const REDIRECT_SECONDS = 5

/** 現在の host が「旧ドメイン」かつ 新ドメインが設定済みなら、遷移先URL（パス保持）を返す。無効時は null。 */
export function liffMigrationTargetUrl(): string | null {
  if (!NEW_LIFF_ORIGIN) return null
  if (typeof window === 'undefined') return null
  const host = window.location.host
  if (!OLD_LIFF_HOSTS.includes(host)) return null
  const base = NEW_LIFF_ORIGIN.replace(/\/+$/, '')
  return base + window.location.pathname + window.location.search + window.location.hash
}
