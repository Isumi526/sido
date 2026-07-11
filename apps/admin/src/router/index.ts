import { createRouter, createWebHistory } from 'vue-router'
import { currentUser } from '../lib/auth'
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
    { path: '/workers',      component: Workers },
    { path: '/sites',        component: Sites },
    { path: '/sites/:id',    component: () => import('../pages/site-detail.vue') },
    { path: '/contractors',  component: Contractors },
    { path: '/site-rules',   component: SiteRules },
    { path: '/attendance',   component: Attendance },
    { path: '/subcontractors', component: Subcontractors },
    { path: '/vehicles',     component: Vehicles },
    { path: '/reports',      component: Reports },
    { path: '/site-reports', component: SiteReports },
    { path: '/expenses',     component: Expenses },
    { path: '/expenses-daily', component: ExpensesDaily },
    { path: '/gasoline-allocation', component: () => import('../pages/gasoline-allocation.vue') },
    { path: '/subcontractor-invoices', component: SubInvoices },
    { path: '/worker-reports', component: WorkerReports },
    { path: '/paid-leave',    component: PaidLeave },
    { path: '/settings',       component: Settings },
    { path: '/company-profile', component: CompanyProfile },
    { path: '/users',        component: Users },
    { path: '/reminder-history', component: ReminderHistory },
    { path: '/operation-logs',   component: OperationLogs },
    { path: '/non-submitters',   component: NonSubmitters },
    { path: '/report-edit-approvals', component: ReportEditApprovals },
    { path: '/report-site-relink',    component: ReportSiteRelink },
    { path: '/overtime-approvals',    component: OvertimeApprovals },
    { path: '/ai-help',          component: AiHelp },
    { path: '/faq',              component: Faq },
    { path: '/estimates',        component: Estimates },
    { path: '/estimate-list',   component: EstimatesList },
    { path: '/estimate-masters', component: EstimateMasters },
    { path: '/estimate-builder', component: EstimateBuilder },
    { path: '/purchase-orders',  component: PurchaseOrders },
    { path: '/drawing-materials', component: () => import('../pages/drawing-materials.vue') },
  ],
})

router.beforeEach((to) => {
  const isPublic = to.meta.public === true
  if (!isPublic && !currentUser.value) return '/login'
  // ログイン済みで /login に来たらホームへ。ただしクエリにID/PASS等がある時は
  // 自動ログイン/アカウント切替の意図なので弾かず通す（デモURL用）。
  const hasLoginQuery = !!(to.query.email || to.query.id || to.query.pass || to.query.password)
  if (to.path === '/login' && currentUser.value && !hasLoginQuery) return '/'
})
