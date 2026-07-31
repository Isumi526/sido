// ============================================================
//  composables/useWorkerPermission.ts
//  LIFF 側で「今の作業員の permission_role で何ができるか」を解決する単一ソース。
//   - admin 側の判定（apps/admin/src/lib/auth.ts の ADMIN_ALLOWED_ROLES）と対応させる。
//     admin を使える = 現場登録等のマスタ操作ができるロール（admin/office/site_manager）。
//     職人(worker) は弾く。
//   - 以前は各画面が個別に workers.permission_role を引いていた
//     （calendar/index.vue の resolveCanManageCat 等）。判定の散在＝片方だけ直して
//     もう片方に穴が残る事故のもとなので、ここに集約する。
//   - フェイルセーフ: 解決できない場合は「権限なし」に倒す（開いたままにしない）。
// ============================================================

/** マスタ操作（現場・カテゴリ等の新規作成/編集）を許可するロール。admin側 ADMIN_ALLOWED_ROLES と同じ。 */
export const MASTER_EDIT_ROLES = ['admin', 'office', 'site_manager'] as const

export const useWorkerPermission = () => {
  const supabase = useSupabase()
  const { workerId: authWorkerId } = useLiff()
  const { resolve } = useCurrentUser()

  // ページ跨ぎで共有（同一セッションで何度も workers を引かない）
  const role = useState<string | null>('worker_permission_role', () => null)
  const resolved = useState<boolean>('worker_permission_resolved', () => false)
  const canApplyPE = useState<boolean>('worker_can_apply_personal_expense', () => false)

  /** 現在の作業員の permission_role を解決（冪等・1セッション1回） */
  async function resolveRole(): Promise<string | null> {
    if (resolved.value) return role.value
    try {
      // email/pw は JWT の worker_id、LINE は users 行経由で worker_id を得る
      let wid = authWorkerId.value ?? null
      if (!wid) {
        const u = await resolve()
        wid = u?.worker_id ?? null
      }
      if (!wid) { resolved.value = true; role.value = null; return null }
      const { data } = await supabase
        .from('workers').select('permission_role, can_apply_personal_expense').eq('id', wid).maybeSingle()
      const w = data as { permission_role?: string; can_apply_personal_expense?: boolean } | null
      role.value = w?.permission_role ?? null
      canApplyPE.value = !!w?.can_apply_personal_expense
    } catch {
      role.value = null   // 失敗時は権限なし扱い（フェイルセーフ）
      canApplyPE.value = false
    } finally {
      resolved.value = true
    }
    return role.value
  }

  /** 現場などマスタの新規作成/編集ができるか（未解決時は false＝フェイルセーフ） */
  const canEditMaster = computed(() =>
    !!role.value && (MASTER_EDIT_ROLES as readonly string[]).includes(role.value))

  /** 現場の新規作成ができるか（現状は canEditMaster と同一。将来分けられるよう別名で公開） */
  const canCreateSite = canEditMaster

  /**
   * 個人経費（現場に紐付かない経費）の入口を出すか（#2cbe3caa）。
   * ここは「そもそも許された人か」だけを見る。実際に提出できるか（枠の金額が要る）は
   * 画面側が shared の canSubmitPersonalExpense で判定し、足りない理由を出す。
   */
  const canApplyPersonalExpense = computed(() => canApplyPE.value)

  return { resolveRole, role, canEditMaster, canCreateSite, canApplyPersonalExpense }
}
