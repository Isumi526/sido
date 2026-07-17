// ============================================================
//  chatAttachmentLimits.ts — 現場チャットのファイル添付の容量まわり。
//  MAX_ATTACHMENT_BYTES は supabase/functions/site-chat-attachment-upload/index.ts
//  の MAX_BYTES と揃える(サーバー側の実上限に合わせないと「クライアントはOKなのに
//  サーバーで弾かれる」が起きるため)。
// ============================================================
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15MB・edge側と同値
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024    // これ未満は圧縮しない(劣化させる価値が薄い)
const MAX_DIMENSION = 1600                              // 長辺の上限px
const JPEG_QUALITY = 0.8

export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 画像を送信前に自動リサイズ/再エンコードして容量を下げる(best-effort)。
// GIFはアニメーションが壊れるため対象外。失敗時・圧縮後の方が大きい場合は元ファイルのまま返す。
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    const newName = file.name.replace(/\.\w+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
