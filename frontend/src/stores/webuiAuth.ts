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

  const verifyToken = async (candidate = token.value) => {
    const nextToken = candidate.trim()
    status.value = 'checking'

    const response = await fetch(
      WEBUI_SESSION_ENDPOINT,
      nextToken
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: nextToken }),
          }
        : { method: 'GET' },
    )

    if (!response.ok) {
      status.value = 'idle'
      if (isUnauthorizedStatus(response.status)) {
        clearToken()
        lastError.value = 'auth.invalidToken'
        return false
      }
      throw new Error(`Unexpected auth status: ${response.status}`)
    }

    setToken(nextToken)
    status.value = 'authenticated'
    lastError.value = ''
    return true
  }

  const ensureAuthenticated = async () => {
    hydrate()
    if (status.value === 'authenticated') return true
    return verifyToken(token.value)
  }

  const handleUnauthorized = async () => {
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
    try {
      await fetch(WEBUI_SESSION_ENDPOINT, { method: 'DELETE' })
    } finally {
      clearToken()
      status.value = 'idle'
      bootstrapped.value = false
      lastError.value = ''
      await router.replace('/login')
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
