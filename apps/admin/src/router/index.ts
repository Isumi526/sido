import { createRouter, createWebHistory } from 'vue-router'
import { currentUser } from '../lib/auth'
import Dashboard      from '../pages/index.vue'
import Workers        from '../pages/workers.vue'
import Sites          from '../pages/sites.vue'
import Subcontractors from '../pages/subcontractors.vue'
import Reports        from '../pages/reports.vue'
import SiteReports    from '../pages/site-reports.vue'
import Settings       from '../pages/settings.vue'
import Login          from '../pages/login.vue'
import Users          from '../pages/users.vue'
import WorkerReports  from '../pages/worker-reports.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login',        component: Login,          meta: { public: true } },
    { path: '/',             component: Dashboard },
    { path: '/workers',      component: Workers },
    { path: '/sites',        component: Sites },
    { path: '/subcontractors', component: Subcontractors },
    { path: '/reports',      component: Reports },
    { path: '/site-reports', component: SiteReports },
    { path: '/worker-reports', component: WorkerReports },
    { path: '/settings',       component: Settings },
    { path: '/users',        component: Users },
  ],
})

router.beforeEach((to) => {
  const isPublic = to.meta.public === true
  if (!isPublic && !currentUser.value) return '/login'
  if (to.path === '/login' && currentUser.value) return '/'
})
