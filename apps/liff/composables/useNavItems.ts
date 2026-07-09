// ============================================================
//  composables/useNavItems.ts
//  ハンバーガーメニュー(AppNav.vue)とホーム画面(pages/index.vue)で重複していた
//  ナビ項目定義を一本化。表記・並び・表示条件のズレを防ぐ（2026-07-10）。
//  「ホーム」自体・「ブラウザで開く」・言語切替・代理操作ボタンはハンバーガー/ホーム
//  それぞれの文脈固有ユーティリティのため対象外（両方に出すべき"遷移先"だけを対象）。
// ============================================================
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export type NavSection = 'daily' | 'plan' | 'info'

export interface NavItem {
  path:      string
  icon:      string
  label:     string
  section:   NavSection
  testId?:   string
}

/** authMode==='password' の時だけ「パスワード変更」を出す（メール/ID認証作業員向け） */
export function useNavItems(authMode: () => string | null | undefined) {
  const { t } = useI18n()

  const items = computed<NavItem[]>(() => {
    const list: NavItem[] = [
      { path: '/checkin',          icon: 'how_to_reg',        label: t('nav.checkin'),          section: 'daily' },
      { path: '/report',           icon: 'edit_note',         label: t('nav.reportRegister'),   section: 'daily' },
      { path: '/history',          icon: 'history',           label: t('nav.reportHistory'),    section: 'daily' },
      { path: '/overtime',         icon: 'more_time',         label: t('nav.overtimeRequest'),  section: 'daily' },
      { path: '/calendar',         icon: 'calendar_month',    label: t('nav.schedule'),         section: 'plan' },
      { path: '/groups',           icon: 'group',             label: t('nav.groups'),           section: 'plan' },
      { path: '/subcontractors',   icon: 'handyman',          label: t('nav.subcontractors'),   section: 'plan' },
      { path: '/sites',            icon: 'location_on',       label: t('nav.sites'),             section: 'info' },
      { path: '/expense/download', icon: 'picture_as_pdf',    label: t('nav.expensePdf'),       section: 'info' },
      { path: '/rules',            icon: 'menu_book',         label: t('nav.rulebook'),         section: 'info' },
    ]
    if (authMode() === 'password') {
      list.push({ path: '/password', icon: 'lock_reset', label: t('nav.passwordChange'), section: 'info', testId: 'menu-password' })
    }
    return list
  })

  const bySection = computed(() => ({
    daily: items.value.filter(i => i.section === 'daily'),
    plan:  items.value.filter(i => i.section === 'plan'),
    info:  items.value.filter(i => i.section === 'info'),
  }))

  return { items, bySection }
}
