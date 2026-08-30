import { defineStore } from 'pinia'
import { ref } from 'vue'

import { GetEnv } from '@/bridge'

export const useEnvStore = defineStore('env', () => {
  const env = ref<App.AppEnv>({
    appName: '',
    appVersion: '',
    basePath: '',
    os: '' as App.OS,
    arch: '',
    isPrivileged: false,
    runtimeMode: 'webui',
  })

  const setupEnv = async () => {
    const runtimeEnv = await GetEnv()
    env.value = { ...runtimeEnv, runtimeMode: 'webui' }
  }

  return { env, setupEnv }
})
