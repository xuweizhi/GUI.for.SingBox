<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { TunStackOptions } from '@/constant/kernel'
import { useKernelApiStore } from '@/stores'
import { message } from '@/utils'

const { t } = useI18n()
const kernelApiStore = useKernelApiStore()

const createValueWatcher = (
  initialValue: number | string | boolean,
  callback: (value: number | string | boolean) => Promise<void>,
) => {
  let lastValue = initialValue
  return (newValue: number | boolean) => {
    if (newValue !== lastValue) {
      callback(newValue)
        .then(() => {
          lastValue = newValue
          message.success('common.success')
        })
        .catch((e) => message.error(e.message || e))
    }
  }
}

const onPortSubmit = createValueWatcher(kernelApiStore.config.port, (port) =>
  kernelApiStore.updateConfig('http', port),
)
const onSocksPortSubmit = createValueWatcher(kernelApiStore.config['socks-port'], (port) =>
  kernelApiStore.updateConfig('socks', port),
)
const onMixedPortSubmit = createValueWatcher(kernelApiStore.config['mixed-port'], (port) =>
  kernelApiStore.updateConfig('mixed', port),
)
const onAllowLanChange = createValueWatcher(kernelApiStore.config['allow-lan'], (allow) =>
  kernelApiStore.updateConfig('allow-lan', allow),
)
const conStackChange = createValueWatcher(kernelApiStore.config.tun.stack, (stack) =>
  kernelApiStore.updateConfig('tun-stack', { stack }),
)
const onTunDeviceSubmit = createValueWatcher(kernelApiStore.config.tun.device, (device) =>
  kernelApiStore.updateConfig('tun-device', { device }),
)
const onInterfaceChange = createValueWatcher(
  kernelApiStore.config['interface-name'],
  (interface_name) => kernelApiStore.updateConfig('interface-name', { interface_name }),
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
          v-model="kernelApiStore.config['mixed-port']"
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
          v-model="kernelApiStore.config.port"
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
          v-model="kernelApiStore.config['socks-port']"
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
        <Switch v-model="kernelApiStore.config['allow-lan']" @change="onAllowLanChange" />
      </Card>
      <Card :title="t('kernel.inbounds.tun.stack')">
        <Select
          v-model="kernelApiStore.config.tun.stack"
          :options="TunStackOptions"
          auto-size
          @change="conStackChange"
        />
      </Card>
      <Card :title="t('kernel.inbounds.tun.interface_name')">
        <Input
          v-model="kernelApiStore.config.tun.device"
          auto-size
          class="w-full"
          submit-on-enter
          @submit="onTunDeviceSubmit"
        />
      </Card>
      <Card :title="t('kernel.route.default_interface')">
        <InterfaceSelect
          v-model="kernelApiStore.config['interface-name']"
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
