import { createRouter, createWebHistory } from 'vue-router'
import { currentUser, canViewManagementPages, waitForRoleResolved } from '../lib/auth'
import { estimateEnabled, waitForFeaturesResolved } from '../lib/features'
import Dashboard      from '../pages/index.vue'
import Workers        from '../pages/workers.vue'
import Sites          from '../pages/sites.vue'
import Contractors    from '../pages/contractors.vue'
import Subcontractors from '../pages/subcontractors.vue'
import Vehicles       from '../pages/vehicles.vue'
import Reports        from '../pages/reports.vue'
import SiteReports    from '../pages/site-reports.vue'
import Expenses       from '../pages/expenses.vue'
import ExpensesDaily  from '../pages/expenses-daily.vue'
import SubInvoices    from '../pages/subcontractor-invoices.vue'
import Settings       from '../pages/settings.vue'
import CompanyProfile from '../pages/company-profile.vue'
import Login          from '../pages/login.vue'
import Users          from '../pages/users.vue'
import WorkerReports  from '../pages/worker-reports.vue'
import Calendar       from '../pages/calendar.vue'
import PaidLeave      from '../pages/paid-leave.vue'
import SiteRules      from '../pages/site-rules.vue'
import Attendance     from '../pages/attendance.vue'
import ReminderHistory from '../pages/reminder-history.vue'
import OperationLogs   from '../pages/operation-logs.vue'
import NonSubmitters   from '../pages/non-submitters.vue'
import ReportEditApprovals from '../pages/report-edit-approvals.vue'
import ReportEditReview from '../pages/report-edit-review.vue'
import ReportSiteRelink   from '../pages/report-site-relink.vue'
import OvertimeApprovals from '../pages/overtime-approvals.vue'
import Estimates       from '../pages/estimates.vue'
import EstimatesList   from '../pages/estimate-list.vue'
import EstimateMasters from '../pages/estimate-masters.vue'
import EstimateBuilder from '../pages/estimate-builder.vue'
import PurchaseOrders  from '../pages/purchase-orders.vue'
import Process         from '../pages/process.vue'
import AiHelp          from '../pages/ai-help.vue'
import Faq             from '../pages/faq.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login',        component: Login,          meta: { public: true } },
    { path: '/',             component: Dashboard },
    { path: '/calendar',     component: Calendar },
    { path: '/schedule-categories', component: () => import('../pages/schedule-categories.vue') },
    { path: '/process',      component: Process },
    { path: '/workers',      component: Workers,        meta: { management: true } },
    { path: '/sites',        component: Sites },
    { path: '/sites/:id',    component: () => import('../pages/site-detail.vue') },
    { path: '/chats',        component: () => import('../pages/chats.vue') },
    { path: '/chats/account', component: () => import('../pages/account-chat.vue') },
    { path: '/chats/:id',    component: () => import('../pages/chat-detail.vue') },
    { path: '/contractors',  component: Contractors,    meta: { management: true } },
    { path: '/site-rules',   component: SiteRules },
    { path: '/attendance',   component: Attendance,     meta: { management: true } },
    { path: '/subcontractors', component: Subcontractors },
    { path: '/vehicles',     component: Vehicles,       meta: { management: true } },
    { path: '/reports',      component: Reports },
    { path: '/site-reports', component: SiteReports },
    { path: '/expenses',     component: Expenses,       meta: { management: true } },
    { path: '/expenses-daily', component: ExpensesDaily, meta: { management: true } },
    { path: '/gasoline-allocation', component: () => import('../pages/gasoline-allocation.vue'), meta: { management: true } },
    { path: '/subcontractor-invoices', component: SubInvoices, meta: { management: true } },
    { path: '/worker-reports', component: WorkerReports, meta: { management: true } },
    { path: '/paid-leave',    component: PaidLeave,      meta: { management: true } },
    { path: '/settings',       component: Settings,     meta: { management: true } },
    { path: '/company-profile', component: CompanyProfile, meta: { management: true } },
    { path: '/users',        component: Users,          meta: { management: true } },
    { path: '/reminder-history', component: ReminderHistory, meta: { management: true } },
    { path: '/operation-logs',   component: OperationLogs,   meta: { management: true } },
    { path: '/non-submitters',   component: NonSubmitters,   meta: { management: true } },
    { path: '/report-edit-approvals', component: ReportEditApprovals },
    { path: '/report-edit-review', component: ReportEditReview },
    { path: '/report-site-relink',    component: ReportSiteRelink },
    { path: '/overtime-approvals',    component: OvertimeApprovals },
    { path: '/ai-help',          component: AiHelp,     meta: { management: true } },
    { path: '/faq',              component: Faq,        meta: { management: true } },
    { path: '/estimates',        component: Estimates,  meta: { management: true, estimate: true } },
    { path: '/estimate-list',   component: EstimatesList, meta: { management: true, estimate: true } },
    { path: '/estimate-masters', component: EstimateMasters, meta: { management: true, estimate: true } },
    { path: '/estimate-builder', component: EstimateBuilder, meta: { management: true, estimate: true } },
    { path: '/purchase-orders',  component: PurchaseOrders,  meta: { management: true, estimate: true } },
    { path: '/drawing-materials', component: () => import('../pages/drawing-materials.vue'), meta: { management: true, estimate: true } },
  ],
})

router.beforeEach(async (to) => {
  const isPublic = to.meta.public === true
  if (!isPublic && !currentUser.value) return '/login'
  // ログイン済みで /login に来たらホームへ。ただしクエリにID/PASS等がある時は
  // 自動ログイン/アカウント切替の意図なので弾かず通す（デモURL用）。
  const hasLoginQuery = !!(to.query.email || to.query.id || to.query.pass || to.query.password)
  if (to.path === '/login' && currentUser.value && !hasLoginQuery) return '/'
  // 経営系ページは site_manager 不可（メニュー非表示に加えURL直打ちも塞ぐ）
  if (to.meta.management === true && currentUser.value) {
    await waitForRoleResolved()
    if (!canViewManagementPages.value) return '/'
  }
  // 見積もり機能はフラグOFFの間そもそも入れない（メニュー非表示に加えURL直打ちも塞ぐ）。
  //  8/19 の通しテストまで本番に露出させないための開閉（settings.estimate_feature_enabled）。
  if (to.meta.estimate === true && currentUser.value) {
    await waitForFeaturesResolved()
    if (!estimateEnabled.value) return '/'
  }
})
