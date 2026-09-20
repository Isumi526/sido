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

/**
 * authMode==='password' の時だけ「パスワード変更」を出す（メール/ID認証作業員向け）。
 * canApplyPersonalExpense が true の作業員にだけ「個人経費」を出す（#2cbe3caa）。
 * inventoryEnabled が true のテナントにだけ「在庫」を出す（feature.inventory・ベータ）。
 * 未解決＝false 扱い＝出さない（フェイルセーフ。入口を開けたままにしない）。
 */
export function useNavItems(
  authMode: () => string | null | undefined,
  canApplyPersonalExpense?: () => boolean,
  inventoryEnabled?: () => boolean,
) {
  const { t } = useI18n()

  const items = computed<NavItem[]>(() => {
    const list: NavItem[] = [
      { path: '/checkin',          icon: 'how_to_reg',        label: t('nav.checkin'),          section: 'daily' },
      { path: '/chats',            icon: 'forum',             label: t('nav.chats'),            section: 'daily' },
      // ★「日報登録」は 2026-08-31 にメニューから外した。日報は 退勤打刻 → そのまま日報 が正規ルートで、
      //  出し忘れ・修正は履歴から入る（履歴に未送信バナーを置いた）。ルート /report 自体は残している
      //  ＝差戻し・残業承認・編集許可の通知が /report?edit= を直リンクしているため。
      { path: '/history',          icon: 'history',           label: t('nav.reportHistory'),    section: 'daily' },
      { path: '/overtime',         icon: 'more_time',         label: t('nav.overtimeRequest'),  section: 'daily' },
      { path: '/paid-leave',       icon: 'beach_access',      label: t('nav.paidLeave'),        section: 'daily', testId: 'menu-paid-leave' },
      { path: '/notifications',    icon: 'notifications',     label: t('nav.notifications'),    section: 'plan', testId: 'menu-notifications' },
      { path: '/calendar',         icon: 'calendar_month',    label: t('nav.schedule'),         section: 'plan' },
      { path: '/company-schedule', icon: 'apartment',         label: t('nav.companySchedule'),  section: 'plan' },
      { path: '/groups',           icon: 'group',             label: t('nav.groups'),           section: 'plan' },
      { path: '/subcontractors',   icon: 'handyman',          label: t('nav.subcontractors'),   section: 'plan' },
      { path: '/sites',            icon: 'location_on',       label: t('nav.sites'),             section: 'info' },
      { path: '/expense/download', icon: 'picture_as_pdf',    label: t('nav.expensePdf'),       section: 'info' },
      { path: '/rules',            icon: 'menu_book',         label: t('nav.rulebook'),         section: 'info' },
    ]
    if (canApplyPersonalExpense?.()) {
      // 挿入位置は「有給の直前」。数値の決め打ちだと上のリストを足し引きするたび静かにズレるので path で引く。
      const at = list.findIndex(i => i.path === '/paid-leave')
      list.splice(at < 0 ? list.length : at, 0, { path: '/expense/personal', icon: 'account_balance_wallet', label: '経費申請', section: 'daily', testId: 'menu-personal-expense' })
    }
    // 在庫①〜④（2026-09-14〜）: 引き上げ・持出・入荷の記録＋写真AI候補。
    // ★テナント別フラグ（settings feature.inventory・既定OFF＝ベータ）で出し分ける（2026-09-19 レビュー決定）。
    //  未解決・OFF は出さない（fail-closed）。画面 /inventory 側も同じフラグで閉じる。
    if (inventoryEnabled?.()) {
      const at = list.findIndex(i => i.path === '/expense/download')
      list.splice(at < 0 ? list.length : at, 0, { path: '/inventory', icon: 'inventory_2', label: t('nav.inventory'), section: 'info', testId: 'menu-inventory' })
    }
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
