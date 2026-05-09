import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../pages/index.vue'
import Workers from '../pages/workers.vue'
import Sites from '../pages/sites.vue'
import Subcontractors from '../pages/subcontractors.vue'
import Reports from '../pages/reports.vue'
import SiteReports from '../pages/site-reports.vue'
import Settings from '../pages/settings.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',               component: Dashboard },
    { path: '/workers',        component: Workers },
    { path: '/sites',          component: Sites },
    { path: '/subcontractors', component: Subcontractors },
    { path: '/reports',        component: Reports },
    { path: '/site-reports',   component: SiteReports },
    { path: '/settings',       component: Settings },
  ],
})
