<script lang="ts" setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { NetworkOptions, TunStackOptions } from '@/constant/kernel'
import {
  DefaultInboundDirect,
  DefaultInboundMixed,
  DefaultInboundHttp,
  DefaultInboundSocks,
  DefaultInboundTun,
} from '@/constant/profile'
import { Inbound } from '@/enums/kernel'
import { picker, sampleID } from '@/utils'

const model = defineModel<App.Profile['inbounds']>({ required: true })

const { t } = useI18n()

const expandedIds = ref(new Set<string>())
const addInbound = (inbound: App.Profile['inbounds'][number]) => {
  model.value.unshift(inbound)
  expandedIds.value.add(inbound.id)
}
const onToggle = (id: string, event: Event) => {
  const open = (event.target as HTMLDetailsElement).open
  if (open) expandedIds.value.add(id)
  else expandedIds.value.delete(id)
}
const inboundSummary = (inbound: App.Profile['inbounds'][number]) => {
  const parts =
    inbound.type !== Inbound.Tun
      ? [inbound.type, inbound[inbound.type]?.listen.listen_port]
      : ['tun', inbound.tun?.interface_name]
  return [...parts.filter((part) => part !== undefined && part !== null && part !== '')].join(' · ')
}
const handleDelete = (index: number) => {
  model.value.splice(index, 1)
}

const inbounds = [
  {
    label: 'Direct',
    value: () => {
      addInbound({
        id: sampleID(),
        tag: 'direct-in',
        type: Inbound.Direct,
        enable: true,
        direct: DefaultInboundDirect(),
      })
    },
  },
  {
    label: 'Mixed',
    value: () => {
      addInbound({
        id: sampleID(),
        tag: 'mixed-in',
        type: Inbound.Mixed,
        enable: true,
        mixed: DefaultInboundMixed(),
      })
    },
  },
  {
    label: 'Http',
    value: () => {
      addInbound({
        id: sampleID(),
        tag: 'http-in',
        type: Inbound.Http,
        enable: true,
        http: DefaultInboundHttp(),
      })
    },
  },
  {
    label: 'Socks',
    value: () => {
      addInbound({
        id: sampleID(),
        tag: 'socks-in',
        type: Inbound.Socks,
        enable: true,
        socks: DefaultInboundSocks(),
      })
    },
  },
  {
    label: 'Tun',
    value: () => {
      addInbound({
        id: sampleID(),
        tag: 'tun-in',
        type: Inbound.Tun,
        enable: true,
        tun: DefaultInboundTun(),
      })
    },
  },
]

const handleAdd = async () => {
  const fns = await picker.multi('common.add', inbounds).catch(() => [])
  fns.forEach((fn) => fn())
}

defineExpose({ handleAdd })
</script>

<template>
  <Empty v-if="model.length === 0">
    <template #description>
      <div class="flex flex-wrap justify-center gap-8">
        <Button v-for="inbound in inbounds" :key="inbound.label" @click="inbound.value">
          {{ t('common.add') }} {{ inbound.label }}
        </Button>
      </div>
    </template>
  </Empty>
  <template v-else>
    <div class="flex justify-end mb-8">
      <Button icon="add" type="primary" size="small" @click="handleAdd">
        {{ t('common.add') }}
      </Button>
    </div>
    <div v-draggable="[model, { ...DraggableOptions, handle: '.drag' }]">
      <Card v-for="(inbound, index) in model" :key="inbound.id" :title="inbound.tag" class="mb-8">
        <template #title-prefix>
          <Icon icon="drag" class="drag cursor-move" color="var(--muted-color)" />
        </template>
        <template #extra>
          <Switch v-model="inbound.enable" :label="'kernel.inbounds.enable'" />
          <Button
            icon="delete"
            icon-color="var(--danger-color)"
            type="text"
            size="small"
            :aria-label="t('common.delete')"
            @click="handleDelete(index)"
          />
        </template>
        <details
          :open="expandedIds.has(inbound.id)"
          @toggle="onToggle(inbound.id, $event)"
        >
          <summary class="cursor-pointer">
            {{ inboundSummary(inbound) }} · {{ t('common.edit') }}
          </summary>
          <div class="form-item">
            {{ t('kernel.inbounds.tag') }}
            <Input v-model="inbound.tag" />
          </div>
          <div v-if="inbound.type !== Inbound.Tun && inbound[inbound.type]">
            <div class="form-item">
              {{ t('kernel.inbounds.listen.listen') }}
              <Input v-model="inbound[inbound.type]!.listen.listen" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.listen.listen_port') }}
              <Input v-model="inbound[inbound.type]!.listen.listen_port" type="number" />
            </div>
            <div
              v-if="inbound.type !== Inbound.Direct"
              :class="{ 'items-start': inbound[inbound.type]!.users.length }"
              class="form-item"
            >
              {{ t('kernel.inbounds.users') }}
              <InputList v-model="inbound[inbound.type]!.users" placeholder="user:password" />
            </div>
            <div v-else class="form-item">
              {{ t('kernel.inbounds.direct.network') }}
              <Select
                v-model="inbound.direct!.network"
                :options="NetworkOptions"
                clearable
                :placeholder="t('kernel.inbounds.direct.default')"
              />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.listen.tcp_fast_open') }}
              <Switch v-model="inbound[inbound.type]!.listen.tcp_fast_open" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.listen.tcp_multi_path') }}
              <Switch v-model="inbound[inbound.type]!.listen.tcp_multi_path" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.listen.udp_fragment') }}
              <Switch v-model="inbound[inbound.type]!.listen.udp_fragment" />
            </div>
          </div>
          <div v-else-if="inbound.type === Inbound.Tun && inbound.tun">
            <div class="form-item">
              {{ t('kernel.inbounds.tun.interface_name') }}
              <Input v-model="inbound.tun.interface_name" editable />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.tun.stack') }}
              <Radio v-model="inbound.tun.stack" :options="TunStackOptions" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.tun.auto_route') }}
              <Switch v-model="inbound.tun.auto_route" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.tun.strict_route') }}
              <Switch v-model="inbound.tun.strict_route" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.tun.endpoint_independent_nat') }}
              <Switch v-model="inbound.tun.endpoint_independent_nat" />
            </div>
            <div class="form-item">
              {{ t('kernel.inbounds.tun.mtu') }}
              <Input v-model="inbound.tun.mtu" type="number" editable />
            </div>
            <div :class="{ 'items-start': inbound.tun.address.length }" class="form-item">
              {{ t('kernel.inbounds.tun.address') }}
              <InputList v-model="inbound.tun.address" />
            </div>
            <div :class="{ 'items-start': inbound.tun.route_address.length }" class="form-item">
              {{ t('kernel.inbounds.tun.route_address') }}
              <InputList v-model="inbound.tun.route_address" placeholder="0.0.0.0/1 ::1" />
            </div>
            <div
              :class="{ 'items-start': inbound.tun.route_exclude_address.length }"
              class="form-item"
            >
              {{ t('kernel.inbounds.tun.route_exclude_address') }}
              <InputList
                v-model="inbound.tun.route_exclude_address"
                placeholder="192.168.0.0/16 fc00::/7"
              />
            </div>
          </div>
        </details>
      </Card>
    </div>
  </template>
</template>
