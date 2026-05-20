<template>
  <header class="app-nav no-print">
    <div class="app-nav-inner">
      <div class="app-brand">
        <span class="app-brand-name">{{ brandName }}</span>
        <span class="app-brand-div">|</span>
        <span class="app-brand-sub">{{ subtitle }}</span>
      </div>
      <button class="app-hamburger" @click="open = true" aria-label="メニューを開く">
        <span class="app-bar" />
        <span class="app-bar" />
        <span class="app-bar" />
      </button>
    </div>
  </header>

  <Teleport to="body">
    <Transition name="nav-fade">
      <div v-if="open" class="app-overlay" @click="open = false" />
    </Transition>
    <Transition name="nav-slide">
      <div v-if="open" class="app-drawer">
        <!-- ユーザー情報 -->
        <div class="drawer-head">
          <div v-if="userName" class="drawer-user">
            <div class="drawer-avatar">{{ userName.charAt(0) }}</div>
            <div>
              <div class="drawer-name">{{ userName }}</div>
              <div class="drawer-role">{{ roleLabel }}</div>
            </div>
          </div>
          <button class="drawer-close" @click="open = false">✕</button>
        </div>

        <!-- ナビゲーション -->
        <nav class="drawer-nav">
          <NuxtLink class="drawer-item" to="/" @click="open = false">
            <span class="drawer-item-icon">📋</span>
            <span>日報登録</span>
          </NuxtLink>
          <NuxtLink class="drawer-item" to="/history" @click="open = false">
            <span class="drawer-item-icon">📝</span>
            <span>日報履歴</span>
          </NuxtLink>
          <NuxtLink class="drawer-item" to="/calendar" @click="open = false">
            <span class="drawer-item-icon">📅</span>
            <span>予定管理</span>
          </NuxtLink>
          <NuxtLink class="drawer-item" to="/expense/download" @click="open = false">
            <span class="drawer-item-icon">📄</span>
            <span>経費PDF</span>
          </NuxtLink>
        </nav>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  subtitle:  string
  userName?: string
  userRole?: 'factory' | 'site'
}>()

const { slug } = useAccount()
const brandName = slug.toUpperCase()

const open = ref(false)

const roleLabel = computed(() => {
  if (!props.userRole) return ''
  return props.userRole === 'factory' ? '工場 / 事務所' : '現場'
})
</script>

<style scoped>
.app-nav {
  background: #fff;
  border-bottom: 1px solid #E0E0E0;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.app-nav-inner {
  max-width: 840px;
  margin: 0 auto;
  padding: 0 16px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.app-brand { display: flex; align-items: baseline; gap: 8px; }
.app-brand-name { font-size: 16px; font-weight: 900; letter-spacing: 5px; color: #06C755; }
.app-brand-div  { color: #E0E0E0; }
.app-brand-sub  { font-size: 12px; color: #888; letter-spacing: 2px; }

/* ハンバーガーボタン */
.app-hamburger {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  padding: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 8px;
  transition: background .15s;
}
.app-hamburger:hover { background: #f5f5f5; }
.app-bar {
  display: block;
  width: 100%;
  height: 2px;
  background: #333;
  border-radius: 2px;
}

/* オーバーレイ */
.app-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 200;
}
.nav-fade-enter-active,
.nav-fade-leave-active  { transition: opacity .2s; }
.nav-fade-enter-from,
.nav-fade-leave-to      { opacity: 0; }

/* ドロワー */
.app-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 260px;
  background: #fff;
  z-index: 201;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0,0,0,.12);
}
.nav-slide-enter-active,
.nav-slide-leave-active  { transition: transform .22s ease; }
.nav-slide-enter-from,
.nav-slide-leave-to      { transform: translateX(100%); }

/* ドロワーヘッダー */
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 16px;
  border-bottom: 1px solid #E0E0E0;
  min-height: 80px;
}
.drawer-user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #06C755;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.drawer-name { font-size: 14px; font-weight: 700; color: #111; }
.drawer-role { font-size: 11px; color: #888; margin-top: 2px; }
.drawer-close {
  background: transparent;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  flex-shrink: 0;
  margin-left: 4px;
}
.drawer-close:hover { background: #f5f5f5; color: #333; }

/* ナビ項目 */
.drawer-nav {
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.drawer-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 12px;
  border-radius: 10px;
  text-decoration: none;
  color: #111;
  font-size: 15px;
  font-weight: 600;
  transition: background .15s;
}
.drawer-item:hover,
.drawer-item.router-link-active { background: #f0fdf4; color: #06C755; }
.drawer-item-icon { font-size: 18px; }

@media print {
  .no-print { display: none !important; }
}
</style>
