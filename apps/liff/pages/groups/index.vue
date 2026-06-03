<template>
  <div class="groups-page">
    <AppNav subtitle="グループ管理" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />

    <div class="page-header">
      <h1 class="page-title">グループ管理</h1>
      <button class="btn-create" @click="showCreateModal = true">＋ 作成</button>
    </div>

    <div v-if="groupsStore.loading.value" class="loading">読み込み中...</div>

    <div v-else-if="!groupsStore.groups.value.length" class="empty">
      <p>グループがありません</p>
      <p class="empty-sub">グループを作成して、メンバーと予定を共有しましょう</p>
    </div>

    <div v-else class="group-list">
      <div v-for="group in groupsStore.groups.value" :key="group.id" class="group-card">
        <!-- グループヘッダー -->
        <div class="group-head" @click="toggleExpand(group.id)">
          <div class="group-info">
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ group.members.length }}名</span>
          </div>
          <span class="group-chevron" :class="{ open: expanded.has(group.id) }">›</span>
        </div>

        <!-- メンバーリスト（展開時） -->
        <div v-if="expanded.has(group.id)" class="group-body">
          <div class="member-list">
            <div v-for="m in group.members" :key="m.worker_id" class="member-row">
              <span class="member-avatar">{{ memberName(m).charAt(0) }}</span>
              <span class="member-name">{{ memberName(m) }}</span>
              <span v-if="m.worker_id === myWorkerId" class="member-badge">自分</span>
              <button
                v-else
                class="btn-remove"
                @click="handleRemoveMember(group, m.worker_id)"
              >削除</button>
            </div>
          </div>

          <!-- メンバー追加 -->
          <button class="btn-add-member" @click="openAddMember(group)">＋ メンバーを追加</button>

          <!-- デフォルト共有設定 -->
          <div class="group-setting-row">
            <div class="group-setting-info">
              <span class="group-setting-label">予定作成時にデフォルト共有</span>
              <span class="group-setting-sub">ONにすると新規予定でこのグループが自動選択されます</span>
            </div>
            <label class="ios-toggle">
              <input
                type="checkbox"
                :checked="group.default_share"
                @change="handleToggleDefaultShare(group)"
              />
              <span class="ios-toggle-track"></span>
            </label>
          </div>

          <!-- グループ操作 -->
          <div class="group-actions">
            <button class="btn-leave" @click="handleLeave(group)">
              {{ group.created_by === myWorkerId ? 'グループを削除' : 'グループから脱退' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- グループ作成モーダル -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="closeCreateModal">
      <div class="modal">
        <h2>グループを作成</h2>
        <div class="field">
          <label>グループ名 *</label>
          <input v-model="newGroupName" class="input" placeholder="例：現場チームA" />
        </div>
        <div class="field">
          <label>招待するメンバー</label>
          <div class="worker-pick-list">
            <label v-for="w in allOtherWorkers" :key="w.id" class="worker-pick-item">
              <input
                type="checkbox"
                :checked="newGroupInvitees.includes(w.id)"
                @change="toggleInvitee(w.id)"
              />
              <span>{{ w.name }}</span>
            </label>
            <p v-if="!allOtherWorkers.length" class="empty-sub">他の作業員がいません</p>
          </div>
        </div>
        <p v-if="createError" class="error-msg">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="closeCreateModal">キャンセル</button>
          <button class="btn-save" :disabled="creating" @click="handleCreate">
            {{ creating ? '作成中...' : '作成' }}
          </button>
        </div>
      </div>
    </div>

    <!-- メンバー追加モーダル -->
    <div v-if="addMemberTarget" class="modal-overlay" @click.self="addMemberTarget = null">
      <div class="modal">
        <h2>メンバーを追加</h2>
        <p class="modal-sub">「{{ addMemberTarget.name }}」に追加する作業員を選択</p>
        <div class="worker-pick-list">
          <label
            v-for="w in availableWorkers"
            :key="w.id"
            class="worker-pick-item"
          >
            <input
              type="checkbox"
              :checked="pickedWorkerIds.includes(w.id)"
              @change="togglePick(w.id)"
            />
            <span>{{ w.name }}</span>
          </label>
          <p v-if="!availableWorkers.length" class="empty-sub">追加できる作業員がいません</p>
        </div>
        <p v-if="addError" class="error-msg">{{ addError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="addMemberTarget = null">キャンセル</button>
          <button class="btn-save" :disabled="adding || !pickedWorkerIds.length" @click="handleAddMembers">
            {{ adding ? '追加中...' : '追加' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import { useScheduleGroups, type ScheduleGroup } from '~/composables/useScheduleGroups'

// groupsStore.groups は readonly 公開（consumerは読むだけ）。
// そのため group を受けるハンドラは DeepReadonly<ScheduleGroup> で受ける（mutateしない）。
const groupsStore = useScheduleGroups()
const schedules   = useSchedules()
const master      = useMaster()
const { profile } = useLiff()
const proxy       = useProxyMode()

// 代理モード時は代理先のworker_idを使用
const myWorkerId = computed(() => proxy.proxyTarget.value?.id ?? schedules.myWorkerId.value)

// ──────────────────── 展開状態 ────────────────────
const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value) // reactivity trigger
}

// ──────────────────── ヘルパー ────────────────────
function memberName(m: ScheduleGroup['members'][number]): string {
  return m.worker?.name ?? '(不明)'
}

// ──────────────────── グループ作成 ────────────────────
const showCreateModal  = ref(false)
const newGroupName     = ref('')
const newGroupInvitees = ref<string[]>([])
const creating         = ref(false)
const createError      = ref('')

const allOtherWorkers = computed(() =>
  (master.master.value.workers as any[]).filter((w: any) => w.active !== false && w.id !== myWorkerId.value)
)

function toggleInvitee(id: string) {
  const idx = newGroupInvitees.value.indexOf(id)
  if (idx === -1) newGroupInvitees.value.push(id)
  else newGroupInvitees.value.splice(idx, 1)
}

function closeCreateModal() {
  showCreateModal.value = false
  newGroupName.value = ''
  newGroupInvitees.value = []
  createError.value = ''
}

async function handleCreate() {
  if (!newGroupName.value.trim()) { createError.value = 'グループ名を入力してください'; return }
  if (!myWorkerId.value) { createError.value = '作業員情報が取得できません'; return }
  creating.value = true; createError.value = ''
  try {
    const group = await groupsStore.createGroup(newGroupName.value.trim(), myWorkerId.value)
    // 招待したメンバーを追加
    for (const wid of newGroupInvitees.value) {
      await groupsStore.addMember(group.id, wid, myWorkerId.value)
    }
    closeCreateModal()
  } catch (e) {
    createError.value = e instanceof Error ? e.message : '作成に失敗しました'
  } finally { creating.value = false }
}

// ──────────────────── メンバー追加 ────────────────────
const addMemberTarget  = ref<DeepReadonly<ScheduleGroup> | null>(null)
const pickedWorkerIds  = ref<string[]>([])
const adding           = ref(false)
const addError         = ref('')

const availableWorkers = computed(() => {
  if (!addMemberTarget.value) return []
  const existingIds = new Set(addMemberTarget.value.members.map(m => m.worker_id))
  return (master.master.value.workers as any[])
    .filter((w: any) => w.active !== false && !existingIds.has(w.id))
})

function openAddMember(group: DeepReadonly<ScheduleGroup>) {
  addMemberTarget.value = group
  pickedWorkerIds.value = []
  addError.value = ''
}

function togglePick(id: string) {
  const idx = pickedWorkerIds.value.indexOf(id)
  if (idx === -1) pickedWorkerIds.value.push(id)
  else pickedWorkerIds.value.splice(idx, 1)
}

async function handleAddMembers() {
  if (!addMemberTarget.value || !myWorkerId.value) return
  adding.value = true; addError.value = ''
  try {
    for (const wid of pickedWorkerIds.value) {
      await groupsStore.addMember(addMemberTarget.value.id, wid, myWorkerId.value)
    }
    addMemberTarget.value = null
  } catch (e) {
    addError.value = e instanceof Error ? e.message : '追加に失敗しました'
  } finally { adding.value = false }
}

// ──────────────────── メンバー削除 ────────────────────
async function handleRemoveMember(group: DeepReadonly<ScheduleGroup>, workerId: string) {
  if (!myWorkerId.value) return
  if (!confirm('このメンバーをグループから削除しますか？')) return
  try {
    await groupsStore.removeMember(group.id, workerId, myWorkerId.value)
  } catch (e) {
    alert(e instanceof Error ? e.message : '削除に失敗しました')
  }
}

// ──────────────────── デフォルト共有トグル ────────────────────
async function handleToggleDefaultShare(group: DeepReadonly<ScheduleGroup>) {
  if (!myWorkerId.value) return
  try {
    await groupsStore.updateGroup(group.id, { default_share: !group.default_share }, myWorkerId.value)
  } catch (e) {
    alert(e instanceof Error ? e.message : '更新に失敗しました')
  }
}

// ──────────────────── 脱退 / 削除 ────────────────────
async function handleLeave(group: DeepReadonly<ScheduleGroup>) {
  if (!myWorkerId.value) return
  const isCreator = group.created_by === myWorkerId.value
  const msg = isCreator
    ? `「${group.name}」を削除しますか？（全メンバーのグループへのアクセスが失われます）`
    : `「${group.name}」から脱退しますか？`
  if (!confirm(msg)) return
  try {
    if (isCreator) {
      await groupsStore.deleteGroup(group.id, myWorkerId.value)
    } else {
      await groupsStore.removeMember(group.id, myWorkerId.value, myWorkerId.value)
    }
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作に失敗しました')
  }
}

// ──────────────────── 初期化 ────────────────────
onMounted(async () => {
  await master.fetch()
  await schedules.resolveMyWorkerId()
  if (myWorkerId.value) {
    await groupsStore.fetchMyGroups(myWorkerId.value)
  }
})

watch(() => proxy.proxyTarget.value, async () => {
  if (myWorkerId.value) {
    await groupsStore.fetchMyGroups(myWorkerId.value)
  }
})
</script>

<style scoped>
.groups-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f8f9fa; }

.page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px; background: #fff; border-bottom: 1px solid #E0E0E0;
}
.page-title { font-size: 18px; font-weight: 700; margin: 0; }
.btn-create {
  background: #06C755; color: #fff; border: none;
  border-radius: 8px; padding: 8px 16px; font-size: 14px;
  font-weight: 600; cursor: pointer;
}

.loading { text-align: center; padding: 48px; color: #888; }
.empty { text-align: center; padding: 64px 24px; color: #888; }
.empty-sub { font-size: 13px; color: #aaa; margin-top: 8px; }

.group-list { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.group-card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden; }

.group-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px; cursor: pointer;
}
.group-head:active { background: #f5f5f5; }
.group-info { display: flex; align-items: center; gap: 8px; }
.group-name { font-size: 16px; font-weight: 700; color: #111; }
.group-count { font-size: 12px; color: #888; background: #f0f0f0; border-radius: 20px; padding: 2px 8px; }
.group-chevron { color: #aaa; font-size: 20px; transition: transform .2s; }
.group-chevron.open { transform: rotate(90deg); }

.group-body { border-top: 1px solid #f0f0f0; padding: 12px 16px; }

.member-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.member-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border-radius: 8px;
}
.member-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: #06C755; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; flex-shrink: 0;
}
.member-name { flex: 1; font-size: 15px; color: #111; }
.member-badge { font-size: 11px; color: #06C755; background: #e6f9ef; border-radius: 4px; padding: 2px 6px; }
.btn-remove {
  background: none; border: 1px solid #ef4444; color: #ef4444;
  border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
}

.btn-add-member {
  width: 100%; padding: 10px; background: #f0fdf4;
  border: 1px dashed #06C755; border-radius: 8px;
  color: #06C755; font-size: 14px; font-weight: 600; cursor: pointer;
  margin-bottom: 10px;
}

.group-setting-row {
  display: flex; align-items: center; gap: 12px;
  background: #f8f9fa; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
.group-setting-info { flex: 1; }
.group-setting-label { display: block; font-size: 14px; font-weight: 600; color: #111; }
.group-setting-sub { display: block; font-size: 12px; color: #888; margin-top: 2px; }

/* iOS トグル */
.ios-toggle { position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0; }
.ios-toggle input { opacity: 0; width: 0; height: 0; }
.ios-toggle-track {
  position: absolute; cursor: pointer; inset: 0;
  background: #E0E0E0; border-radius: 31px; transition: background .25s;
}
.ios-toggle-track::before {
  content: ''; position: absolute;
  width: 27px; height: 27px; left: 2px; bottom: 2px;
  background: #fff; border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,.2);
  transition: transform .25s;
}
.ios-toggle input:checked + .ios-toggle-track { background: #06C755; }
.ios-toggle input:checked + .ios-toggle-track::before { transform: translateX(20px); }

.group-actions { display: flex; justify-content: flex-end; }
.btn-leave {
  background: none; border: none; color: #ef4444;
  font-size: 13px; cursor: pointer; padding: 4px 0; text-decoration: underline;
}

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 20px 20px 0 0; padding: 24px; width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
.modal-sub { font-size: 13px; color: #888; margin: 0 0 16px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 500; }
.input { width: 100%; background: #f8f9fa; border: 1px solid #E0E0E0; border-radius: 8px; color: #111; padding: 10px 12px; font-size: 15px; box-sizing: border-box; }
.modal-actions { display: flex; gap: 10px; margin-top: 20px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f1f5f9; color: #555; border: none; border-radius: 8px; padding: 12px; font-size: 15px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }

.worker-pick-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; max-height: 280px; overflow-y: auto; }
.worker-pick-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border-radius: 8px; cursor: pointer; font-size: 15px; color: #111;
}
.worker-pick-item:active { background: #f5f5f5; }
</style>
