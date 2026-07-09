// ============================================================
//  utils/uploadExpenseFiles.ts
//  経費ファイル・ゴミ写真を Supabase Storage にアップロード
//
//  2026-07-09: 旧 expense-receipts バケットは anon 書込を遮断（テナント分離チケット）。
//  新規アップロードは edge function(expense-receipt-upload) 経由・service_role で
//  非公開バケット expense-receipts-v2 へ書き込み、長期署名URLを受け取って返す
//  （戻り値の形は従来と同じ string[] の URL 配列＝呼び出し側・表示側は無改修）。
//  LINE作業員はSupabase JWTを持たないため、可能なら liff/id-token を渡す。
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

const EDGE_FN = 'expense-receipt-upload'

/** ファイルパスに使えない文字を置換（ASCII英数字・ハイフン・アンダースコア以外は全て _ に） */
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9\-]/g, '_').slice(0, 40)
}

// ローカルSupabaseはEF内から見たhostが kong:8000 等の内部名になるため、
// クライアントの実際の接続先ホストへ差し替える（apps/admin/src/pages/vehicles.vue と同じパターン）。
// 長期署名URLとして永続保存するため、返す前にここで正規化しておく。
function normalizeStorageUrl(url: string, supabaseUrl: string): string {
  try {
    const base = new URL(supabaseUrl)
    const u = new URL(url)
    if (u.host !== base.host) { u.protocol = base.protocol; u.host = base.host }
    return u.toString()
  } catch { return url }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // data:<mime>;base64,XXXX の XXXX 部分だけ取り出す
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
  lineIdToken: string,
  runtimeEnv:  { edgeFunctionUrl: string; supabaseUrl: string; supabaseAnonKey: string },
): Promise<string[]> {
  const edgeUrl = `${runtimeEnv.edgeFunctionUrl}/${EDGE_FN}`
  const anonKey = runtimeEnv.supabaseAnonKey
  const supabaseUrl = runtimeEnv.supabaseUrl
  const { data: { session } } = await supabase.auth.getSession()

  const urls: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!(file instanceof File)) continue  // テストデータ等で文字列が混入した場合はスキップ
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const fileBase64 = await fileToBase64(file)

    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        file_base64: fileBase64,
        ext,
        date,
        sender_name: sanitize(senderName),
        site_name: sanitize(siteName),
        category,
        index: i + 1,
        period,
        line_id_token: lineIdToken ?? '',
      }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      throw new Error(`${category}_${i + 1}.${ext}: ${json?.error ?? `アップロードに失敗しました(${res.status})`}`)
    }
    urls.push(normalizeStorageUrl(json.url as string, supabaseUrl))
  }

  return urls
}
