import { defineStore } from 'pinia'
import { ref } from 'vue'

import router from '@/router'
import {
  WEBUI_TOKEN_STORAGE_KEY,
  buildLoginRedirect,
  isUnauthorizedStatus,
} from '@/utils/webuiAuth'

type AuthStatus = 'idle' | 'checking' | 'authenticated'
const WEBUI_SESSION_ENDPOINT = '/__webui/api/session'

export const useWebuiAuthStore = defineStore('webui-auth', () => {
  const token = ref('')
  const status = ref<AuthStatus>('idle')
  const hydrated = ref(false)
  const bootstrapped = ref(false)
  const lastError = ref('')
  let verificationRevision = 0
  let verificationController: AbortController | undefined
  let pendingVerification: Promise<boolean> | undefined

  const invalidateVerification = () => {
    verificationRevision += 1
    verificationController?.abort()
    verificationController = undefined
    pendingVerification = undefined
  }

  const hydrate = () => {
    if (hydrated.value) return

    token.value = localStorage.getItem(WEBUI_TOKEN_STORAGE_KEY) || ''
    hydrated.value = true
  }

  const setToken = (value: string) => {
    token.value = value.trim()
    if (token.value) {
      localStorage.setItem(WEBUI_TOKEN_STORAGE_KEY, token.value)
      return
    }

    localStorage.removeItem(WEBUI_TOKEN_STORAGE_KEY)
  }

  const clearToken = () => {
    token.value = ''
    localStorage.removeItem(WEBUI_TOKEN_STORAGE_KEY)
  }

  const verifyToken = (candidate = token.value) => {
    invalidateVerification()
    const revision = verificationRevision
    const controller = new AbortController()
    verificationController = controller
    const nextToken = candidate.trim()
    status.value = 'checking'
    const verification = (async () => {
      try {
        const response = await fetch(WEBUI_SESSION_ENDPOINT, {
          ...(nextToken
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: nextToken }),
              }
            : { method: 'GET' }),
          signal: controller.signal,
        })
        if (revision !== verificationRevision) return false
        if (!response.ok) {
          status.value = 'idle'
          if (isUnauthorizedStatus(response.status)) {
            clearToken()
            if (nextToken) lastError.value = 'auth.invalidToken'
            return false
          }
          throw new Error(`Unexpected auth status: ${response.status}`)
        }
        setToken(nextToken)
        status.value = 'authenticated'
        lastError.value = ''
        return true
      } catch (error) {
        if (revision !== verificationRevision) return false
        status.value = 'idle'
        throw error
      } finally {
        if (revision === verificationRevision) {
          pendingVerification = undefined
          verificationController = undefined
        }
      }
    })()
    pendingVerification = verification
    return verification
  }

  const ensureAuthenticated = async () => {
    hydrate()
    if (status.value === 'authenticated') return true
    return pendingVerification || verifyToken(token.value)
  }

  const handleUnauthorized = async () => {
    invalidateVerification()
    clearToken()
    status.value = 'idle'
    bootstrapped.value = false
    lastError.value = 'auth.invalidToken'

    const currentPath = router.currentRoute.value.fullPath
    await router.replace(
      currentPath.startsWith('/login') ? '/login' : buildLoginRedirect(currentPath),
    )
  }

  const logout = async () => {
    invalidateVerification()
    const revision = verificationRevision
    try {
      await fetch(WEBUI_SESSION_ENDPOINT, { method: 'DELETE' })
    } finally {
      if (revision === verificationRevision) {
        clearToken()
        status.value = 'idle'
        bootstrapped.value = false
        lastError.value = ''
        await router.replace('/login')
      }
    }
  }

  return {
    token,
    status,
    hydrated,
    bootstrapped,
    lastError,
    hydrate,
    setToken,
    clearToken,
    verifyToken,
    ensureAuthenticated,
    handleUnauthorized,
    logout,
  }
})
