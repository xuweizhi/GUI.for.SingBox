<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { TunStackOptions } from '@/constant/kernel'
import { useKernelApiStore } from '@/stores'
import { message } from '@/utils'

const { t } = useI18n()
const kernelApiStore = useKernelApiStore()

const busy = computed(
  () => kernelApiStore.starting || kernelApiStore.stopping || kernelApiStore.restarting,
)

const draft = reactive({
  port: kernelApiStore.config.port,
  socksPort: kernelApiStore.config['socks-port'],
  mixedPort: kernelApiStore.config['mixed-port'],
  allowLan: kernelApiStore.config['allow-lan'],
  tunStack: kernelApiStore.config.tun.stack,
  tunDevice: kernelApiStore.config.tun.device,
  interfaceName: kernelApiStore.config['interface-name'],
})

const syncDraftFromStore = () => {
  if (busy.value) return
  draft.port = kernelApiStore.config.port
  draft.socksPort = kernelApiStore.config['socks-port']
  draft.mixedPort = kernelApiStore.config['mixed-port']
  draft.allowLan = kernelApiStore.config['allow-lan']
  draft.tunStack = kernelApiStore.config.tun.stack
  draft.tunDevice = kernelApiStore.config.tun.device
  draft.interfaceName = kernelApiStore.config['interface-name']
}

watch([() => kernelApiStore.config, busy], syncDraftFromStore, { deep: true })

const applyRuntimeSetting = async <K extends keyof typeof draft>(
  key: K,
  newValue: (typeof draft)[K],
  callback: (value: (typeof draft)[K]) => Promise<void>,
) => {
  const previous = draft[key]
  if (newValue === previous || busy.value) return
  draft[key] = newValue
  try {
    await callback(newValue)
    message.success('common.success')
  } catch (e: any) {
    draft[key] = previous
    syncDraftFromStore()
    message.error(e?.message || e)
  }
}

const onPortSubmit = (port: number) =>
  applyRuntimeSetting('port', port, (val) => kernelApiStore.updateConfig('http', val))
const onSocksPortSubmit = (port: number) =>
  applyRuntimeSetting('socksPort', port, (val) => kernelApiStore.updateConfig('socks', val))
const onMixedPortSubmit = (port: number) =>
  applyRuntimeSetting('mixedPort', port, (val) => kernelApiStore.updateConfig('mixed', val))
const onAllowLanChange = (allow: boolean) =>
  applyRuntimeSetting('allowLan', allow, (val) => kernelApiStore.updateConfig('allow-lan', val))
const onStackChange = (stack: string) =>
  applyRuntimeSetting('tunStack', stack, (val) =>
    kernelApiStore.updateConfig('tun-stack', { stack: val }),
  )
const onTunDeviceSubmit = (device: string) =>
  applyRuntimeSetting('tunDevice', device, (val) =>
    kernelApiStore.updateConfig('tun-device', { device: val }),
  )
const onInterfaceChange = (interface_name: string) =>
  applyRuntimeSetting('interfaceName', interface_name, (val) =>
    kernelApiStore.updateConfig('interface-name', { interface_name: val }),
  )
</script>

<template>
  <div>
    <div class="runtime-tip rounded-8 px-12 py-8 mb-12 text-12 text-muted">
      {{ t('home.overview.settingsTips') }}
    </div>
    <div class="common-settings-grid pb-16">
      <Card :title="t('kernel.inbounds.mixedPort')">
        <Input
          :model-value="draft.mixedPort"
          :disabled="busy"
          :min="0"
          :max="65535"
          type="number"
          auto-size
          class="w-full"
          submit-on-enter
          @submit="onMixedPortSubmit"
        />
      </Card>
      <Card :title="t('kernel.inbounds.httpPort')">
        <Input
          :model-value="draft.port"
          :disabled="busy"
          :min="0"
          :max="65535"
          type="number"
          auto-size
          class="w-full"
          submit-on-enter
          @submit="onPortSubmit"
        />
      </Card>
      <Card :title="t('kernel.inbounds.socksPort')">
        <Input
          :model-value="draft.socksPort"
          :disabled="busy"
          :min="0"
          :max="65535"
          type="number"
          auto-size
          class="w-full"
          submit-on-enter
          @submit="onSocksPortSubmit"
        />
      </Card>
      <Card :title="t('kernel.allow-lan')">
        <Switch
          :model-value="draft.allowLan"
          :disabled="busy"
          @update:model-value="onAllowLanChange"
        />
      </Card>
      <Card :title="t('kernel.inbounds.tun.stack')">
        <Select
          :model-value="draft.tunStack"
          :disabled="busy"
          :options="TunStackOptions"
          auto-size
          @change="onStackChange"
        />
      </Card>
      <Card :title="t('kernel.inbounds.tun.interface_name')">
        <Input
          :model-value="draft.tunDevice"
          :disabled="busy"
          auto-size
          class="w-full"
          submit-on-enter
          @submit="onTunDeviceSubmit"
        />
      </Card>
      <Card :title="t('kernel.route.default_interface')">
        <InterfaceSelect
          :model-value="draft.interfaceName"
          :disabled="busy"
          auto-size
          @change="onInterfaceChange"
        />
      </Card>
    </div>
  </div>
</template>

<style scoped>
.runtime-tip {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
}

.common-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}
</style>
