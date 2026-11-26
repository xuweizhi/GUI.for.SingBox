<script setup lang="ts">
import { autocompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { linter } from '@codemirror/lint'
import { MergeView } from '@codemirror/merge'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap, placeholder as Placeholder } from '@codemirror/view'
import { EditorView, basicSetup } from 'codemirror'
import * as parserBabel from 'prettier/parser-babel'
import * as parserYaml from 'prettier/parser-yaml'
import estreePlugin from 'prettier/plugins/estree'
import * as prettier from 'prettier/standalone'
import { watch, onUnmounted, onMounted, useTemplateRef, inject } from 'vue'

import { ClipboardSetText } from '@/bridge'
import { Theme } from '@/enums/app'
import { useAppSettingsStore } from '@/stores'
import { debounce, message } from '@/utils'
import { getCompletions } from '@/utils/completion'

import { IS_IN_MODAL } from '@/components/Modal/index.vue'

interface Props {
  original?: string
  modelValue?: string
  editable?: boolean
  lang?: 'json' | 'javascript' | 'yaml'
  mode?: 'editor' | 'diff'
  placeholder?: string
  toolbar?: boolean
  plain?: boolean
  plugin?: Record<string, any>
}

const emit = defineEmits(['change', 'update:modelValue'])
const props = withDefaults(defineProps<Props>(), {
  original: undefined,
  modelValue: '',
  lang: 'json',
  toolbar: true,
  plain: false,
  mode: 'editor',
  placeholder: '',
  plugin: undefined,
})

const { promise: editorReady, resolve: markEditorReady } = Promise.withResolvers()
let applyingExternalUpdate = false
let disposed = false

watch(
  () => props.modelValue,
  async (val) => {
    await editorReady
    if (disposed || val !== props.modelValue) return
    const view = editorView || mergeView?.b
    if (view && val != view.state.doc.toString()) {
      notifyChange.cancel()
      applyingExternalUpdate = true
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: val },
        })
      } finally {
        applyingExternalUpdate = false
      }
    }
  },
)

let editorView: EditorView
let mergeView: MergeView
const themeCompartment = new Compartment()
const editability = new Compartment()
const editExtensions = () => [
  EditorView.editable.of(props.editable),
  EditorState.readOnly.of(!props.editable),
]
watch(
  () => props.editable,
  () => {
    const view = editorView || mergeView?.b
    view?.dispatch({ effects: editability.reconfigure(editExtensions()) })
  },
)
const domRef = useTemplateRef('domRef')
const appSettings = useAppSettingsStore()

const notifyChange = debounce((content: string) => emit('change', content), 300)
const onChange = (content: string) => {
  if (applyingExternalUpdate || disposed) return
  // Save actions must always observe the document currently shown in the editor.
  emit('update:modelValue', content)
  void notifyChange(content)
}

const formatDoc = async (view: EditorView) => {
  if (!props.editable) return
  const content = view.state.doc.toString()
  const cursor = view.state.selection.ranges[0]?.from || 0
  try {
    const parser = { javascript: 'babel', yaml: 'yaml', json: 'json' }[props.lang]
    const plugins = {
      javascript: [parserBabel, estreePlugin],
      yaml: [parserYaml],
      json: [parserBabel, estreePlugin],
    }[props.lang]
    const { formatted, cursorOffset } = await prettier.formatWithCursor(content, {
      cursorOffset: cursor,
      parser,
      plugins,
      // https://github.com/GUI-for-Cores/Plugin-Hub/blob/main/.prettierrc.json
      semi: false,
      tabWidth: 2,
      singleQuote: true,
      printWidth: 160,
      trailingComma: 'none',
    })
    if (
      !disposed &&
      props.editable &&
      content !== formatted &&
      view.state.doc.toString() === content
    ) {
      view.dispatch({
        changes: { from: 0, to: content.length, insert: formatted },
        selection: { anchor: cursorOffset, head: cursorOffset },
      })
    }
  } catch (error: any) {
    message.error(error.message || error)
  }
}

watch(
  () => appSettings.themeMode,
  (theme) => {
    const views = editorView ? [editorView] : mergeView ? [mergeView.a, mergeView.b] : []
    views.forEach((view) => {
      view.dispatch({
        effects: themeCompartment.reconfigure(
          theme === Theme.Dark ? [EditorView.theme({}, { dark: true }), oneDark] : [],
        ),
      })
    })
  },
)

let timer: ReturnType<typeof setTimeout>
onMounted(() => (timer = setTimeout(() => initEditor(), inject(IS_IN_MODAL, false) ? 100 : 0)))
onUnmounted(() => {
  disposed = true
  notifyChange.cancel()
  clearTimeout(timer)
  const view = editorView || mergeView
  view?.destroy()
})

const initEditor = () => {
  domRef.value!.innerHTML = ''

  const extensions = [
    basicSetup,
    // keymap
    keymap.of([
      indentWithTab,
      {
        key: 'Shift-Alt-f',
        run: function (v: EditorView) {
          formatDoc(v)
          return true
        },
      },
    ]),
    // code wrap
    EditorView.lineWrapping,
    // placeholder
    Placeholder(props.placeholder),
    // theme
    themeCompartment.of(
      appSettings.themeMode === Theme.Dark ? [EditorView.theme({}, { dark: true }), oneDark] : [],
    ),
    ...(props.lang === 'javascript'
      ? [autocompletion({ override: getCompletions(props.plugin) })]
      : []),
    // lint
    ...(props.lang === 'json' ? [linter(jsonParseLinter())] : []),
    // lang
    ...(['javascript', 'json', 'yaml'].includes(props.lang)
      ? [{ javascript, json, yaml }[props.lang]()]
      : []),
    EditorView.updateListener.of((update) => {
      update.docChanged && onChange(update.state.doc.toString())
    }),
  ]

  if (props.mode === 'editor') {
    editorView = new EditorView({
      doc: props.modelValue,
      parent: domRef.value!,
      extensions: [...extensions, editability.of(editExtensions())],
    })
  } else {
    mergeView = new MergeView({
      parent: domRef.value!,
      a: {
        doc: props.original ?? props.modelValue,
        extensions: [...extensions, EditorView.editable.of(false), EditorState.readOnly.of(true)],
      },
      b: {
        doc: props.modelValue,
        extensions: [...extensions, editability.of(editExtensions())],
      },
    })
  }

  markEditorReady(null)
}
const copyDocument = async () => {
  try {
    await ClipboardSetText((editorView || mergeView?.b)?.state.doc.toString() ?? props.modelValue)
    message.success('common.copied')
  } catch (error) {
    message.error(error)
  }
}
const formatDocument = () => {
  const view = editorView || mergeView?.b
  if (view) void formatDoc(view)
}
</script>

<template>
  <div class="code-editor" :class="{ 'is-plain': plain }">
    <div v-if="toolbar" class="code-editor__toolbar flex items-center gap-8 px-8 py-4">
      <span class="text-muted mr-auto">{{ lang }}</span>
      <Button v-if="editable" size="small" type="text" @click="formatDocument">{{
        $t('workspace.format')
      }}</Button>
      <Button size="small" type="text" @click="copyDocument">{{ $t('common.copy') }}</Button>
    </div>
    <div ref="domRef" class="editor-host" @keydown.esc.stop @keydown.esc.prevent>
      <div class="flex justify-center">
        <Button loading type="link" />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.code-editor {
  min-width: 0;
  min-height: 180px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--surface-border);
  border-radius: var(--control-radius);

  &.is-plain {
    border: 0;
    border-radius: 0;
  }
}
.code-editor__toolbar {
  border-bottom: 1px solid var(--border-color);
}
.editor-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
:deep(.cm-editor) {
  height: 100%;
}
:deep(.cm-scroller) {
  font-family: monaco, Consolas, Menlo, Courier, monospace;
  font-size: 14px;
}
:deep(.cm-focused) {
  outline: none;
}
</style>
