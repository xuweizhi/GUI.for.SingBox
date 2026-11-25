<script setup lang="ts">
import { ref, computed, inject, h } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n } from 'vue-i18n'

import { ClipboardSetText, FileExists, ReadFile } from '@/bridge'
import { DraggableOptions } from '@/constant/app'
import { useBool } from '@/hooks'
import { useNodeGroupsStore, useSubscribesStore } from '@/stores'
import { buildSmartRegExp, deepClone, message, sampleID } from '@/utils'
import {
  extractSubscriptionConfig,
  isSubscriptionEndpoint,
  validateSubscriptionEntries,
} from '@/utils/subscriptionConfig'

import Button from '@/components/Button/index.vue'

interface Props {
  sub: App.Subscription
}

const props = defineProps<Props>()

const editId = ref('')
const isEdit = ref(false)
const loading = ref(false)
const keywords = ref('')
const proxyType = ref('')
const details = ref()
const allFieldsProxies = ref<any[]>([])
const sub = ref(deepClone(props.sub))

const [showDetails, toggleDetails] = useBool(false)

const filteredProxyTypeOptions = computed(() => {
  const proxyProtocols = sub.value.proxies.reduce((p, c) => {
    p[c.type] = (p[c.type] || 0) + 1
    return p
  }, {} as Recordable)
  return [{ label: 'All', value: '', count: 0 }].concat(
    Object.entries(proxyProtocols).map(([label, count]) => ({
      label: `${label}(${count})`,
      value: label,
      count,
    })),
  )
})

const filteredProxies = computed(() => {
  return sub.value.proxies.filter((v) => {
    const hitType = proxyType.value ? proxyType.value === v.type : true
    const hitName = buildSmartRegExp(keywords.value, 'i').test(v.tag)
    return hitName && hitType
  })
})

const handleInspectProxy = async (record: App.Subscription['proxies'][0], edit = false) => {
  try {
    const proxy = await getProxyByTag(record.tag)
    details.value = JSON.stringify(proxy, null, 2)
    isEdit.value = edit
    editId.value = edit ? record.tag : ''
    toggleDetails()
  } catch (error: any) {
    message.error(error)
  }
}

const handleCopyProxy = async (record: App.Subscription['proxies'][0]) => {
  try {
    const proxy = await getProxyByTag(record.tag)
    await ClipboardSetText(JSON.stringify(proxy, null, 2))
    message.success('common.copied')
  } catch (error: any) {
    message.error(error)
  }
}

const pendingAssignments = ref<{ groupId: string; nodeId: string }[]>([])

const handleDeleteProxy = async (record: App.Subscription['proxies'][number]) => {
  try {
    await initAllFieldsProxies()
    sub.value.proxies = sub.value.proxies.filter((node) => node.id !== record.id)
    allFieldsProxies.value = allFieldsProxies.value.filter((node) => node.tag !== record.tag)
    pendingAssignments.value = pendingAssignments.value.filter((item) => item.nodeId !== record.id)
  } catch (error) {
    message.error(error)
  }
}

const handleAddToManualGroup = (groupId: string, record: App.Subscription['proxies'][number]) => {
  if (pendingAssignments.value.some((item) => item.groupId === groupId && item.nodeId === record.id)) return
  pendingAssignments.value.push({ groupId, nodeId: record.id })
  message.info('nodeGroups.addOnSave')
}

const menus: App.Menu[] = [
  {
    label: 'common.details',
    handler: (record: App.Subscription['proxies'][0]) => handleInspectProxy(record, false),
  },
  {
    label: 'common.copy',
    handler: handleCopyProxy,
  },
  {
    label: 'common.edit',
    handler: (record: App.Subscription['proxies'][0]) => handleInspectProxy(record, true),
  },
  {
    label: 'common.delete',
    handler: handleDeleteProxy,
  },
]

const { t } = useI18n()
const subscribeStore = useSubscribesStore()
const nodeGroupsStore = useNodeGroupsStore()
const manualNodeGroups = computed(() =>
  nodeGroupsStore.nodeGroups.filter((group) => group.mode === 'manual'),
)

const generateMenus = (record: App.Subscription['proxies'][0]): App.Menu[] => [
  ...menus.map((item) => ({ ...item, handler: () => item.handler?.(record) })),
  { label: '', separator: true },
  {
    label: 'nodeGroups.addNode',
    children: manualNodeGroups.value.length
      ? manualNodeGroups.value.map((group) => ({
          label: group.name,
          handler: () => handleAddToManualGroup(group.id, record),
        }))
      : [{ label: 'nodeGroups.noManualGroups' }],
  },
]

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  loading.value = true
  try {
    await initAllFieldsProxies()
    const entries = new Map(allFieldsProxies.value.map((entry) => [entry.tag, entry]))
    const sorted = sub.value.proxies.map((proxy) => {
      const entry = entries.get(proxy.tag)
      if (!entry) throw new Error(`Missing node configuration: ${proxy.tag}`)
      return entry
    })
    await subscribeStore.editSubscribe(sub.value.id, sub.value, {
      content: JSON.stringify(sorted, null, 2),
      assignments: pendingAssignments.value,
    })
    handleSubmit()
  } catch (error: any) {
    console.log(error)
    message.error(error)
  }
  loading.value = false
}

const handleAdd = async () => {
  editId.value = ''
  details.value = ''
  isEdit.value = true
  toggleDetails()
}

const onEditEnd = async () => {
  let proxy: any
  try {
    proxy = JSON.parse(details.value)

    validateSubscriptionEntries([proxy])
    if (sub.value.proxies.some((node) => node.tag === proxy.tag && node.tag !== editId.value))
      throw new Error(t('subscribe.duplicateNodeTag', [proxy.tag]))
    await initAllFieldsProxies()
  } catch (error: any) {
    console.log(error)
    message.error(error.message || error)
    return false
  }

  const allFieldsProxiesIdx = allFieldsProxies.value.findIndex((v: any) => v.tag === editId.value)
  const subProxiesIdx = sub.value.proxies.findIndex((v) => v.tag === editId.value)

  if (allFieldsProxiesIdx !== -1 && subProxiesIdx !== -1) {
    allFieldsProxies.value.splice(allFieldsProxiesIdx, 1, proxy)
    sub.value.proxies.splice(subProxiesIdx, 1, {
      ...sub.value.proxies[subProxiesIdx]!,
      tag: proxy.tag,
      type: proxy.type,
      kind: isSubscriptionEndpoint(proxy) ? 'endpoint' : undefined,
    })
  } else {
    allFieldsProxies.value.push(proxy)
    sub.value.proxies.push({
      id: sampleID(),
      tag: proxy.tag,
      type: proxy.type,
      ...(isSubscriptionEndpoint(proxy) ? { kind: 'endpoint' as const } : {}),
    })
  }
}

let loaded: Promise<void> | undefined
const initAllFieldsProxies = () => {
  loaded ??= (async () => {
    const content = await ReadFile(sub.value.path).catch(async (error) => {
      if (sub.value.proxies.length || await FileExists(sub.value.path)) throw error
      return '[]'
    })
    const extracted = extractSubscriptionConfig(JSON.parse(content))
    allFieldsProxies.value = extracted.outbounds
    if (extracted.importedDns) sub.value.importedDns = extracted.importedDns
  })().catch((error) => {
    loaded = undefined
    throw error
  })
  return loaded
}

const getProxyByTag = async (tag: string) => {
  await initAllFieldsProxies()
  const proxy = allFieldsProxies.value.find((v: any) => v.tag === tag)
  if (!proxy) throw 'Proxy Not Found'
  return proxy
}

const modalSlots = {
  cancel: () =>
    h(
      Button,
      {
        disabled: loading.value,
        onClick: handleCancel,
      },
      () => t('common.cancel'),
    ),
  submit: () =>
    h(
      Button,
      {
        type: 'primary',
        loading: loading.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-12 text-muted">
        {{ t('subscribes.proxies.type') }}:
      </span>
      <Select v-model="proxyType" :options="filteredProxyTypeOptions" size="small" />
      <Input
        v-model="keywords"
        :placeholder="t('subscribes.proxies.name')"
        clearable
        size="small"
        class="flex-1 min-w-160"
      />
      <span class="resource-count-badge">
        {{
          keywords.trim() || proxyType
            ? `${filteredProxies.length} / ${sub.proxies.length}`
            : sub.proxies.length
        }}
      </span>
      <Button type="primary" size="small" icon="add" @click="handleAdd">
        {{ t('subscribes.proxies.add') }}
      </Button>
    </div>

    <Empty v-if="filteredProxies.length === 0" />

    <VueDraggable
      v-else
      v-model="sub.proxies"
      v-bind="DraggableOptions"
      :disabled="Boolean(keywords.trim() || proxyType)"
      class="proxies-grid gap-8 mt-10 overflow-y-auto pb-8"
    >
      <Card
        v-for="proxy in filteredProxies"
        :key="proxy.tag"
        v-menu="generateMenus(proxy)"
        :title="proxy.tag"
      >
        <template #extra>
          <Dropdown>
            <Button
              type="text"
              size="small"
              icon="more"
              :aria-label="t('common.more') + ' · ' + proxy.tag"
            />
            <template #overlay="{ close }">
              <div class="flex flex-col gap-2 min-w-128 p-6">
                <Button
                  type="text"
                  size="small"
                  class="justify-start"
                  @click="
                    () => {
                      close()
                      handleInspectProxy(proxy, false)
                    }
                  "
                >
                  {{ t('common.details') }}
                </Button>
                <Button
                  type="text"
                  size="small"
                  class="justify-start"
                  @click="
                    () => {
                      close()
                      handleInspectProxy(proxy, true)
                    }
                  "
                >
                  {{ t('common.edit') }}
                </Button>
                <Button
                  type="text"
                  size="small"
                  class="justify-start"
                  @click="
                    () => {
                      close()
                      handleCopyProxy(proxy)
                    }
                  "
                >
                  {{ t('common.copy') }}
                </Button>
                <template v-if="manualNodeGroups.length">
                  <Divider size="small">{{ t('nodeGroups.addNode') }}</Divider>
                  <Button
                    v-for="group in manualNodeGroups"
                    :key="group.id"
                    type="text"
                    size="small"
                    class="justify-start"
                    @click="
                      () => {
                        close()
                        handleAddToManualGroup(group.id, proxy)
                      }
                    "
                  >
                    {{ group.name }}
                  </Button>
                </template>
                <Divider size="small" />
                <Button
                  type="text"
                  size="small"
                  class="justify-start text-danger"
                  @click="
                    () => {
                      close()
                      handleDeleteProxy(proxy)
                    }
                  "
                >
                  {{ t('common.delete') }}
                </Button>
              </div>
            </template>
          </Dropdown>
        </template>
        <div class="text-12 text-muted flex items-center gap-6">
          <span>{{ proxy.type }}</span>
          <Tag v-if="proxy.kind === 'endpoint'" size="small" color="blue">
            {{ t('subscribe.endpoint') }}
          </Tag>
        </div>
      </Card>
    </VueDraggable>
  </div>

  <Modal
    v-model:open="showDetails"
    :submit="isEdit"
    :mask-closable="!isEdit"
    :title="isEdit ? (editId ? 'common.edit' : 'common.add') : 'common.details'"
    :on-ok="onEditEnd"
    cancel-text="common.close"
    max-height="80"
    max-width="80"
  >
    <CodeEditor v-model="details" lang="json" :editable="isEdit" />
  </Modal>
</template>

<style scoped>
.proxies-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
}

@media (max-width: 1080px) {
  .proxies-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .proxies-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .proxies-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
