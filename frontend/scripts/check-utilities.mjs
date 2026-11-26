import less from 'less'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const styles = join(src, 'assets/styles')
const { css } = await less.render("@import 'utilities/index.less'; @import 'custom.less';", {
  paths: [styles],
})
// A class selector must start with a letter (or underscore). Requiring this avoids
// picking up decimals such as `0.75` from the compiled CSS.
const defined = new Set(
  [...css.replaceAll('\\', '').matchAll(/\.([a-zA-Z_][\w-]*(?:\[\d+%\])?)/g)].map(
    (match) => match[1],
  ),
)
const value = '(?:\\d+|px|full|auto|\\[\\d+%\\])'
const utility = new RegExp(
  '^(?:' +
    [
      `(?:gap(?:-[xy])?|[pm][trblxy]?)-${value}`,
      `-(?:m[trblxy]?|top|right|bottom|left)-${value}`,
      `(?:min-|max-)?[wh]-${value}`,
      'rounded(?:-[trbl]{1,4})?(?:-\\d+)?',
      'text-(?:\\d+|xs|sm|base|lg|xl|2xl|left|center|right|nowrap|ellipsis|muted|secondary|danger)',
      'opacity-\\d+',
      'border(?:-0|-collapse)?',
      'bg-(?:transparent|primary|danger|surface)',
      'shadow(?:-\\w+)?',
      'overflow(?:-[xy])?-(?:auto|hidden|visible|scroll)',
      '(?:grid-cols|col-span)-\\d+',
      'font-(?:bold|normal|medium|semibold|mono|\\d+)',
      'transition(?:-all)?',
      'duration-\\d+',
    ].join('|') +
    ')$',
)
const errors = []
const quoted = /['"`]([^'"`]+)['"`]/g
async function checkDirectory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await checkDirectory(path)
    if (!entry.isFile() || !entry.name.endsWith('.vue')) continue
    const source = await readFile(path, 'utf8')
    const { descriptor } = parse(source, { filename: path })
    function check(classes, line) {
      for (const token of classes.match(/[\w-]+(?:\[\d+%\])?/g) ?? []) {
        if (utility.test(token) && !defined.has(token))
          errors.push(path.slice(src.length) + ':' + line + ' ' + token)
      }
    }
    function visit(node) {
      for (const prop of node.props ?? []) {
        if (prop.name === 'class') check(prop.value?.content ?? '', prop.loc.start.line)
        if (prop.name === 'bind' && prop.arg?.content === 'class') {
          const expression = prop.exp?.content ?? ''
          // Only inspect quoted string literals so bare identifiers and object
          // property keys are not mistaken for class names.
          check(
            Array.from(expression.matchAll(quoted), (match) => match[1]).join(' '),
            prop.loc.start.line,
          )
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    if (descriptor.template?.ast) visit(descriptor.template.ast)
  }
}
await checkDirectory(resolve(src))
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
