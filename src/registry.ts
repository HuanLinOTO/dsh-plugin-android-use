/**
 * registry.ts — tool registration entry point with dependency injection.
 *
 * `registerTools(ctx, deps)` registers all 10 android_* tools. The `deps`
 * parameter carries the AdbClient and a config getter, so tests inject a
 * fake AdbClient without touching the real adb binary.
 *
 * @module @huanlin/dsh-plugin-android-use/src/registry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AdbClient } from './adb.js'
import type { ImageFormat } from './image.js'
import { registerDeviceTools } from './tools/device.js'
import { registerScreenTools } from './tools/screen.js'
import { registerInputTools } from './tools/input.js'
import { registerAppTools } from './tools/apps.js'

/** Validated plugin config consumed by the tools at execution time. */
export interface ResolvedConfig {
  defaultSerial: string | undefined
  inputTextMode: 'input' | 'adbkeyboard'
  /** Directory that keeps a copy of every delivered frame. */
  captureDir: string
  /** Maximum number of retained frames; 0 disables pruning. */
  captureKeep: number
  /** Longest-side cap of a delivered frame, in pixels. */
  imageMaxDimension: number
  /** Encoding of delivered frames. */
  imageFormat: ImageFormat
  /** Encoder quality (1-100); ignored by the png format. */
  imageQuality: number
  /** Whether delivered frames carry the coordinate grid. */
  showGrid: boolean
  /** Whether the bundled skill is registered on ctx.skills when that service is present. */
  provideSkill: boolean
}

/** Dependencies injected into the tool registry (for testability). */
export interface ToolDeps {
  adb: AdbClient
  getConfig: () => ResolvedConfig
}

/**
 * Register all 10 android_* tools into the given context.
 * @param ctx - the plugin context (provides `ctx.tools.register`).
 * @param deps - the AdbClient and live config getter.
 */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  registerDeviceTools(ctx, deps)
  registerScreenTools(ctx, deps)
  registerInputTools(ctx, deps)
  registerAppTools(ctx, deps)
}
