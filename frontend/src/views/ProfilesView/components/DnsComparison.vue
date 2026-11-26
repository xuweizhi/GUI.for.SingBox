<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { invokeBridge } from '@/bridge/browser/shared/webui'

import { queryDNSViaNode } from '@/api/kernel'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useKernelApiStore } from '@/stores/kernelApi'
import { useProfilesStore } from '@/stores/profiles'
import { generateDnsTransports } from '@/utils/generator'
import { message } from '@/utils/interaction'
import { resolvePrimaryProxyGroup, resolveProxyChain } from '@/views/HomeView/nodeController'

const props = defineProps<{ profile: App.Profile }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t, te } = useI18n()
const core = useKernelApiStore()
const settings = useAppSettingsStore()
const profiles = useProfilesStore()
const open = ref(false)
const domain = ref('example.com')
const queryType = ref('A')
const proxyTag = ref('')
const busy = ref(false)
const candidates = computed(() =>
  generateDnsTransports(props.profile.dns, props.profile.outbounds, props.profile.native),
)
type Result = { durationMs: number; answers?: string[]; error?: string }
type Path = 'direct' | 'proxy'
const rows = ref<Record<string, Partial<Record<Path, Result>>>>({})
const remoteTypes = ['udp', 'tcp', 'tls', 'https', 'quic', 'h3']
const networkServers = computed(() =>
  props.profile.dns.servers.filter((s) => remoteTypes.includes(s.type)),
)
const pending = ref<App.DnsServerConfig>()
let generation = 0
const clear = () => {
  pending.value = undefined
  generation++
  rows.value = {}
  busy.value = false
  proxyTag.value = ''
}
watch([open, domain, queryType, candidates], clear, { deep: true, flush: 'sync' })
onScopeDispose(clear)

const run = async () => {
  if (busy.value || !domain.value.trim() || !networkServers.value.length) return
  clear()
  const revision = generation
  busy.value = true
  let proxyError = 'diagnostics.noProxy'
  const selections: Record<string, string> = {}
  try {
    if (core.running) {
      try {
        await core.refreshConfig()
        await core.refreshProviderProxies()
        if (generation !== revision) return
        const mode = core.config.mode
        const group =
          mode === 'global'
            ? core.proxies.GLOBAL
            : mode === 'rule'
              ? resolvePrimaryProxyGroup(profiles.currentProfile, core.proxies)
              : undefined
        if (group) {
          const active = resolveProxyChain(group.name, core.proxies)
          if (active.leaf && !active.error) proxyTag.value = active.leafName
        }
        if (
          ['Direct', 'Reject', 'Selector', 'URLTest'].includes(
            core.proxies[proxyTag.value]?.type || '',
          )
        )
          proxyTag.value = ''
        for (const [tag, item] of Object.entries(core.proxies))
          if (item.now) selections[tag] = item.now
      } catch (error) {
        proxyError = String(error)
      }
    }
    const servers = candidates.value
    const proxy = proxyTag.value
    const branch = settings.app.kernel.branch
    const probeName = domain.value.trim()
    const type = queryType.value
    let hasNativeQuery = true
    const testPath = async (path: Path, tag: string): Promise<Result> => {
      if (path === 'proxy') {
        if (!proxy) return { durationMs: 0, error: proxyError }
        if (hasNativeQuery) {
          const matching = servers.filter((server) => server.tag === tag)
          if (matching.length !== 1) return { durationMs: 0, error: 'diagnostics.duplicateTag' }
          const native = await queryDNSViaNode(matching[0]!, probeName, type, proxy)
          if (native)
            return {
              durationMs: native.latency ?? 0,
              answers: native.addr || [],
              error: native.err || (!native.addr?.length ? 'diagnostics.noAnswer' : undefined),
            }
          hasNativeQuery = false
        }
      }
      return invokeBridge<Result>('ProbeDNS', [
        {
          path,
          servers,
          tag,
          domain: probeName,
          queryType: type,
          proxy,
          selections,
          branch,
        },
      ])
    }
    for (const candidate of networkServers.value) {
      if (revision !== generation) return
      const probe = async (path: Path) => {
        let result: Result
        try {
          result = await testPath(path, candidate.tag)
        } catch (error) {
          result = { durationMs: 0, error: String(error) }
        }
        if (generation === revision)
          rows.value[candidate.id] = { ...rows.value[candidate.id], [path]: result }
      }
      await Promise.all([probe('direct'), probe('proxy')])
    }
  } catch (error) {
    message.error(String(error))
  } finally {
    if (generation === revision) busy.value = false
  }
}

const format = (result?: Result) => {
  if (!result) return '—'
  if (result.error) return te(result.error) ? t(result.error) : result.error
  return `${result.answers?.join(', ')} · ${result.durationMs} ms`
}
const apply = () => {
  if (!pending.value) return
  emit('select', pending.value.id)
  open.value = false
}
</script>

<template>
  <Button size="small" class="mb-8" @click="open = true">{{ t('diagnostics.compareDns') }}</Button>
  <Modal
    v-model:open="open"
    size="drawer"
    :submit="false"
    cancel-text="common.close"
    title="diagnostics.compareDns"
  >
    <template #action
      ><div v-if="pending" class="flex flex-wrap items-center gap-8">
        {{ t('diagnostics.confirmDns', [pending.tag]) }}
        <Button @click="pending = undefined">{{ t('common.cancel') }}</Button>
        <Button type="primary" @click="apply">{{ t('common.confirm') }}</Button>
      </div></template
    >
    <div class="flex flex-col gap-8">
      <div class="flex flex-wrap items-center gap-8">
        <Input v-model="domain" :placeholder="t('diagnostics.domain')" />
        <Select
          v-model="queryType"
          :options="[
            { label: 'A', value: 'A' },
            { label: 'AAAA', value: 'AAAA' },
          ]"
        />
        <Button
          type="primary"
          :loading="busy"
          :disabled="!domain.trim() || !networkServers.length"
          @click="run"
          >{{ t('diagnostics.runDns') }}</Button
        >
      </div>
      <div class="text-12">{{ t('diagnostics.dnsPaths') }}</div>
      <Card v-for="server in profile.dns.servers" :key="server.id" :title="server.tag">
        <div v-if="remoteTypes.includes(server.type)" class="flex flex-col gap-4">
          <div>{{ t('diagnostics.direct') }} · {{ format(rows[server.id]?.direct) }}</div>
          <div>
            {{ t('diagnostics.proxy') }} {{ proxyTag }} · {{ format(rows[server.id]?.proxy) }}
          </div>
          <Button
            size="small"
            :disabled="
              !rows[server.id]?.direct?.answers?.length && !rows[server.id]?.proxy?.answers?.length
            "
            @click="pending = server"
            >{{ t('diagnostics.applyDns') }}</Button
          >
        </div>
        <div v-else>{{ t('diagnostics.notNetworkDns') }}</div>
      </Card>
    </div>
  </Modal>
</template>
