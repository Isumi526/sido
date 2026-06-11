import { createRouter, createWebHistory } from 'vue-router'
import { currentUser } from '../lib/auth'
import Dashboard      from '../pages/index.vue'
import Workers        from '../pages/workers.vue'
import Sites          from '../pages/sites.vue'
import Contractors    from '../pages/contractors.vue'
import Subcontractors from '../pages/subcontractors.vue'
import Reports        from '../pages/reports.vue'
import SiteReports    from '../pages/site-reports.vue'
import Expenses       from '../pages/expenses.vue'
import SubInvoices    from '../pages/subcontractor-invoices.vue'
import Settings       from '../pages/settings.vue'
import Login          from '../pages/login.vue'
import Users          from '../pages/users.vue'
import WorkerReports  from '../pages/worker-reports.vue'
import Calendar       from '../pages/calendar.vue'
import PaidLeave      from '../pages/paid-leave.vue'
import SiteRules      from '../pages/site-rules.vue'
import Attendance     from '../pages/attendance.vue'
import ReminderHistory from '../pages/reminder-history.vue'
import NonSubmitters   from '../pages/non-submitters.vue'
import Estimates       from '../pages/estimates.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login',        component: Login,          meta: { public: true } },
    { path: '/',             component: Dashboard },
    { path: '/calendar',     component: Calendar },
    { path: '/workers',      component: Workers },
    { path: '/sites',        component: Sites },
    { path: '/contractors',  component: Contractors },
    { path: '/site-rules',   component: SiteRules },
    { path: '/attendance',   component: Attendance },
    { path: '/subcontractors', component: Subcontractors },
    { path: '/reports',      component: Reports },
    { path: '/site-reports', component: SiteReports },
    { path: '/expenses',     component: Expenses },
    { path: '/subcontractor-invoices', component: SubInvoices },
    { path: '/worker-reports', component: WorkerReports },
    { path: '/paid-leave',    component: PaidLeave },
    { path: '/settings',       component: Settings },
    { path: '/users',        component: Users },
    { path: '/reminder-history', component: ReminderHistory },
    { path: '/non-submitters',   component: NonSubmitters },
    { path: '/estimates',        component: Estimates },
  ],
})

router.beforeEach((to) => {
  const isPublic = to.meta.public === true
  if (!isPublic && !currentUser.value) return '/login'
  if (to.path === '/login' && currentUser.value) return '/'
})
