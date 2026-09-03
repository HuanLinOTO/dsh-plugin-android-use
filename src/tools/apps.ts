/**
 * apps.ts — `android_open_app` and `android_foreground_app` tools.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/apps
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { resolveSerial } from '../adb.js'
import type { ToolDeps } from '../registry.js'

/** Canonical result of `android_open_app`. */
export interface OpenAppResult {
  serial: string
  package: string
  activity?: string
  started: boolean
}

/** Canonical result of `android_foreground_app`. */
export interface ForegroundAppResult {
  serial: string
  package: string | null
  activity: string | null
  window_title: string | null
  screen_on: boolean
}

/**
 * Parse `dumpsys window` output for the current focus window.
 *
 * Example line: `  mCurrentFocus=Window{f6144b2 u0 com.android.launcher/com.android.launcher.Launcher}`
 * Also handles `mCurrentFocus=null` (display off or no focused window).
 * @param output - the grep-filtered dumpsys window output.
 * @returns the package and activity, or null when no window is focused.
 */
export function parseForegroundApp(output: string): { package: string; activity: string; windowTitle: string | null } | null {
  const lines = output.split(/\r?\n/)
  let lastFocus: string | null = null
  for (const line of lines) {
    const match = /mCurrentFocus=(.+)/.exec(line.trim())
    if (match !== null) {
      lastFocus = match[1]!
    }
  }
  if (lastFocus === null) return null
  if (lastFocus === 'null') return null

  const windowMatch = /Window\{[^}]*?\s+([^/\s}]+)\/([^\s}]+)\s*\}/.exec(lastFocus)
  if (windowMatch !== null) {
    return { package: windowMatch[1]!, activity: windowMatch[2]!, windowTitle: null }
  }
  const pairMatch = /([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.]+)/.exec(lastFocus)
  if (pairMatch !== null) {
    return { package: pairMatch[1]!, activity: pairMatch[2]!, windowTitle: null }
  }
  return { package: lastFocus, activity: '', windowTitle: lastFocus }
}

/** Parse `dumpsys power` output for the wakefulness state. */
function parseWakefulness(output: string): boolean {
  return /mWakefulness=Awake/.test(output)
}

function renderOpenApp(value: OpenAppResult): string {
  const target = value.activity !== undefined ? `${value.package}/${value.activity}` : value.package
  return `Opened app ${target} on ${value.serial}: ${value.started ? 'started' : 'failed'}`
}

function renderForegroundApp(value: ForegroundAppResult): string {
  if (value.package === null) {
    return `No focused window on ${value.serial} (screen on: ${value.screen_on}).`
  }
  const lines = [
    `Foreground app on ${value.serial}:`,
    `  package: ${value.package}`,
    `  activity: ${value.activity ?? '(unknown)'}`,
  ]
  if (value.window_title !== null) lines.push(`  window: ${value.window_title}`)
  lines.push(`  screen on: ${value.screen_on}`)
  return lines.join('\n')
}

function textRender(fn: (value: never) => string): (args: unknown, value: unknown) => ContentBlock[] {
  return (_args, value) => [{ type: 'text', text: fn(value as never) }]
}

/** Register `android_open_app` and `android_foreground_app`. */
export function registerAppTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_open_app',
    description:
      'Open an app on the Android device by package name. If you know the '
      + 'specific activity, pass it; otherwise the app\'s default launcher '
      + 'activity is started via monkey. Example packages: "com.android.settings", '
      + '"com.android.chrome", "com.tencent.mm" (WeChat).',
    parameters: {
      package: { type: 'string', required: true, description: 'Android package name, e.g. "com.android.settings".' },
      activity: {
        type: 'string',
        description: 'Specific activity to start (e.g. ".Settings"). Omit to launch the app\'s default activity.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          package: { type: 'string', required: true },
          activity: { type: 'string' },
          started: { type: 'boolean', required: true },
        },
      },
      render: textRender(renderOpenApp as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { package: string; activity?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, undefined, config.defaultSerial, exec.signal)

      if (a.activity !== undefined && a.activity !== '') {
        const fullActivity = a.activity.startsWith('.') ? `${a.package}${a.activity}` : a.activity
        await deps.adb.shell(serial, `am start -n ${a.package}/${fullActivity}`, exec.signal)
      } else {
        await deps.adb.shell(serial, `monkey -p ${a.package} -c android.intent.category.LAUNCHER 1`, exec.signal)
      }

      const result: OpenAppResult = { serial, package: a.package, started: true }
      if (a.activity !== undefined && a.activity !== '') result.activity = a.activity
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_foreground_app',
    description:
      'Get the currently focused/foreground app and activity on the Android device. '
      + 'Also reports whether the screen is on. Useful for verifying which app is '
      + 'visible after opening an app or pressing home.',
    parameters: {
      serial: {
        type: 'string',
        description: 'Device serial. Omit when only one device is attached; required when multiple are connected.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          package: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          activity: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          window_title: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          screen_on: { type: 'boolean', required: true },
        },
      },
      render: textRender(renderForegroundApp as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)

      const batch = await deps.adb.shell(serial,
        'echo "=FOCUS="; dumpsys window|grep mCurrentFocus; echo "=WAKE="; dumpsys power|grep mWakefulness',
        exec.signal)

      const parts = batch.split(/=[A-Z]+=/)
      const focusOutput = parts[1] ?? ''
      const wakeOutput = parts[2] ?? ''
      const parsed = parseForegroundApp(focusOutput)
      const screenOn = parseWakefulness(wakeOutput)

      const result: ForegroundAppResult = {
        serial,
        package: parsed?.package ?? null,
        activity: parsed?.activity ?? null,
        window_title: parsed?.windowTitle ?? null,
        screen_on: screenOn,
      }
      return result
    },
  }))
}
