// ============================================================
//  lib/accessToken.ts
//  下請け業者向け トークン発行ユーティリティ（#2 AC3）
//  - 推測困難な256bitトークンを生成し、平文はその場で返す（メールURL用）。
//  - DB には SHA-256 ハッシュのみ保存（平文は保存しない）。
//  - 業者ポータルからの参照は Edge Function `subcontractor-portal` 経由で検証される。
//  ※ 発行は管理画面（認証済みSido担当者）から。業者クライアントはこの関数を持たない。
// ============================================================
import { supabase } from './supabase'
import { getAccountId } from './account'

/** 32byte(256bit)乱数を base64url で返す（URL安全・推測困難） */
function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 を16進文字列で返す（Edge側の検証と同一アルゴリズム） */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type IssueTokenOpts = {
  subcontractorId: string
  purpose: string                  // 'order_accept'（注文書承諾）等
  documentType?: string | null     // 'purchase_order' 等
  documentId?: string | null       // 対象文書ID（業者単位なら null）
  expiresInDays?: number | null    // 既定60日。null=無期限。0=即時失効相当(使わない想定)
  portalBaseUrl?: string           // 業者ポータルのベースURL（liffアプリ）。例 https://sido-liff.vercel.app
}

/** トークンを発行して { token(平文), url, id } を返す。平文は一度きり（再表示不可） */
export async function issueAccessToken(o: IssueTokenOpts): Promise<{ token: string; url: string; id: string }> {
  const accountId = await getAccountId()
  const token = randomToken(32)
  const token_hash = await sha256Hex(token)
  const days = o.expiresInDays === undefined ? 60 : o.expiresInDays
  const expires_at = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString()

  const { data, error } = await supabase.from('document_access_tokens').insert({
    account_id:       accountId,
    subcontractor_id: o.subcontractorId,
    purpose:          o.purpose,
    document_type:    o.documentType ?? null,
    document_id:      o.documentId ?? null,
    token_hash,
    expires_at,
  }).select('id').single()
  if (error) throw error

  const base = (o.portalBaseUrl ?? '').replace(/\/$/, '')
  return { token, url: `${base}/p/${token}`, id: data.id as string }
}

/** トークン失効（注文書取消・再発行時など） */
export async function revokeAccessToken(id: string): Promise<void> {
  await supabase.from('document_access_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)
}
