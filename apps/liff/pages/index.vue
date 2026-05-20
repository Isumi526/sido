<template>
  <div class="home-page">
    <AppNav subtitle="ホーム" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <div class="home-body">

      <!-- ユーザーカード -->
      <div class="user-card">
        <div class="user-avatar">{{ avatarChar }}</div>
        <div class="user-info">
          <div class="user-name">{{ currentUser?.real_name ?? '読み込み中...' }}</div>
          <div class="user-role">{{ roleLabel }}</div>
        </div>
        <div class="user-date">{{ todayLabel }}</div>
      </div>

      <!-- 未送信アラート -->
      <div v-if="unsubmittedCount > 0" class="alert-card" @click="navigateTo('/report')">
        <span class="material-symbols-rounded alert-icon">warning</span>
        <div class="alert-body">
          <div class="alert-title">未送信の日報が {{ unsubmittedCount }} 件あります</div>
          <div class="alert-sub">タップして入力する</div>
        </div>
        <span class="material-symbols-rounded alert-arrow">chevron_right</span>
      </div>

      <!-- メニューグリッド -->
      <div class="menu-grid">
        <NuxtLink class="menu-card" to="/report">
          <span class="material-symbols-rounded menu-icon" style="color:#06C755">edit_note</span>
          <span class="menu-label">日報登録</span>
        </NuxtLink>
        <NuxtLink class="menu-card" to="/history">
          <span class="material-symbols-rounded menu-icon" style="color:#3b82f6">history</span>
          <span class="menu-label">日報履歴</span>
        </NuxtLink>
        <NuxtLink class="menu-card" to="/calendar">
          <span class="material-symbols-rounded menu-icon" style="color:#f59e0b">calendar_month</span>
          <span class="menu-label">予定管理</span>
        </NuxtLink>
        <NuxtLink class="menu-card" to="/groups">
          <span class="material-symbols-rounded menu-icon" style="color:#8b5cf6">group</span>
          <span class="menu-label">グループ管理</span>
        </NuxtLink>
        <NuxtLink class="menu-card" to="/expense/download">
          <span class="material-symbols-rounded menu-icon" style="color:#ef4444">picture_as_pdf</span>
          <span class="menu-label">経費PDF</span>
        </NuxtLink>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
const { profile } = useLiff()
const supabase    = useSupabase()
const config      = useRuntimeConfig()

const currentUser = ref<{ real_name: string; worker_role: 'factory' | 'site' } | null>(null)
const unsubmittedCount = ref(0)

const avatarChar = computed(() =>
  currentUser.value?.real_name?.charAt(0) ?? profile.value?.displayName?.charAt(0) ?? '?'
)

const roleLabel = computed(() => {
  if (!currentUser.value?.worker_role) return ''
  return currentUser.value.worker_role === 'factory' ? '工場 / 事務所' : '現場'
})

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
})

onMounted(async () => {
  // LIFFプロファイルが取得されるまで待機
  let tries = 0
  while (!profile.value?.userId && tries++ < 20) {
    await new Promise(r => setTimeout(r, 300))
  }
  const lineUserId = profile.value?.userId
  if (!lineUserId) return

  const { data: accountData } = await supabase
    .from('accounts').select('id').eq('slug', config.public.accountSlug).single()
  if (!accountData) return

  const { data: user } = await supabase
    .from('users')
    .select('real_name, worker_role')
    .eq('line_user_id', lineUserId)
    .eq('account_id', accountData.id)
    .single()
  if (user) currentUser.value = user as any

  // 未送信日報カウント（過去30日）
  const { data: worker } = await supabase
    .from('users').select('worker_id').eq('line_user_id', lineUserId).eq('account_id', accountData.id).single()
  if (worker?.worker_id) {
    const from = new Date(); from.setDate(from.getDate() - 30)
    const fromStr = from.toISOString().split('T')[0]
    const today   = new Date().toISOString().split('T')[0]
    const { data: reports } = await supabase
      .from('reports')
      .select('date')
      .eq('worker_id', worker.worker_id)
      .gte('date', fromStr)
      .lte('date', today)
    const submittedDates = new Set((reports ?? []).map((r: any) => r.date))
    let count = 0
    const cur = new Date(fromStr)
    const end = new Date(today)
    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0]
      if (!submittedDates.has(ds)) count++
      cur.setDate(cur.getDate() + 1)
    }
    unsubmittedCount.value = count
  }
})
</script>

<style scoped>
.home-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f2f2f7; overflow-x: hidden; }

.home-body { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* ユーザーカード */
.user-card {
  background: #06C755; border-radius: 16px;
  padding: 18px 20px; display: flex; align-items: center; gap: 14px;
  box-shadow: 0 2px 12px rgba(6,199,85,.25);
}
.user-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: rgba(255,255,255,.25); color: #fff;
  font-size: 20px; font-weight: 900;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.user-info { flex: 1; }
.user-name { font-size: 17px; font-weight: 700; color: #fff; }
.user-role { font-size: 12px; color: rgba(255,255,255,.8); margin-top: 2px; }
.user-date { font-size: 13px; color: rgba(255,255,255,.85); font-weight: 600; flex-shrink: 0; }

/* 未送信アラート */
.alert-card {
  background: #fff; border-radius: 12px;
  padding: 14px 16px; display: flex; align-items: center; gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  border-left: 4px solid #f59e0b; cursor: pointer;
}
.alert-card:active { background: #fffbeb; }
.alert-icon { color: #f59e0b; font-size: 26px; flex-shrink: 0;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
.alert-body { flex: 1; }
.alert-title { font-size: 14px; font-weight: 700; color: #111; }
.alert-sub   { font-size: 12px; color: #888; margin-top: 2px; }
.alert-arrow { color: #ccc; font-size: 22px; flex-shrink: 0; }

/* メニューグリッド */
.menu-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.menu-card {
  background: #fff; border-radius: 14px;
  padding: 20px 12px 16px; text-decoration: none;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  transition: background .15s;
}
.menu-card:active { background: #f5f5f5; }
.menu-icon {
  font-size: 32px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 32;
}
.menu-label { font-size: 12px; font-weight: 600; color: #333; text-align: center; }
</style>
