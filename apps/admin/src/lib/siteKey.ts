// ============================================================
//  lib/siteKey.ts
//  日報 daily_reports.sites[] の現場参照を「集計キー」と「表示名」に解決する共有ヘルパー。
//
//  背景（根本対策）: 日報は現場を site_id で権威づける。集計は site_id をキーにすることで
//  表記ゆれ（例: 全角スペース有無）や現場マージ後の孤児を1バケットに統合する。
//  ・site_id があればそれをキー（表示名はマスタの正式名）。
//  ・site_id が無い旧データ/フリーテキストでも、現場名が active マスタに正規化一致すれば
//    read時に id へ解決してキーに使う（バックフィル前でも統合・split しない）。
//  ・どこにも一致しなければ現場名そのものでグループ化（従来互換）。
// ============================================================
import { resolveActiveSiteId } from './siteSimilarity'

export type SiteMaster = { id: string; name: string }
export type SiteResolveCtx = {
  activeSites?: SiteMaster[]            // active な現場マスタ（作成日昇順推奨）
  siteNameById?: Record<string, string> // id→正式名（表示用）。全現場（inactive含む）で作ると安全
}

export function siteStoredName(site: any): string {
  const raw = site?.siteName
  return raw === '__unset__' ? '現場未設定'
    : raw === '__other__' ? (site?.customSiteName || '')
    : (raw || '')
}

/** 集計キー(key)と表示名(name)を返す。key は id 有り→`id:<uuid>`、無し→現場名（未設定は「現場未設定」）。 */
export function resolveSiteRef(site: any, ctx?: SiteResolveCtx): { key: string; name: string } {
  const stored = siteStoredName(site)
  const id = site?.site_id || (ctx?.activeSites ? resolveActiveSiteId(site, ctx.activeSites) : null)
  if (id) {
    const name = (ctx?.siteNameById && ctx.siteNameById[id]) || stored || '(現場)'
    return { key: 'id:' + id, name }
  }
  if (site?.siteName === '__unset__') return { key: '現場未設定', name: '現場未設定' }
  return { key: stored, name: stored }
}
