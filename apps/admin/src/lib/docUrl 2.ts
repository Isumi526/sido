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

// クリックで開く（署名URLは非同期のため、href ではなく @click で解決して別タブを開く）
export async function openDoc(path: string | null | undefined, bucket?: string | null): Promise<void> {
  const url = await resolveDocUrl(path, bucket)
  if (url) window.open(url, '_blank', 'noopener')
  else alert('PDFを開けませんでした')
}
