import { createRouter, createWebHashHistory } from 'vue-router'

import { useWebuiAuthStore } from '@/stores'
import { buildLoginRedirect, resolveRedirectTarget } from '@/utils/webuiAuth'

import routes from './routes'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  const authStore = useWebuiAuthStore()

  if (to.meta.public) {
    if (to.path === '/login') {
      const ok = await authStore.ensureAuthenticated()
      if (ok) {
        return resolveRedirectTarget(to.query.redirect as string | undefined)
      }
    }

    return true
  }

  const ok = await authStore.ensureAuthenticated()
  if (ok) return true

  return buildLoginRedirect(to.fullPath)
})

export default router
