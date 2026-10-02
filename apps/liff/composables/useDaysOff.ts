// ============================================================
//  useDaysOff — 自分の「休み」「有給」を予定に先に入れる・毎週の定休（2026-10-02 設計「入力の手間を減らす」I-3）
//  読み書きは EF(days-off) 経由。入れた日は、その日の夜に日報が自動で出る（auto-day-off-reports）。
// ============================================================
export type DayOffKind = 'off' | 'paid_leave'
export type DayOff = { id: string; date: string; endDate: string; kind: DayOffKind }

const EDGE_FN = 'days-off'

export function useDaysOff() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  /** EF を呼ぶ。失敗はエラーコードで返す（画面側で言葉にする） */
  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    const res = await fetch(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
      body: JSON.stringify({ action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `failed_${res.status}`)
    return json
  }

  async function list(): Promise<{ upcoming: DayOff[]; weekly: number[] }> {
    const r = await call('list')
    return { upcoming: r.upcoming ?? [], weekly: r.weekly ?? [] }
  }
  async function add(date: string, kind: DayOffKind): Promise<{ balanceShort: boolean }> {
    const r = await call('add', { date, kind })
    return { balanceShort: !!r.balanceShort }
  }
  async function remove(id: string): Promise<void> { await call('remove', { id }) }
  async function setWeekly(weekdays: number[]): Promise<number[]> {
    const r = await call('weekly-set', { weekdays })
    return r.weekly ?? weekdays
  }

  return { list, add, remove, setWeekly }
}
