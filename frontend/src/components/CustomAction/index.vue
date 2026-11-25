<script lang="ts" setup>
import { computed, h, isVNode, ref, resolveComponent, reactive } from 'vue'

interface Props {
  actions: (App.CustomAction | App.CustomActionFn)[]
}

const props = defineProps<Props>()

const factories = new WeakMap<App.CustomActionFn, App.CustomAction>()
const api: App.CustomActionApi = {
  h: (type: any, ...args: any[]) => h(resolveComponent(type), ...args),
  ref,
}

const computedActions = computed(() =>
  props.actions.map((action) => {
    if (typeof action !== 'function') return action
    const existing = factories.get(action)
    if (existing) return existing
    const resolved = reactive(action(api))
    factories.set(action, resolved)
    return resolved
  }),
)

const resolveDynamicField = <T>(field: T): T => (typeof field === 'function' ? field(api) : field)

const renderCustomActionSlot = (slot: App.CustomAction['componentSlots']) => {
  const resolved = resolveDynamicField(slot ?? {})
  return isVNode(resolved) ? resolved : h('div', resolved)
}
</script>
<template>
  <component
    :is="action.component"
    v-for="(action, index) in computedActions"
    :key="actions[index]?.id"
    v-bind="resolveDynamicField(action.componentProps)"
  >
    <template
      v-for="[name, slot] in Object.entries(resolveDynamicField(action.componentSlots ?? {}))"
      :key="name"
      #[name]
    >
      <component :is="renderCustomActionSlot(slot)" />
    </template>
  </component>
</template>
