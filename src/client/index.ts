/**
 * dsh-plugin-android-use — browser half.
 *
 * Single bundle, dual entry: this is the client half (exports `./client`).
 * Host half ships via `.` (see `src/index.ts`).
 *
 * Registers two `tool.call.toolview` keyed slots:
 *   - key `android_tap`        → TapCard (annotated pre-tap screenshot)
 *   - key `android_screenshot` → ScreenshotCard (captured screenshot)
 *
 * `tool.call.toolview` is declared by `@deepseek-ai/dsh-client-ui-tool`, so
 * both registrations go through `ctx.slots.inject` (waits on the declaration,
 * leaves with this plugin's fiber). Durable image URLs resolve through the
 * session-authorized `loadImage` loader the toolview owner supplies
 * (v0.1.5: `ToolCallOwnerProps.loadImage` is required).
 *
 * @module @huanlin/dsh-plugin-android-use/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: pull the Context/SlotMap/StandardProps declaration
// merges this plugin's compiled props depend on. Erased in the bundle.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TapCard } from './TapCard.tsx'
import { ScreenshotCard } from './ScreenshotCard.tsx'

/** Required services: slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the `android_tap` and `android_screenshot` toolview slots.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'android_tap',
    }, TapCard))

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'android_screenshot',
    }, ScreenshotCard))
}
