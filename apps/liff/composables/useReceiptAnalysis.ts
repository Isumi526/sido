// ============================================================
//  composables/useReceiptAnalysis.ts
//  領収書 AI 解析（Gemini via Edge Function）
// ============================================================

export interface ReceiptResult {
  label:         string | null
  yen:           number | null
  invoiceNumber: string | null
}

export const useReceiptAnalysis = () => {
  const config  = useRuntimeConfig()
  const loading = ref<string | null>(null)  // 解析中のキー（ホテル・その他等）
  const error   = ref<string | null>(null)

  async function analyze(file: File, key: string): Promise<ReceiptResult | null> {
    loading.value = key
    error.value   = null
    try {
      const base64 = await toBase64(file)
      // EDGE_FUNCTION_URL 未設定時は SUPABASE_URL から自動導出
      const efUrl = config.public.edgeFunctionUrl
        || `${config.public.supabaseUrl}/functions/v1`
      if (!efUrl) throw new Error('Edge Function URL未設定')

      const anonKey = config.public.supabaseAnonKey as string

      // cold start 対策: 失敗したら2秒待って1回リトライ
      let res: Response | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await fetch(`${efUrl}/analyze-receipt`, {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${anonKey}`,
            },
            body: JSON.stringify({ imageBase64: base64 }),
          })
          if (res.ok) break
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
          else throw new Error('ネットワークエラーが発生しました')
        }
      }

      if (!res || !res.ok) {
        const status = res?.status ?? 0
        if (status === 401 || status === 403) throw new Error('認証エラーが発生しました')
        if (status === 503 || status === 504) throw new Error('サーバーが混雑しています。しばらく待ってから再試行してください')
        if (status >= 500) throw new Error('サーバーエラーが発生しました')
        throw new Error(`通信エラーが発生しました（${status}）`)
      }

      return await res.json() as ReceiptResult
    } catch (e) {
      error.value = e instanceof Error ? e.message : '解析に失敗しました'
      return null
    } finally {
      loading.value = null
    }
  }

  return { analyze, loading: readonly(loading), error: readonly(error) }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('ファイル読み込みエラー'))
    reader.readAsDataURL(file)
  })
}
