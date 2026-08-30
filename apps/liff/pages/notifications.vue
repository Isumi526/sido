<template>
  <div class="app">
    <AppNav :subtitle="$t('notifications.subtitle')" :user-name="selfUser?.real_name" :user-role="selfUser?.worker_role" />

    <main class="main">
      <!-- ★2つに分ける（2026-08-30 ユーザー指示）。
           やること = 行動されるまで消えない／お知らせ = 開いた時点で消える。
           混ぜると読み飛ばした瞬間に「やること」が消え、誰も対応しないまま残る。 -->
      <div class="tabs">
        <button
          type="button" class="tab" :class="{ active: tab === 'todo' }"
          data-testid="notif-tab-todo" @click="tab = 'todo'"
        >
          {{ $t('notifications.tabTodo') }}
          <span v-if="pendingDocCount > 0" class="tab-badge">{{ pendingDocCount }}</span>
        </button>
        <button
          type="button" class="tab" :class="{ active: tab === 'info' }"
          data-testid="notif-tab-info" @click="tab = 'info'"
        >
          {{ $t('notifications.tabInfo') }}
          <span v-if="unreadNotifCount > 0" class="tab-badge">{{ unreadNotifCount }}</span>
        </button>
      </div>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <!-- やること：承認などの行動が済むまで残る -->
      <template v-else-if="tab === 'todo'">
        <div v-if="!pendingDocItems.length" class="empty-state" data-testid="todo-empty">
          <div class="material-symbols-rounded empty-icon">task_alt</div>
          <p class="empty-text">{{ $t('notifications.todoEmpty') }}</p>
        </div>
        <ul v-else class="notif-list">
          <li v-for="d in pendingDocItems" :key="d.attachmentId">
            <button class="notif tappable todo" data-testid="todo-item" @click="openTodo(d)">
              <span class="material-symbols-rounded notif-icon kind-todo">assignment_late</span>
              <span class="notif-body">
                <span class="notif-title">{{ $t('notifications.todoDocTitle') }}</span>
                <span class="notif-text">{{ d.siteName }}：{{ d.name || $t('notifications.untitled') }}</span>
                <span class="notif-time">{{ fmtWhen(d.createdAt) }}</span>
              </span>
              <span class="material-symbols-rounded notif-chev">chevron_right</span>
            </button>
          </li>
        </ul>
      </template>

      <div v-else-if="!items.length" class="empty-state">
        <div class="material-symbols-rounded empty-icon">notifications_none</div>
        <p class="empty-text">{{ $t('notifications.empty') }}</p>
      </div>

      <template v-else>
        <div class="head">
          <!-- ★このタブを開いた時点で既読になる（2026-08-30 ユーザー指示）ので、
               「すべて既読にする」ボタンは不要になった。履歴としては下に残る。 -->
          <span class="head-count" data-testid="notif-unread-count">
            {{ unreadNotifCount > 0 ? $t('notifications.unreadCount', { n: unreadNotifCount }) : $t('notifications.allRead') }}
          </span>
        </div>

        <ul class="notif-list">
          <li v-for="n in items" :key="n.id">
            <component
              :is="n.link_path ? 'button' : 'div'"
              class="notif"
              :class="{ unread: !n.read_at, tappable: !!n.link_path }"
              :data-testid="n.read_at ? 'notif-read' : 'notif-unread'"
              @click="n.link_path ? open(n) : undefined"
            >
              <span class="material-symbols-rounded notif-icon" :class="`kind-${n.kind}`">{{ iconOf(n.kind) }}</span>
              <span class="notif-body">
                <span class="notif-title">{{ n.title || $t('notifications.untitled') }}</span>
                <span v-if="n.body" class="notif-text">{{ n.body }}</span>
                <span class="notif-time">{{ fmtWhen(n.created_at) }}</span>
              </span>
              <span v-if="!n.read_at" class="notif-dot" aria-hidden="true" />
              <span v-if="n.link_path" class="material-symbols-rounded notif-chev">chevron_right</span>
            </component>
          </li>
        </ul>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  お知らせ（アプリ内通知）
//  ★なぜ要るか: LINE連携は基本しない方針で、メール通知も見られない前提。
//   アプリを開けば気づける場所が無いと、通知が事実上どこにも届かない
//   （2026-08-14 ユーザー指示）。今後の通知はここに集約していく。
//
//  ★既読も出す。従来の /calendar の未読バナーは未読しか引いておらず、
//   一度既読にすると二度と見られなかった。「読んだけど後で確認したい」が
//   通知の普通の使い方なので、履歴として残す。
// ============================================================
import type { User } from '~/types'

const supabase = useSupabase()
const router = useRouter()
const { getAccountId } = useAccount()
const { resolve } = useCurrentUser()

const loading = ref(true)
const items = ref<any[]>([])
const selfUser = ref<User | null>(null)

// ★既定は「やること」。放置されると困るのはこちらなので、開いた時に最初に目に入る側にする。
//  やることが無ければお知らせを開く（空のタブを見せない）。
const tab = ref<'todo' | 'info'>('todo')

/** やること（未承認の資料）をタップ → その現場へ。承認はそこで行う。 */
function openTodo(d: { siteId: string }) {
  router.push(`/sites/${d.siteId}`)
}

/** 種別ごとのアイコン。未知の種別でも無地で出す（通知が消えるより無地で出す方がまし） */
function iconOf(kind: string): string {
  switch (kind) {
    case 'report_reject':     return 'undo'
    case 'schedule':          return 'calendar_month'
    case 'overtime_decision': return 'more_time'
    case 'expense_reject':    return 'receipt_long'
    case 'chat_mention':      return 'alternate_email'
    case 'site_document':     return 'description'   // 送り出し資料の確認依頼
    default:                  return 'notifications'
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const accountId = await getAccountId()
    const user = await resolve()
    selfUser.value = (user as User) ?? null
    const workerId = user?.worker_id ?? null
    if (!accountId || !workerId) { items.value = []; return }

    // 既読も含めて新しい順。件数は上限を切る（無限に伸ばしても読まれない）
    // ★site_document は「やること」側で状態から出すので、お知らせ一覧には混ぜない。
    const { data } = await supabase.from('schedule_notifications')
      .select('id, kind, title, body, link_path, created_at, read_at')
      .eq('account_id', accountId).eq('worker_id', workerId)
      .neq('kind', 'site_document')
      .order('created_at', { ascending: false }).limit(100)
    items.value = data ?? []
  } catch (e) {
    console.error('[notifications] 取得に失敗:', e)
    items.value = []
  } finally {
    loading.value = false
  }
}

async function markRead(ids: string[]) {
  if (!ids.length) return
  await supabase.from('schedule_notifications')
    .update({ read_at: new Date().toISOString() }).in('id', ids)
}

/** タップ＝その1件だけ既読にして遷移する。 */
async function open(n: any) {
  if (!n.read_at) {
    n.read_at = new Date().toISOString()   // 先に見た目を変える（遷移で戻ってきた時に未読に戻らない）
    await markRead([n.id]).catch(() => {})
    await refreshNotifBadge()
  }
  router.push(n.link_path)
}

async function readAll() {
  const ids = items.value.filter((n) => !n.read_at).map((n) => n.id)
  const now = new Date().toISOString()
  for (const n of items.value) if (!n.read_at) n.read_at = now
  await markRead(ids).catch(() => {})
  await refreshNotifBadge()
}

// ★お知らせタブを開いた時点で既読にする（2026-08-30 ユーザー指示「一回開いた時点で消す」）。
//  一覧には履歴として残るが、バッジは消える。読めば済むものをいつまでも数え続けない。
//  「やること」は行動されるまで消えないので、ここでは触らない。
watch(tab, async (t) => {
  if (t === 'info') await readAll()
})

onMounted(async () => {
  await load()
  await Promise.all([refreshNotifBadge(), refreshPendingDocBadge()])
  // やることが無ければお知らせを開く（空のタブを見せない）＝開いた時点で既読になる
  if (pendingDocCount.value === 0) {
    tab.value = 'info'
    await readAll()
  }
})
</script>

<style scoped>
.main { padding: 12px 14px 24px; }

/* やること / お知らせ の切り替え */
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: #fff; border: 1px solid #e7e7e7; border-radius: 999px;
  padding: 9px 12px; font-size: 14px; font-weight: 700; color: var(--text2);
  font-family: inherit; cursor: pointer;
}
.tab.active { background: #06C755; border-color: #06C755; color: #fff; }
.tab-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: #e11d48; color: #fff; font-size: 11px; line-height: 18px; font-weight: 700;
}
.tab.active .tab-badge { background: #fff; color: #06C755; }

/* やること（行動するまで消えない）は橙で、読めば済むお知らせと区別する */
.notif.todo { border-color: #fcd34d; background: #fffbeb; }
.notif-icon.kind-todo { color: #d97706; }

.head { display: flex; align-items: center; margin-bottom: 10px; }
.head-count { font-size: 13px; color: var(--text2); }
.btn-read-all {
  margin-left: auto; background: #fff; border: 1px solid #ddd; border-radius: 8px;
  padding: 6px 12px; font-size: 13px; color: var(--text2); cursor: pointer;
}

.notif-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }

.notif {
  width: 100%; text-align: left; font: inherit; color: inherit;
  display: flex; align-items: flex-start; gap: 10px;
  background: #fff; border: 1px solid #e7e7e7; border-radius: var(--radius);
  padding: 12px 14px;
}
.notif.tappable { cursor: pointer; }
.notif.unread { border-color: #06C755; background: #f6fffa; }

.notif-icon { font-size: 22px; color: var(--text2); flex: none; }
.notif-icon.kind-report_reject { color: #c0392b; }
.notif-icon.kind-schedule      { color: #2563eb; }

.notif-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.notif-title { font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.5; }
.notif-text  { font-size: 13px; color: var(--text2); line-height: 1.6; white-space: pre-wrap; }
.notif-time  { font-size: 11px; color: #9aa0a6; }

.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: #06C755; flex: none; margin-top: 6px; }
.notif-chev { font-size: 20px; color: #c7c7c7; flex: none; align-self: center; }
</style>
