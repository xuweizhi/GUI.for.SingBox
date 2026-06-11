import { defineStore } from 'pinia'
import { ref } from 'vue'

import router from '@/router'
import { isWebui } from '@/utils/env'
import {
  WEBUI_TOKEN_STORAGE_KEY,
  buildLoginRedirect,
  isUnauthorizedStatus,
} from '@/utils/webuiAuth'

type AuthStatus = 'idle' | 'checking' | 'authenticated'
const WEBUI_AUTH_PROBE_ENDPOINT = '/__webui/api/rpc'
const WEBUI_AUTH_PROBE_BODY = JSON.stringify({
  method: 'GetEnv',
  args: [''],
})

export const useWebuiAuthStore = defineStore('webui-auth', () => {
  const token = ref('')
  const status = ref<AuthStatus>('idle')
  const hydrated = ref(false)
  const bootstrapped = ref(false)
  const lastError = ref('')

  const hydrate = () => {
    if (!isWebui || hydrated.value) return

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
    if (!nextToken) {
      clearToken()
      status.value = 'idle'
      return false
    }

    status.value = 'checking'

    const response = await fetch(
      `${WEBUI_AUTH_PROBE_ENDPOINT}?token=${encodeURIComponent(nextToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: WEBUI_AUTH_PROBE_BODY,
      },
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
    if (!isWebui) return true
    if (!token.value) return false
    if (status.value === 'authenticated') return true
    return verifyToken(token.value)
  }

  const handleUnauthorized = async () => {
    clearToken()
    status.value = 'idle'
    bootstrapped.value = false
    lastError.value = 'auth.invalidToken'

    const currentPath = router.currentRoute.value.fullPath
    await router.replace(currentPath.startsWith('/login') ? '/login' : buildLoginRedirect(currentPath))
  }

  const logout = async () => {
    clearToken()
    status.value = 'idle'
    bootstrapped.value = false
    lastError.value = ''
    await router.replace('/login')
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
