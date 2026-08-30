// 作業員が自分の有給状況を取得する（読み取り専用・paid-leave-status EF 経由）。
// ★書き込み系は持たない。付与/調整は管理画面のみ（クライアントからは変更不可）。
export type PaidLeaveGrant = { granted_at: string; expires_at: string; days: number; used: number; leftover: number; expired: boolean; note: string | null }
export type PaidLeaveUsage = { date: string; note: string | null }
export type PaidLeaveStatus = {
  remaining: number
  validGranted: number
  initialUsed: number
  isContractor: boolean
  grants: PaidLeaveGrant[]
  usage: PaidLeaveUsage[]
}

const EDGE_FN = 'paid-leave-status'

export function usePaidLeave() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function status(): Promise<PaidLeaveStatus> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
      body: { line_id_token: lineIdToken, dev_line_user_id: devLineUserId },
    })
    if (!res?.ok) throw new Error(res?.error ?? 'paid-leave status failed')
    return res as PaidLeaveStatus
  }

  return { status }
}
