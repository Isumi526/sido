// ============================================================
//  utils/uploadExpenseFiles.ts
//  経費ファイル・ゴミ写真を Supabase Storage にアップロード
//
//  パス規則:
//    expense-receipts/{accountSlug}/{YYYY-MM}/{first|second}/
//      {date}_{sender}_{siteName}/{category}_{index}.{ext}
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'expense-receipts'

/** ファイルパスに使えない文字を置換（ASCII英数字・ハイフン・アンダースコア以外は全て _ に） */
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9\-]/g, '_').slice(0, 40)
}

export async function uploadExpenseFiles(
  supabase:    SupabaseClient,
  files:       File[],
  date:        string,   // YYYY-MM-DD
  senderName:  string,
  siteName:    string,
  category:    string,
  accountSlug: string,
  period:      string,   // 'first' | 'second'
): Promise<string[]> {
  const yearMonth = date.slice(0, 7)
  const folder    = [
    accountSlug,
    yearMonth,
    period,
    `${date}_${sanitize(senderName)}_${sanitize(siteName)}`,
  ].join('/')

  const urls: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!(file instanceof File)) continue  // テストデータ等で文字列が混入した場合はスキップ
    const ext  = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${folder}/${category}_${i + 1}.${ext}`

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true })

    if (error) {
      throw new Error(`${path}: ${error.message}`)
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    urls.push(data.publicUrl)
  }

  return urls
}
