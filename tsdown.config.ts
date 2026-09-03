/**
 * tsdown config: emits two artifacts:
 *
 *   - `lib/index.js`  — node half (plain ESM, bundles src/index.ts)
 *   - `lib/client.js` — browser half (CJS wrapped in DSH's
 *                       `window.__ModuleLoader__.load({id, factory})`
 *                       so the client module loader can compose it)
 *
 * The browser bundle externals React and the DSH platform modules — the
 * loader's module table provides them at runtime. CSS Modules are inlined
 * as a hashed class map + a `<style data-plugin>` tag.
 */
import { defineConfig, type UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'

const ID = '@huanlin/dsh-plugin-android-use'

/** Peer deps that stay external in the node bundle (provided by the dsh host). */
const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  'sharp',
]

/** DSH platform modules that stay external in the browser bundle. */
const CLIENT_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-tool/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-session/client',
]

/** Virtual-id wrapper keeping module CSS away from rolldown's CSS pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Minimal CSS-modules transform: hash local names, return class map + raw CSS. */
function transformCssModules(filename: string, source: Buffer): { classMap: Record<string, string>; cssText: string } {
  const rawHash = Array.from(filename).reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0).toString(36).replace('-', '')
  const hash = `d${rawHash}`
  const cssText = source.toString('utf8')
  const classMap: Record<string, string> = {}
  const classPattern = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g
  let match: RegExpExecArray | null
  while ((match = classPattern.exec(cssText)) !== null) {
    const local = match[1]
    if (local !== undefined && classMap[local] === undefined) {
      classMap[local] = `${hash}_${local}`
    }
  }
  const transformedCss = cssText.replace(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g, (full, name: string) => {
    if (classMap[name] !== undefined) return `.${classMap[name]}`
    return full
  })
  return { classMap, cssText: transformedCss }
}

const cssModulesPlugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { classMap, cssText } = transformCssModules(fileId, source)
    const tagId = `${ID}/${basename(fileId)}`
    return [
      `const css = ${JSON.stringify(cssText)};`,
      `const classMap = ${JSON.stringify(classMap)};`,
      `const tagId = ${JSON.stringify(tagId)};`,
      'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
      '  const tag = document.createElement(\'style\');',
      `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      'export default classMap;',
    ].join('\n')
  },
}

const libConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  external: HOST_EXTERNALS,
}

const clientBundleConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesPlugin],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([libConfig, clientBundleConfig])
