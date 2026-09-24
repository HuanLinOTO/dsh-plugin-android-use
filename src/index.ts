/**
 * index.ts — dsh-android-use cordis plugin entry (host half).
 *
 * 10 model-facing tools that let the AI operate an Android phone via adb:
 *   - android_list_devices / android_device_info
 *   - android_screenshot / android_ui_dump
 *   - android_tap / android_swipe / android_press_key / android_input_text
 *   - android_open_app / android_foreground_app
 *
 * Delivered frames are cropped/magnified on request, compressed, stamped with a
 * coordinate grid, and retained under the capture directory.
 *
 * @module @huanlin/dsh-plugin-android-use
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { AdbClient } from './adb.js'
import { defaultCaptureDir } from './capture.js'
import type { ImageFormat } from './image.js'
import { registerTools, type ResolvedConfig } from './registry.js'
import { registerBundledSkill } from './skill.js'

export const name = 'dsh-android-use'
export const inject = ['tools']

export interface Config {
  adbPath?: string
  defaultSerial?: string
  inputTextMode?: 'input' | 'adbkeyboard'
  captureDir?: string
  captureKeep?: number
  imageMaxDimension?: number
  imageFormat?: ImageFormat
  imageQuality?: number
  showGrid?: boolean
  provideSkill?: boolean
}

export const Config: z<Config> = z.object({
  adbPath: z.string().default('adb').description('Path to the adb binary. Defaults to "adb" (must be on PATH).'),
  defaultSerial: z.string().description('Default device serial. Omit to auto-select when one device is attached; required when multiple are connected.'),
  inputTextMode: z.union(['input', 'adbkeyboard'] as const).default('input').description('Text input mode: "input" (ASCII only, uses `adb shell input text`) or "adbkeyboard" (Unicode, requires ADBKeyboard IME on device).'),
  captureDir: z.string().description('Directory that keeps a copy of every delivered frame. Defaults to <system temp>/dsh-android-use.'),
  captureKeep: z.number().step(1).min(0).default(200).description('Maximum number of retained frames in captureDir; the oldest are deleted first. 0 keeps everything.'),
  imageMaxDimension: z.number().step(1).min(64).default(1280).description('Longest-side cap, in pixels, of the image sent to the model. Screenshots are compressed to this size before delivery.'),
  imageFormat: z.union(['jpeg', 'webp', 'png'] as const).default('jpeg').description('Encoding of delivered frames. jpeg keeps screenshots small; png is lossless and largest.'),
  imageQuality: z.number().step(1).min(1).max(100).default(80).description('Encoder quality for jpeg and webp deliveries.'),
  showGrid: z.boolean().default(true).description('Draw the coordinate grid (with screenshot-pixel labels) on every delivered frame.'),
  provideSkill: z.boolean().default(true).description('Register the bundled android-use skill on ctx.skills when the profile mounts the skills service. No file is written outside the package.'),
})

export function resolveConfig(config: Config): { adbPath: string } & ResolvedConfig {
  const adbPath = typeof config.adbPath === 'string' && config.adbPath !== '' ? config.adbPath : 'adb'
  const defaultSerial = typeof config.defaultSerial === 'string' && config.defaultSerial !== '' ? config.defaultSerial : undefined
  const inputTextMode = config.inputTextMode === 'adbkeyboard' ? 'adbkeyboard' : 'input'
  const captureDir = typeof config.captureDir === 'string' && config.captureDir !== '' ? config.captureDir : defaultCaptureDir()
  const captureKeep = typeof config.captureKeep === 'number' && Number.isInteger(config.captureKeep) && config.captureKeep >= 0 ? config.captureKeep : 200
  const imageMaxDimension = typeof config.imageMaxDimension === 'number' && config.imageMaxDimension >= 64 ? Math.round(config.imageMaxDimension) : 1280
  const imageFormat: ImageFormat = config.imageFormat === 'png' || config.imageFormat === 'webp' ? config.imageFormat : 'jpeg'
  const imageQuality = typeof config.imageQuality === 'number' && config.imageQuality >= 1 && config.imageQuality <= 100 ? Math.round(config.imageQuality) : 80
  const showGrid = config.showGrid !== false
  const provideSkill = config.provideSkill !== false
  return { adbPath, defaultSerial, inputTextMode, captureDir, captureKeep, imageMaxDimension, imageFormat, imageQuality, showGrid, provideSkill }
}

export function apply(ctx: Context, config: Config = {} as Config): void {
  const resolved = resolveConfig(config)
  const adb = new AdbClient(resolved.adbPath)
  registerTools(ctx, { adb, getConfig: () => resolved })
  registerBundledSkill(ctx, resolved.provideSkill)
}
