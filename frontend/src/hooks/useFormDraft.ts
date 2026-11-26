import { inject, nextTick, onScopeDispose, ref, useTemplateRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

export const draftGuardKey: InjectionKey<(guard: () => Promise<boolean>) => () => void> =
  Symbol('formDraft')

export function useFormDraft(snapshot: () => unknown) {
  const { t } = useI18n()
  let baseline = JSON.stringify(snapshot())
  const root = useTemplateRef<HTMLElement>('formRoot')
  const errorField = ref('')
  const errorMessage = ref('')
  const resetBaseline = () => {
    baseline = JSON.stringify(snapshot())
  }
  const register = inject(draftGuardKey, undefined)
  const isDirty = () => JSON.stringify(snapshot()) !== baseline
  const remove = register?.(async () => {
    if (!isDirty()) return true
    const { confirm } = await import('@/utils/interaction')
    return confirm('common.warning', 'workspace.discard').then(
      () => true,
      () => false,
    )
  })
  onScopeDispose(() => remove?.())
  const invalid = async (field: string, message = t('workspace.required')) => {
    errorField.value = field
    errorMessage.value = message
    await nextTick()
    const row = root.value?.querySelector<HTMLElement>('[data-invalid="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
    row
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), [tabindex="0"]:not([aria-disabled="true"])',
      )
      ?.focus()
  }
  return { errorField, errorMessage, invalid, resetBaseline, isDirty }
}
