// ============================================================
//  lib/docUrl.ts
//  管理者発行物（注文書PDF・見積書PDF）の表示URLを bucket に応じて解決する。
//   - 'admin-docs'(非公開) → 短TTL署名URL(createSignedUrl)。直アクセス不可＝公開URL露出を解消。
//   - それ以外（既存 'expense-receipts' 公開バケット）→ 従来の getPublicUrl（後方互換 dual-read）。
//  pdf_bucket 列（既定 'expense-receipts'）を読む側が見て出し分ける。
// ============================================================
import { supabase } from './supabase'

const SIGN_TTL = 300 // 5分

export async function resolveDocUrl(path: string | null | undefined, bucket?: string | null): Promise<string | null> {
  if (!path) return null
  const b = bucket || 'expense-receipts'
  if (b === 'expense-receipts') {
    return supabase.storage.from('expense-receipts').getPublicUrl(path).data.publicUrl ?? null
  }
  const { data } = await supabase.storage.from(b).createSignedUrl(path, SIGN_TTL)
  return data?.signedUrl ?? null
}

/** DBにバケット列を持たず「規約パス」で読むもの（経費申請PDF）を解決する。
 *  ★まず非公開(admin-docs)を見て、無ければ旧公開バケットへ落とす dual-read。
 *   2026-08-13 に新規書き込みを admin-docs へ切り替えたが、それ以前の分は
 *   expense-receipts 側に残っている。両方見ないと「先月の申請書が開けない」になる。
 *   既存分の移送が済んだら、この関数は消して resolveDocUrl に寄せる。 */
export async function resolveConventionDocUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  // createSignedUrl は対象が無ければ error を返す＝存在確認を兼ねられる
  const { data } = await supabase.storage.from('admin-docs').createSignedUrl(path, SIGN_TTL)
  if (data?.signedUrl) return data.signedUrl
  return supabase.storage.from('expense-receipts').getPublicUrl(path).data.publicUrl ?? null
}

// クリックで開く（署名URLは非同期のため、href ではなく @click で解決して別タブを開く）
export async function openDoc(path: string | null | undefined, bucket?: string | null): Promise<void> {
  const url = await resolveDocUrl(path, bucket)
  if (url) window.open(url, '_blank', 'noopener')
  else alert('PDFを開けませんでした')
}

/** 規約パスのPDFをクリックで開く（経費申請の明細・請求書） */
export async function openConventionDoc(path: string | null | undefined): Promise<void> {
  const url = await resolveConventionDocUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
  else alert('PDFを開けませんでした')
}
