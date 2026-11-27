<script setup lang="ts">
import { ref, inject, computed, h, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { FileExists, GetSystemProxy, HttpGet, ReadFile } from '@/bridge'
import {
  DefaultTestTimeout,
  DefaultTestURL,
  RequestMethodOptions,
  SubscriptionRequestProxyModeOptions,
} from '@/constant/app'
import { RequestProxyMode } from '@/enums/app'
import { useBool } from '@/hooks'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useAppSettingsStore, useSubscribesStore } from '@/stores'
import {
  buildSingBoxOutbound,
  deepClone,
  DefaultCustomNodeDraft,
  GetRequestProxy,
  message,
  sampleID,
  type CustomNodeDraft,
} from '@/utils'
import {
  extractSubscriptionConfig,
  parseSubscriptionDnsAddresses,
  validateSubscriptionEntries,
} from '@/utils/subscriptionConfig'

import Button from '@/components/Button/index.vue'
import CustomNodeEditor from './CustomNodeEditor.vue'

interface Props {
  id?: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const advancedId = useId()
const [showMore, toggleShowMore] = useBool(false)
const subscribeStore = useSubscribesStore()
const appSettingsStore = useAppSettingsStore()

const loading = ref(false)
const proxyTesting = ref(false)
const sub = ref<App.Subscription>(subscribeStore.getSubscribeTemplate())
const formMode = ref<'Http' | 'File' | 'Manual' | 'CustomNode'>(sub.value.type)
const customNodeDraft = ref<CustomNodeDraft>(DefaultCustomNodeDraft('socks'))
const manualSubs = computed(() =>
  subscribeStore.subscribes.filter((item) => item.type === 'Manual'),
)
const customTargetMode = ref<'new' | 'existing'>('new')
const customTargetSubId = ref('')

const dnsAddresses = ref('')
const importedDnsSummary = computed(() =>
  (sub.value.importedDns?.servers || [])
    .map((server) => {
      const address = server.address || server.server || server.type || 'unknown'
      return `${server.tag}: ${address}`
    })
    .join(' · '),
)

const isCustomNode = computed(() => !props.id && formMode.value === 'CustomNode')
const isManual = computed(() => !isCustomNode.value && sub.value.type === 'Manual')
const isRemote = computed(() => !isCustomNode.value && sub.value.type === 'Http')
const isCustomProxy = computed(() => sub.value.requestProxyMode === RequestProxyMode.Custom)

const handleModeChange = (mode: string) => {
  const next = mode as 'Http' | 'File' | 'Manual' | 'CustomNode'
  formMode.value = next
  if (next !== 'CustomNode') {
    sub.value.type = next
  } else if (manualSubs.value.length && !customTargetSubId.value) {
    customTargetSubId.value = manualSubs.value[0]!.id
  }
}

const handleCustomNodeParsed = (parsed: CustomNodeDraft) => {
  if (!sub.value.name.trim() && parsed.tag.trim()) {
    sub.value.name = parsed.tag.trim()
  }
}
const showProxyTest = computed(() => {
  if (sub.value.requestProxyMode === RequestProxyMode.None) {
    return false
  }
  if (sub.value.requestProxyMode === RequestProxyMode.Global) {
    return appSettingsStore.app.requestProxyMode !== RequestProxyMode.None
  }
  return true
})

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  if (loading.value) return
  if (props.id && !isDirty()) return handleSubmit()
  errorField.value = ''

  if (isCustomNode.value) {
    const built = buildSingBoxOutbound(customNodeDraft.value)
    if (!built.ok) {
      return invalid(built.field, t(built.error))
    }
    try {
      validateSubscriptionEntries([built.outbound])
    } catch (error: any) {
      message.error(error.message || error)
      return
    }
    const outbound = built.outbound
    loading.value = true
    try {
      if (customTargetMode.value === 'existing' && customTargetSubId.value) {
        const target = subscribeStore.getSubscribeById(customTargetSubId.value)
        if (!target) throw new Error('Target subscription not found')
        const raw = await ReadFile(target.path).catch(async (error) => {
          if (target.proxies.length || (await FileExists(target.path))) throw error
          return '[]'
        })
        const { outbounds: existingEntries } = extractSubscriptionConfig(JSON.parse(raw))
        if (existingEntries.some((entry) => entry.tag === outbound.tag)) {
          return invalid('tag', t('subscribe.duplicateNodeTag', [outbound.tag]))
        }
        const nextEntries = [...existingEntries, outbound]
        const nextSub = deepClone(target)
        nextSub.proxies.push({
          id: sampleID(),
          tag: outbound.tag,
          type: outbound.type,
        })
        await subscribeStore.editSubscribe(target.id, nextSub, {
          content: JSON.stringify(nextEntries, null, 2),
          assignments: [],
        })
      } else {
        const nextSub = deepClone(sub.value)
        nextSub.type = 'Manual'
        nextSub.name = nextSub.name.trim() || String(outbound.tag)
        nextSub.proxies = [
          {
            id: sampleID(),
            tag: outbound.tag,
            type: outbound.type,
          },
        ]
        await subscribeStore.addSubscribe(nextSub, true, JSON.stringify([outbound], null, 2))
      }
      message.success('common.success')
      await handleSubmit()
    } catch (error: any) {
      console.error(error)
      message.error(error.message || error)
    } finally {
      loading.value = false
    }
    return
  }

  if (!sub.value.name.trim()) {
    return invalid('name')
  }
  if (!isManual.value && !sub.value.url.trim()) {
    return invalid('url')
  }
  if (!sub.value.path.trim()) {
    showMore.value = true
    return invalid('path')
  }
  loading.value = true

  try {
    if (dnsAddresses.value !== initialDnsAddresses) {
      sub.value.outboundDns = dnsAddresses.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    }
    if (sub.value.preferOutboundDns) {
      try {
        parseSubscriptionDnsAddresses(sub.value.outboundDns || [])
      } catch (error) {
        showMore.value = true
        await invalid('dns', String(error))
        return
      }
    }
    if (props.id) {
      await subscribeStore.editSubscriptionSettings(original, sub.value)
    } else {
      await subscribeStore.addSubscribe(sub.value)
    }
    message.success('common.success')
    await handleSubmit()
  } catch (error: any) {
    console.error(error)
    message.error(error)
  } finally {
    loading.value = false
  }
}

const handleTestProxy = async () => {
  const proxy =
    sub.value.requestProxyMode === RequestProxyMode.Global
      ? await GetRequestProxy()
      : await GetRequestProxy(sub.value.requestProxyMode, sub.value.customProxy)
  const mode =
    sub.value.requestProxyMode === RequestProxyMode.Global
      ? appSettingsStore.app.requestProxyMode
      : sub.value.requestProxyMode
  const hasSystemProxy =
    mode === RequestProxyMode.System && !!(await GetSystemProxy().catch(() => ''))
  if (!proxy && !hasSystemProxy) {
    message.error('settings.requestProxy.empty')
    return
  }

  proxyTesting.value = true
  try {
    await HttpGet(
      DefaultTestURL,
      {},
      { Proxy: proxy, Timeout: Math.max(1, Math.ceil(DefaultTestTimeout / 1000)) },
    )
    message.success('settings.requestProxy.testSuccess')
  } catch (error) {
    message.error(error)
  } finally {
    proxyTesting.value = false
  }
}

if (props.id) {
  const s = subscribeStore.getSubscribeById(props.id)
  if (s) {
    sub.value = deepClone(s)
    formMode.value = s.type
  }
}

dnsAddresses.value = (sub.value.outboundDns || []).join('\n')
const initialDnsAddresses = dnsAddresses.value
const original = deepClone(sub.value)

const { errorField, errorMessage, invalid, isDirty } = useFormDraft(() => [
  sub.value,
  dnsAddresses.value,
  formMode.value,
  customNodeDraft.value,
  customTargetMode.value,
  customTargetSubId.value,
])
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
  <div ref="formRoot" class="resource-form subscription-form">
    <div class="form-item">
      {{ t('subscribes.subtype') }}
      <Radio
        :model-value="formMode"
        :options="[
          { label: 'common.http', value: 'Http' },
          { label: 'common.file', value: 'File' },
          { label: 'subscribe.manual', value: 'Manual' },
          ...(!props.id ? [{ label: 'subscribe.customNode.tab', value: 'CustomNode' }] : []),
        ]"
        @update:model-value="handleModeChange(String($event))"
      />
    </div>

    <template v-if="isCustomNode">
      <CustomNodeEditor
        v-model="customNodeDraft"
        :error-field="errorField"
        :error-message="errorMessage"
        @parsed="handleCustomNodeParsed"
      />
      <Divider />
      <div v-if="manualSubs.length" class="form-item">
        {{ t('subscribe.customNode.targetMode') }}
        <Radio
          v-model="customTargetMode"
          size="small"
          :options="[
            { label: 'subscribe.customNode.targetNew', value: 'new' },
            { label: 'subscribe.customNode.targetExisting', value: 'existing' },
          ]"
        />
      </div>
      <div v-if="customTargetMode === 'existing' && manualSubs.length" class="form-item">
        {{ t('subscribe.customNode.selectManualSub') }}
        <div class="w-full">
          <Select
            v-model="customTargetSubId"
            :options="manualSubs.map((item) => ({ label: item.name, value: item.id }))"
            class="w-full"
          />
        </div>
      </div>
      <div v-else class="form-item">
        {{ t('subscribe.name') }}
        <div class="w-full">
          <Input
            v-model="sub.name"
            :label="t('subscribe.name')"
            :placeholder="customNodeDraft.tag || t('subscribe.name')"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="form-item" :data-invalid="errorField === 'name'">
        {{ t('subscribe.name') }} *
        <div class="w-full">
          <Input v-model="sub.name" :label="t('subscribe.name')" autofocus class="w-full" />
          <small v-if="errorField === 'name'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div v-if="!isManual" class="form-item" :data-invalid="errorField === 'url'">
        {{ t(sub.type === 'Http' ? 'subscribe.url' : 'subscribe.localPath') }} *
        <div class="w-full">
          <Input
            v-model="sub.url"
            :label="t(sub.type === 'Http' ? 'subscribe.url' : 'subscribe.localPath')"
            :placeholder="sub.type === 'Http' ? 'http(s)://' : 'data/local/{filename}.json'"
            allow-paste
            class="w-full"
          />
          <small v-if="errorField === 'url'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <Divider>
        <Button
          type="text"
          :aria-expanded="showMore"
          :aria-controls="advancedId"
          @click="toggleShowMore"
        >
          <Icon icon="arrowDown" :size="14" class="advanced-chevron mr-4" :class="{ 'is-open': showMore }" />
          {{ t('common.advancedSettings') }}
        </Button>
      </Divider>
      <div v-show="showMore" :id="advancedId">
      <div v-if="isRemote" class="form-item">
        {{ t('subscribe.decryptPassword') }}
        <div class="w-full">
          <Input v-model="sub.decryptPassword" type="password" allow-paste class="w-full" />
        </div>
      </div>
      <div class="form-item" :data-invalid="errorField === 'path'">
        {{ t('subscribe.path') }} *
        <div class="w-full">
          <Input v-model="sub.path" placeholder="data/subscribes/{filename}.json" class="w-full" />
          <small v-if="errorField === 'path'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.preferOutboundDns') }}
        <Switch v-model="sub.preferOutboundDns" />
      </div>
      <div class="text-12 text-secondary mb-8">{{ t('subscribe.outboundDnsHint') }}</div>
      <div
        v-if="sub.preferOutboundDns"
        :data-invalid="errorField === 'dns'"
        class="form-item items-start"
      >
        {{ t('subscribe.outboundDns') }}
        <div class="w-full">
          <textarea
            v-model="dnsAddresses"
            rows="3"
            class="subscribe-dns-input w-full rounded-4 p-8"
            :aria-label="t('subscribe.outboundDns')"
            :placeholder="t('subscribe.outboundDnsPlaceholder')"
          />
          <small v-if="errorField === 'dns'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
          <div class="text-12 text-secondary mt-4">
            {{ t('subscribe.outboundDnsOverrideHint') }}
          </div>
        </div>
      </div>
      <div class="text-12 text-secondary mb-8 break-all">
        {{ t('subscribe.importedDns') }}: {{ importedDnsSummary || t('subscribe.noImportedDns') }}
      </div>
      <template v-if="!isManual">
        <div class="form-item">
          {{ t('subscribe.include') }}
          <div class="w-full">
            <Input v-model="sub.include" placeholder="keyword1|keyword2" class="w-full" />
          </div>
        </div>
        <div class="form-item">
          {{ t('subscribe.exclude') }}
          <div class="w-full">
            <Input v-model="sub.exclude" placeholder="keyword1|keyword2" class="w-full" />
          </div>
        </div>
        <div class="form-item">
          {{ t('subscribe.includeProtocol') }}
          <div class="w-full">
            <Input
              v-model="sub.includeProtocol"
              placeholder="direct|mixed|socks|http..."
              class="w-full"
            />
          </div>
        </div>
        <div class="form-item">
          {{ t('subscribe.excludeProtocol') }}
          <div class="w-full">
            <Input
              v-model="sub.excludeProtocol"
              placeholder="direct|mixed|socks|http..."
              class="w-full"
            />
          </div>
        </div>
        <div class="form-item">
          {{ t('subscribe.proxyPrefix') }}
          <div class="w-full">
            <Input v-model="sub.proxyPrefix" class="w-full" />
          </div>
        </div>
        <template v-if="isRemote">
          <div class="form-item">
            {{ t('subscribe.website') }}
            <div class="w-full">
              <Input v-model="sub.website" placeholder="http(s)://" class="w-full" />
            </div>
          </div>
          <div class="form-item">
            {{ t('subscribe.inSecure') }}
            <Switch v-model="sub.inSecure" />
          </div>
          <div class="form-item">
            {{ t('subscribe.requestTimeout') }}
            <Input v-model="sub.requestTimeout" type="number" :min="3" :max="180" />
          </div>
          <div class="form-item">
            {{ t('subscribe.requestMethod') }}
            <Radio v-model="sub.requestMethod" :options="RequestMethodOptions" />
          </div>
          <div class="form-item">
            {{ t('settings.requestProxy.name') }}
            <div class="flex flex-wrap items-center gap-6">
              <Button
                v-if="showProxyTest"
                :loading="proxyTesting"
                type="primary"
                size="small"
                @click="handleTestProxy"
              >
                {{ t('settings.requestProxy.test') }}
              </Button>
              <Radio
                v-model="sub.requestProxyMode"
                :options="SubscriptionRequestProxyModeOptions"
              />
            </div>
          </div>
          <div v-if="isCustomProxy" class="form-item">
            {{ t('settings.requestProxy.custom') }}
            <div class="w-full">
              <Input
                v-model="sub.customProxy"
                placeholder="scheme://username:password@host:port"
                clearable
                class="w-full"
              />
            </div>
          </div>
          <div
            :class="{ 'items-start': Object.keys(sub.header.request).length !== 0 }"
            class="form-item"
          >
            {{ t('subscribe.header.request') }}
            <KeyValueEditor v-model="sub.header.request" />
          </div>
          <div
            :class="{ 'items-start': Object.keys(sub.header.response).length !== 0 }"
            class="form-item"
          >
            {{ t('subscribe.header.response') }}
            <KeyValueEditor v-model="sub.header.response" />
          </div>
        </template>
      </template>
    </div>
    </template>
  </div>
</template>

<style scoped>
.subscription-form {
  padding: 4px 0 12px;
}
.subscription-form textarea {
  color: var(--color);
  border: 1px solid var(--surface-border, var(--border-color));
  background: var(--surface-bg, var(--card-bg));
  resize: vertical;
}
.advanced-chevron {
  transition: transform 0.2s ease;
}
.advanced-chevron.is-open {
  transform: rotate(180deg);
}
</style>
