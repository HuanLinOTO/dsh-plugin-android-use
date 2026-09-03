/**
 * index.ts — dsh-android-use cordis plugin entry (host half).
 *
 * 10 model-facing tools that let the AI operate an Android phone via adb:
 *   - android_list_devices / android_device_info
 *   - android_screenshot / android_ui_dump
 *   - android_tap / android_swipe / android_press_key / android_input_text
 *   - android_open_app / android_foreground_app
 *
 * Host-only (no client UI); the generic tool card is used for rendering.
 * Tool registration is effect-based: disposing the plugin fiber
 * (e.g., on config change) automatically unregisters all tools, and the
 * next apply() re-registers with the fresh config.
 *
 * @module @huanlin/dsh-plugin-android-use
 */

import z from 'schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { AdbClient } from './adb.js'
import { registerTools, type ResolvedConfig } from './registry.js'

export const name = 'dsh-android-use'
export const inject = ['tools']

export interface Config {
  adbPath?: string
  defaultSerial?: string
  inputTextMode?: 'input' | 'adbkeyboard'
}

export const Config: z<Config> = z.object({
  adbPath: z.string().default('adb').description('Path to the adb binary. Defaults to "adb" (must be on PATH).'),
  defaultSerial: z.string().description('Default device serial. Omit to auto-select when one device is attached; required when multiple are connected.'),
  inputTextMode: z.union(['input', 'adbkeyboard'] as const).default('input').description('Text input mode: "input" (ASCII only, uses `adb shell input text`) or "adbkeyboard" (Unicode, requires ADBKeyboard IME on device).'),
})

export function resolveConfig(config: Config): { adbPath: string } & ResolvedConfig {
  const adbPath = typeof config.adbPath === 'string' && config.adbPath !== '' ? config.adbPath : 'adb'
  const defaultSerial = typeof config.defaultSerial === 'string' && config.defaultSerial !== '' ? config.defaultSerial : undefined
  const inputTextMode = config.inputTextMode === 'adbkeyboard' ? 'adbkeyboard' : 'input'
  return { adbPath, defaultSerial, inputTextMode }
}

export function apply(ctx: Context, config: Config = {} as Config): void {
  const resolved = resolveConfig(config)
  const adb = new AdbClient(resolved.adbPath)
  registerTools(ctx, { adb, getConfig: () => resolved })
}
