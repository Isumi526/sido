// ============================================================
//  useDailyReportsApi — 日報の**読み取り**を Edge Function 経由で行う
//
//  ★なぜ EF 経由か（テーブル直読みに戻さない）:
//   daily_reports は 2026-08-15 の実測で、他テナントのアカウントから
//   全件（2,827件）読め、書き換えも削除もできる状態だった。
//   読めた中身は日付・現場・作業員名・稼働時間・経費まで丸ごと。
//   anon には身元が無くRLSの行フィルタでは絞れないので、身元をサーバ側で
//   検証して service_role で読む形に寄せる。
//
//  ★ここに supabase.from('daily_reports') を書き足さないこと。
//   1箇所でも直読みが残ると権限を落とせず、穴が塞がらない。
//
//  ★保存（upsert）はまだ useExpense.saveReportById が直接書いている。
//   書き込みのEF化は別ユニット。それが済むまで daily_reports に RLS は入れられない。
// ============================================================
const EDGE_FN = 'daily-reports-read'

export type DailyReportRow = {
  id?: string
  date: string
  is_working?: boolean
  leave_type?: string | null
  is_business_trip?: boolean
  sites?: any[]
  note?: string | null
  gasoline_items?: any[]
  updated_at?: string
}

export function useDailyReportsApi() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: { action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload },
    })
    if (!res?.ok) throw new Error(res?.error ?? `${action} failed`)
    return res
  }

  /**
   * 提出済みの日付だけを取る（未送信カウント・次の未提出日）。
   * ★取れなかった時に空を返すと「全部未提出」に見えてしまうので、失敗は呼び出し側へ投げる。
   */
  async function submittedDates(from: string, to: string, userId?: string | null): Promise<string[]> {
    const r = await call('dates', { from, to, ...(userId ? { userId } : {}) })
    return (r.dates ?? []) as string[]
  }

  /** 日報一覧（履歴・代理入力）。失敗は空配列（一覧が出ないだけで操作は続けられる） */
  async function list(limit = 60, userId?: string | null): Promise<DailyReportRow[]> {
    try {
      const r = await call('list', { limit, ...(userId ? { userId } : {}) })
      return (r.reports ?? []) as DailyReportRow[]
    } catch (e) { console.error('[daily-reports] 一覧の取得に失敗:', e); return [] }
  }

  /** 特定日の1件（編集復元）。失敗は null */
  async function one(date: string, userId?: string | null): Promise<DailyReportRow | null> {
    try {
      const r = await call('one', { date, ...(userId ? { userId } : {}) })
      return (r.report ?? null) as DailyReportRow | null
    } catch (e) { console.error('[daily-reports] 取得に失敗:', e); return null }
  }

  /** 経費集計用（期間内の sites / gasoline_items）。金額に効くので失敗は投げる */
  async function forExpense(from: string, to: string, userId?: string | null): Promise<DailyReportRow[]> {
    const r = await call('expense', { from, to, ...(userId ? { userId } : {}) })
    return (r.reports ?? []) as DailyReportRow[]
  }

  return { submittedDates, list, one, forExpense }
}
