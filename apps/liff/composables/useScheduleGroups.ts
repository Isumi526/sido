// ============================================================
//  composables/useScheduleGroups.ts
//  予定グループ管理（CRUD + メンバー管理）
// ============================================================

export interface ScheduleGroup {
  id:         string
  name:       string
  created_by: string | null
  created_at: string
  members:    { worker_id: string; worker?: { id: string; name: string } | null }[]
}

export const useScheduleGroups = () => {
  const supabase = useSupabase()

  const groups  = ref<ScheduleGroup[]>([])
  const loading = ref(false)

  // 自分が参加しているグループを取得
  async function fetchMyGroups(myWorkerId: string) {
    loading.value = true
    try {
      const { data: memberRows } = await supabase
        .from('schedule_group_members')
        .select('group_id')
        .eq('worker_id', myWorkerId)

      const groupIds = (memberRows ?? []).map((r: any) => r.group_id)
      if (!groupIds.length) { groups.value = []; return }

      const { data } = await supabase
        .from('schedule_groups')
        .select('*, members:schedule_group_members(worker_id, worker:workers(id, name))')
        .in('id', groupIds)
        .order('created_at')

      groups.value = (data ?? []) as ScheduleGroup[]
    } finally {
      loading.value = false
    }
  }

  // グループ作成（作成者を自動メンバー登録）
  async function createGroup(name: string, myWorkerId: string): Promise<ScheduleGroup> {
    const { data, error } = await supabase
      .from('schedule_groups')
      .insert({ name, created_by: myWorkerId })
      .select()
      .single()
    if (error) throw error

    await supabase
      .from('schedule_group_members')
      .insert({ group_id: data.id, worker_id: myWorkerId })

    await fetchMyGroups(myWorkerId)
    return data as ScheduleGroup
  }

  // メンバーを追加
  async function addMember(groupId: string, workerId: string, myWorkerId: string) {
    const { error } = await supabase
      .from('schedule_group_members')
      .insert({ group_id: groupId, worker_id: workerId })
    if (error && !error.message.includes('unique')) throw error
    await fetchMyGroups(myWorkerId)
  }

  // メンバーを削除
  async function removeMember(groupId: string, workerId: string, myWorkerId: string) {
    await supabase
      .from('schedule_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('worker_id', workerId)
    await fetchMyGroups(myWorkerId)
  }

  // グループを削除
  async function deleteGroup(groupId: string, myWorkerId: string) {
    await supabase.from('schedule_groups').delete().eq('id', groupId)
    await fetchMyGroups(myWorkerId)
  }

  return {
    groups:       readonly(groups),
    loading:      readonly(loading),
    fetchMyGroups,
    createGroup,
    addMember,
    removeMember,
    deleteGroup,
  }
}
