// ============================================================
//  composables/usePersonalExpense.ts
//  現場に紐付かない個人経費（personal_expenses）の読み書きと、月額枠の表示。
//
//  ★すべて edge function `personal-expense-submit` 経由（直接テーブルを叩かない）:
//    personal_expenses は anon revoke ＋ RLS `to authenticated` のため、Supabase JWT を
//    持たない LINE 作業員はクライアントから読み書きできない。anon に権限を戻すのは
//    権限昇格の穴と同じ轍なので、service_role の EF に寄せて認可を関数内で行う。
//    worker_id は EF が検証済みの身元から決める＝クライアントは名乗れない。
//  ★消費/超過の計算は shared/expense-flatten.ts（＝expense-flatten.gen）が正本。
//    EF からは「枠」と「明細」だけ受け取り、判定はここで共有関数に通す。
// ============================================================
import { computeBudgetUsage, expenseMonthKey, type BudgetUsage } from '~/composables/expense-flatten.gen'

export interface PersonalExpenseInput {
  date: string
  account_category: string
  amount: number
  payee?: string | null
  registration_number?: string | null
  companions?: string | null
  note?: string | null
  file_urls?: string[]
  tategae?: boolean
  client_token?: string   // 1登録につき1つ。再送を1行にまとめる（二重計上の防止）
}

const EDGE_FN = 'personal-expense-submit'

export const usePersonalExpense = () => {
  const supabase = useSupabase()
  const liff = useLiff()
  const config = useRuntimeConfig()

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    // 開発モードは LINE ID token が発行されない（useLiff.getIdToken が null）。
    // ローカル検証用に身元を明示する。EF 側はローカルSupabase接続時しか受け付けない。
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await fetch(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.message ?? json?.error ?? `失敗しました(${res.status})`)
    return json
  }

  /** その月の申請可否・枠・明細をまとめて取得 */
  async function loadState(month: string): Promise<{ canSubmit: boolean; usage: BudgetUsage; items: any[] }> {
    try {
      const r = await call('state', { month })
      const items = (r.items ?? []) as any[]
      return {
        canSubmit: !!r.canSubmit,
        usage: computeBudgetUsage(items, month, r.limit ?? null),
        items,
      }
    } catch {
      // 解決できない＝申請させない（フェイルセーフ。入口を開けたままにしない）
      return { canSubmit: false, usage: computeBudgetUsage([], month, null), items: [] }
    }
  }

  async function create(input: PersonalExpenseInput) {
    return await call('create', { input })
  }

  async function remove(id: string) {
    return await call('delete', { id })
  }

  return { loadState, create, remove, expenseMonthKey }
}
