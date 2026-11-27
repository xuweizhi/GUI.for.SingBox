<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  CustomNodeProtocolOptions,
  getCustomNodeMissingFields,
  parseCustomNodeUriWithFallback,
  type CustomNodeDraft,
  type CustomNodeProtocol,
} from '@/utils'

const draft = defineModel<CustomNodeDraft>({ required: true })
const props = defineProps<{
  errorField?: string
  errorMessage?: string
}>()
const emit = defineEmits<{ parsed: [draft: CustomNodeDraft] }>()

const { t, te } = useI18n()
const uriInput = ref('')
const parsing = ref(false)
const parseNotice = ref<{ kind: 'success' | 'warn' | 'error'; text: string } | null>(null)
const showAdvancedTls = ref(false)

const missingFields = computed(() => new Set(getCustomNodeMissingFields(draft.value)))
const hasTlsSection = computed(() =>
  ['http', 'trojan', 'vless', 'vmess', 'hysteria2'].includes(draft.value.protocol),
)
const hasTransportSection = computed(() =>
  ['trojan', 'vless', 'vmess'].includes(draft.value.protocol),
)

const fieldLabel = (field: string) => {
  const map: Record<string, string> = {
    tag: 'subscribe.customNode.tag',
    server: 'subscribe.customNode.server',
    server_port: 'subscribe.customNode.port',
    method: 'subscribe.customNode.method',
    password: 'subscribe.customNode.password',
    uuid: 'subscribe.customNode.uuid',
  }
  return map[field] ? t(map[field]!) : field
}

const isFieldHighlighted = (field: string) =>
  props.errorField === field || (parseNotice.value?.kind === 'warn' && missingFields.value.has(field))

const handleProtocolChange = (nextProtocol: string) => {
  const protocol = nextProtocol as CustomNodeProtocol
  draft.value.protocol = protocol
  delete draft.value.extra
  if (protocol === 'trojan' || protocol === 'hysteria2') {
    draft.value.tlsEnabled = true
  } else if (protocol === 'socks') {
    draft.value.tlsEnabled = false
  }
  if (protocol === 'shadowsocks' && !draft.value.method) {
    draft.value.method = 'aes-256-gcm'
  }
}

const handleParseUri = async () => {
  const raw = uriInput.value.trim()
  if (!raw || parsing.value) return
  parsing.value = true
  try {
    const res = await parseCustomNodeUriWithFallback(raw)
    if (!res.ok) {
      parseNotice.value = { kind: 'error', text: te(res.error) ? t(res.error) : res.error }
      return
    }
    draft.value = { ...res.draft }
    if (
      res.draft.sni ||
      res.draft.insecure ||
      res.draft.utlsFingerprint ||
      res.draft.realityPublicKey ||
      res.draft.transportType
    ) {
      showAdvancedTls.value = true
    }
    if (res.missingFields.length) {
      parseNotice.value = {
        kind: 'warn',
        text: t('subscribe.customNode.parseMissing', [
          res.missingFields.map(fieldLabel).join('、'),
        ]),
      }
    } else {
      parseNotice.value = {
        kind: 'success',
        text: t('subscribe.customNode.parseSuccess'),
      }
    }
    emit('parsed', draft.value)
  } finally {
    parsing.value = false
  }
}

// Auto-parse when user pastes a recognized link scheme
watch(uriInput, (val, prev) => {
  const trimmed = val.trim()
  if (!trimmed || trimmed === prev?.trim()) return
  if (
    /^(socks5?|socks4a?|https?|ss|trojan|vless|vmess|hy2|hysteria2|tuic|anytls):\/\//i.test(
      trimmed,
    ) &&
    Math.abs(trimmed.length - (prev?.trim().length || 0)) > 6
  ) {
    void handleParseUri()
  }
})
</script>

<template>
  <div class="custom-node-editor flex flex-col gap-10">
    <div class="uri-box rounded-8 p-10 flex flex-col gap-6">
      <div class="text-12 font-bold">{{ t('subscribe.customNode.uriLabel') }}</div>
      <div class="flex items-center gap-6">
        <Input
          v-model="uriInput"
          data-testid="custom-node-uri"
          :placeholder="t('subscribe.customNode.uriPlaceholder')"
          allow-paste
          clearable
          class="flex-1"
          @keydown.enter.prevent="handleParseUri"
        />
        <Button
          data-testid="custom-node-parse"
          type="primary"
          size="small"
          :loading="parsing"
          :disabled="!uriInput.trim()"
          @click="handleParseUri"
        >
          {{ t('subscribe.customNode.parseBtn') }}
        </Button>
      </div>
      <div
        v-if="parseNotice"
        class="text-12"
        :class="{
          'text-danger': parseNotice.kind === 'error',
          'text-warning': parseNotice.kind === 'warn',
          'text-muted': parseNotice.kind === 'success',
        }"
        role="status"
      >
        {{ parseNotice.text }}
      </div>
    </div>

    <div class="form-item">
      {{ t('subscribe.customNode.protocol') }} *
      <div class="w-full">
        <Select
          :model-value="draft.protocol"
          :options="CustomNodeProtocolOptions"
          class="w-full"
          @update:model-value="handleProtocolChange(String($event))"
        />
      </div>
    </div>

    <div class="form-item" :data-invalid="isFieldHighlighted('tag')">
      {{ t('subscribe.customNode.tag') }} *
      <div class="w-full">
        <Input
          v-model="draft.tag"
          data-testid="custom-node-tag"
          :placeholder="t('subscribe.customNode.tag')"
          class="w-full"
        />
        <small v-if="errorField === 'tag'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>

    <div class="form-item" :data-invalid="isFieldHighlighted('server')">
      {{ t('subscribe.customNode.server') }} *
      <div class="w-full">
        <Input
          v-model="draft.server"
          data-testid="custom-node-server"
          placeholder="example.com / 1.2.3.4"
          class="w-full"
        />
        <small v-if="errorField === 'server'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>

    <div class="form-item" :data-invalid="isFieldHighlighted('server_port')">
      {{ t('subscribe.customNode.port') }} *
      <div class="w-full">
        <Input
          v-model="draft.server_port"
          data-testid="custom-node-port"
          type="number"
          :min="1"
          :max="65535"
          placeholder="443"
          class="w-full"
        />
        <small v-if="errorField === 'server_port'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>

    <!-- SOCKS -->
    <template v-if="draft.protocol === 'socks'">
      <div class="form-item">
        {{ t('subscribe.customNode.socksVersion') }}
        <Radio
          v-model="draft.socksVersion"
          size="small"
          :options="[
            { label: 'SOCKS5', value: '5' },
            { label: 'SOCKS4', value: '4' },
            { label: 'SOCKS4a', value: '4a' },
          ]"
        />
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.username') }}
        <div class="w-full">
          <Input
            v-model="draft.username"
            data-testid="custom-node-username"
            :placeholder="t('subscribe.customNode.optionalPlaceholder')"
            class="w-full"
          />
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.password') }}
        <div class="w-full">
          <Input
            v-model="draft.password"
            data-testid="custom-node-password"
            type="password"
            :placeholder="t('subscribe.customNode.optionalPlaceholder')"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <!-- HTTP / HTTPS -->
    <template v-else-if="draft.protocol === 'http'">
      <div class="form-item">
        {{ t('subscribe.customNode.username') }}
        <div class="w-full">
          <Input
            v-model="draft.username"
            :placeholder="t('subscribe.customNode.optionalPlaceholder')"
            class="w-full"
          />
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.password') }}
        <div class="w-full">
          <Input
            v-model="draft.password"
            type="password"
            :placeholder="t('subscribe.customNode.optionalPlaceholder')"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <!-- Shadowsocks -->
    <template v-else-if="draft.protocol === 'shadowsocks'">
      <div class="form-item" :data-invalid="isFieldHighlighted('method')">
        {{ t('subscribe.customNode.method') }} *
        <div class="w-full">
          <Input
            v-model="draft.method"
            placeholder="aes-256-gcm / 2022-blake3-aes-128-gcm"
            class="w-full"
          />
          <small v-if="errorField === 'method'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item" :data-invalid="isFieldHighlighted('password')">
        {{ t('subscribe.customNode.password') }} *
        <div class="w-full">
          <Input v-model="draft.password" type="password" class="w-full" />
          <small v-if="errorField === 'password'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
    </template>

    <!-- Trojan -->
    <template v-else-if="draft.protocol === 'trojan'">
      <div class="form-item" :data-invalid="isFieldHighlighted('password')">
        {{ t('subscribe.customNode.password') }} *
        <div class="w-full">
          <Input v-model="draft.password" type="password" class="w-full" />
          <small v-if="errorField === 'password'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
    </template>

    <!-- VLESS -->
    <template v-else-if="draft.protocol === 'vless'">
      <div class="form-item" :data-invalid="isFieldHighlighted('uuid')">
        {{ t('subscribe.customNode.uuid') }} *
        <div class="w-full">
          <Input v-model="draft.uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" class="w-full" />
          <small v-if="errorField === 'uuid'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.flow') }}
        <div class="w-full">
          <Input
            v-model="draft.flow"
            placeholder="xtls-rprx-vision"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <!-- VMess -->
    <template v-else-if="draft.protocol === 'vmess'">
      <div class="form-item" :data-invalid="isFieldHighlighted('uuid')">
        {{ t('subscribe.customNode.uuid') }} *
        <div class="w-full">
          <Input v-model="draft.uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" class="w-full" />
          <small v-if="errorField === 'uuid'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.security') }}
        <div class="w-full">
          <Input v-model="draft.security" placeholder="auto" class="w-full" />
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.alterId') }}
        <Input v-model="draft.alterId" type="number" :min="0" />
      </div>
    </template>

    <!-- Hysteria2 -->
    <template v-else-if="draft.protocol === 'hysteria2'">
      <div class="form-item" :data-invalid="isFieldHighlighted('password')">
        {{ t('subscribe.customNode.password') }} *
        <div class="w-full">
          <Input v-model="draft.password" type="password" class="w-full" />
          <small v-if="errorField === 'password'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item">
        {{ t('subscribe.customNode.obfsType') }}
        <div class="w-full">
          <Input
            v-model="draft.obfsType"
            :placeholder="t('subscribe.customNode.optionalPlaceholder') + ' (salamander)'"
            class="w-full"
          />
        </div>
      </div>
      <div v-if="draft.obfsType" class="form-item">
        {{ t('subscribe.customNode.obfsPassword') }}
        <div class="w-full">
          <Input v-model="draft.obfsPassword" type="password" class="w-full" />
        </div>
      </div>
    </template>

    <!-- TLS & Transport -->
    <template v-if="hasTlsSection">
      <Divider>
        <Button type="text" size="small" @click="showAdvancedTls = !showAdvancedTls">
          <Icon
            icon="arrowDown"
            :size="14"
            class="tls-chevron mr-4"
            :class="{ 'is-open': showAdvancedTls }"
          />
          {{ t('subscribe.customNode.tlsAndTransport') }}
        </Button>
      </Divider>
      <div v-show="showAdvancedTls" class="flex flex-col gap-8">
        <div v-if="draft.protocol !== 'hysteria2'" class="form-item">
          {{ t('subscribe.customNode.tlsEnabled') }}
          <Switch v-model="draft.tlsEnabled" />
        </div>
        <template v-if="draft.tlsEnabled || draft.protocol === 'hysteria2'">
          <div class="form-item">
            {{ t('subscribe.customNode.sni') }}
            <div class="w-full">
              <Input
                v-model="draft.sni"
                :placeholder="t('subscribe.customNode.optionalPlaceholder')"
                class="w-full"
              />
            </div>
          </div>
          <div class="form-item">
            {{ t('subscribe.customNode.insecure') }}
            <Switch v-model="draft.insecure" />
          </div>
          <div v-if="draft.protocol !== 'http'" class="form-item">
            {{ t('subscribe.customNode.utlsFingerprint') }}
            <div class="w-full">
              <Input v-model="draft.utlsFingerprint" placeholder="chrome / firefox" class="w-full" />
            </div>
          </div>
          <template v-if="draft.protocol === 'vless'">
            <div class="form-item">
              {{ t('subscribe.customNode.realityPublicKey') }}
              <div class="w-full">
                <Input
                  v-model="draft.realityPublicKey"
                  :placeholder="t('subscribe.customNode.optionalPlaceholder')"
                  class="w-full"
                />
              </div>
            </div>
            <div v-if="draft.realityPublicKey" class="form-item">
              {{ t('subscribe.customNode.realityShortId') }}
              <div class="w-full">
                <Input
                  v-model="draft.realityShortId"
                  :placeholder="t('subscribe.customNode.optionalPlaceholder')"
                  class="w-full"
                />
              </div>
            </div>
          </template>
        </template>

        <template v-if="hasTransportSection">
          <div class="form-item">
            {{ t('subscribe.customNode.transportType') }}
            <div class="w-full">
              <Select
                v-model="draft.transportType"
                :options="[
                  { label: t('subscribe.customNode.transportNone'), value: '' },
                  { label: 'WebSocket (ws)', value: 'ws' },
                  { label: 'gRPC', value: 'grpc' },
                  { label: 'HTTP / H2', value: 'http' },
                  { label: 'HTTPUpgrade', value: 'httpupgrade' },
                ]"
                class="w-full"
              />
            </div>
          </div>
          <template v-if="draft.transportType && draft.transportType !== 'grpc'">
            <div class="form-item">
              {{ t('subscribe.customNode.transportPath') }}
              <div class="w-full">
                <Input v-model="draft.transportPath" placeholder="/" class="w-full" />
              </div>
            </div>
            <div class="form-item">
              {{ t('subscribe.customNode.transportHost') }}
              <div class="w-full">
                <Input
                  v-model="draft.transportHost"
                  :placeholder="t('subscribe.customNode.optionalPlaceholder')"
                  class="w-full"
                />
              </div>
            </div>
          </template>
          <div v-else-if="draft.transportType === 'grpc'" class="form-item">
            {{ t('subscribe.customNode.grpcServiceName') }}
            <div class="w-full">
              <Input v-model="draft.grpcServiceName" class="w-full" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.uri-box {
  background: var(--surface-bg);
  border: 1px solid var(--surface-border, var(--border-color));
}
.text-warning {
  color: var(--warning-color);
}
.tls-chevron {
  transition: transform 0.2s ease;
}
.tls-chevron.is-open {
  transform: rotate(180deg);
}
</style>
