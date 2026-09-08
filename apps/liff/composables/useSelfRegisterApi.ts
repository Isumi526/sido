// ============================================================
//  useSelfRegisterApi — 「まだ登録していない人」の自己登録を EF 経由で行う
//
//  ★なぜ EF 経由か（テーブル直書きに戻さない）:
//   登録は元々 anon で workers を upsert していたが、2026-08-01 の anon
//   ロックダウン（作業員が自力でオーナーに昇格できる P0 の封鎖）で workers が
//   列単位付与に絞られ、PostgREST の upsert が要求するテーブル単位の
//   SELECT/UPDATE を満たせず **全件 401** になっていた。
//   実測: users.line_user_id が付いた行は 2026-06-25 を最後に 0 件。
//   anon の権限を戻すと P0 が再び開くので、経路だけ service_role の EF に寄せる。
//
//  ★ここに supabase.from('workers') を書き足さないこと。
//   直書きが1つでも残ると anon の権限を落とせず、穴が塞がらない。
//
//  ★一覧（options）も EF から取る。master-data は users を line_user_id で引くため
//   「まだ登録していない人」は 401 になり、登録画面なのに一覧が空になっていた。
// ============================================================
const EDGE_FN = 'worker-self-register'

export type RegisterOption = {
  id: string
  name: string
  name_kana: string | null
  role: 'factory' | 'site'
}

export function useSelfRegisterApi() {
  const config = useRuntimeConfig()
  const liff = useLiff()
  const { effectiveSlug } = useAccount()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    // ローカル(dev)のみ。本番の EF 側は IS_LOCAL でないと受け付けない。
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const accountSlug = await effectiveSlug()
    return await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: { action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, account_slug: accountSlug, ...payload },
    })
  }

  /** 登録画面の「一覧から選ぶ」に出す作業員。単価等は返らない（EF が最小限だけ返す）。 */
  async function options(): Promise<RegisterOption[]> {
    const res = await call('options')
    if (!res?.ok) throw new Error(res?.error ?? 'options failed')
    return (res.workers ?? []) as RegisterOption[]
  }

  /** 作業員の確保＋LINE の紐付け。worker_id を渡せば既存、渡さなければ name で確保。 */
  async function register(input: { workerId?: string | null; name?: string; role?: 'factory' | 'site' }): Promise<any> {
    const res = await call('register', {
      worker_id: input.workerId ?? null,
      name: input.name ?? '',
      role: input.role ?? 'site',
    })
    if (!res?.ok) throw new Error(res?.error ?? 'register failed')
    return res.user
  }

  return { options, register }
}
