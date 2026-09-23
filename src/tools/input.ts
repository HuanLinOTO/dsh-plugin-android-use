/**
 * input.ts — android_tap, android_swipe, android_press_key, android_input_text.
 *
 * Tap and swipe take screenshot pixels (device pixels) — the numbers printed on
 * the coordinate grid of an android_screenshot frame. Tap captures a marked
 * pre-tap frame and an unmarked post-tap frame, both grid-annotated, compressed,
 * and retained on disk.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/input
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { resolveSerial } from '../adb.js'
import { routeIsImageCapable } from '../route.js'
import { captureFrame, type Frame } from '../frame.js'
import { resolveKey } from '../keys.js'
import type { ToolDeps } from '../registry.js'

/** A frame reference carried by a tap result. */
export interface TapScreenshot {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
}

/** Canonical result of android_tap. */
export interface TapResult {
  serial: string
  x: number
  y: number
  device_x: number
  device_y: number
  duration_ms: number
  times: number
  action: 'tap' | 'long_press'
  pre_tap_screenshot: TapScreenshot | null
  post_tap_screenshot: TapScreenshot | null
  /** Retained copy of the pre-tap frame, or null. */
  pre_saved_path: string | null
  /** Retained copy of the post-tap frame, or null. */
  post_saved_path: string | null
  screenshot_emitted: boolean
}

/** Canonical result of android_swipe. */
export interface SwipeResult {
  serial: string
  x1: number
  y1: number
  x2: number
  y2: number
  device_x1: number
  device_y1: number
  device_x2: number
  device_y2: number
  duration_ms: number
}

/** Canonical result of android_press_key. */
export interface PressKeyResult {
  serial: string
  key: string
  keycode: number
  times: number
}

/** Canonical result of android_input_text. */
export interface InputTextResult {
  serial: string
  text: string
  mode: 'input' | 'adbkeyboard'
  submitted: boolean
}

/**
 * Escape text for `adb shell input text`. Spaces become `%s` and shell
 * metacharacters are backslash-escaped. Non-ASCII characters are rejected
 * (the `input` command cannot encode them).
 * @param text - the raw text to escape.
 * @returns the escaped text safe for `adb shell input text`.
 * @throws when the text contains non-ASCII characters.
 */
export function escapeInputText(text: string): string {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      throw new Error(`the "input" text mode cannot encode non-ASCII character "${text[i]}" (U+${text.charCodeAt(i).toString(16).toUpperCase()}); set the plugin config inputTextMode to "adbkeyboard" to inject Unicode text via ADBKeyboard`)
    }
  }
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    switch (ch) {
      case ' ': out += '%s'; break
      case '&': case '<': case '>': case ';': case '(': case ')':
      case '|': case '^': case '*': case '~': case '"': case "'":
      case '`': case '$': case '!': case '#':
        out += '\\' + ch
        break
      case '\\': out += '\\\\'; break
      default: out += ch
    }
  }
  return out
}

/**
 * URL-encode text for ADBKeyboard broadcast injection (`am broadcast -a ADB_INPUT_TEXT --es msg <encoded>`).
 * @param text - the raw text to encode (any Unicode).
 * @returns the percent-encoded text.
 */
export function encodeAdbKeyboard(text: string): string {
  return encodeURIComponent(text)
}

function kib(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

function frameLine(label: string, image: TapScreenshot | null, savedPath: string | null): string {
  if (image === null) return `${label}: not captured.`
  const where = savedPath === null ? 'not retained' : savedPath
  return `${label}: ${image.width}x${image.height} px (${image.mediaType}, ${kib(image.bytes)}), retained at ${where}.`
}

function toRef(image: Frame['image']): TapScreenshot | null {
  if (image === null) return null
  return { attachmentId: image.attachmentId, mediaType: image.mediaType, bytes: image.bytes, width: image.width, height: image.height }
}

function imageBlock(image: TapScreenshot): ContentBlock {
  const ref: ImageAttachmentRef = {
    attachmentId: image.attachmentId as unknown as ImageAttachmentRef['attachmentId'],
    mediaType: image.mediaType as ImageAttachmentRef['mediaType'],
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  }
  return { type: 'image', attachment: ref }
}

function renderTap(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as TapResult
  const lines = [
    `Tap at (${v.x}, ${v.y}) on ${v.serial}: ${v.action} x${v.times}` + (v.duration_ms > 0 ? ` (${v.duration_ms}ms)` : '') + '.',
    'Coordinates are screenshot pixels (device pixels): the marker shows where the tap landed on the grid.',
    frameLine('Pre-tap frame (tap marker drawn)', v.pre_tap_screenshot, v.pre_saved_path),
    frameLine('Post-tap frame', v.post_tap_screenshot, v.post_saved_path),
    `Images emitted to model: ${v.screenshot_emitted ? 'yes' : 'no'}.`,
  ]
  const blocks: ContentBlock[] = [{ type: 'text', text: lines.join('\n') }]
  if (v.screenshot_emitted) {
    if (v.pre_tap_screenshot !== null) {
      blocks.push({ type: 'text', text: 'Pre-tap frame (tap marker drawn):' })
      blocks.push(imageBlock(v.pre_tap_screenshot))
    }
    if (v.post_tap_screenshot !== null) {
      blocks.push({ type: 'text', text: 'Post-tap frame (screen after the tap):' })
      blocks.push(imageBlock(v.post_tap_screenshot))
    }
  }
  return blocks
}

function renderSwipe(value: SwipeResult): string {
  return `Swipe (${value.x1}, ${value.y1}) -> (${value.x2}, ${value.y2}) on ${value.serial}`
    + (value.duration_ms > 0 ? ` over ${value.duration_ms}ms` : '')
    + '. Coordinates are screenshot pixels (device pixels).'
}

function renderPressKey(value: PressKeyResult): string {
  return `Pressed key "${value.key}" (keycode ${value.keycode}) on ${value.serial} x${value.times}`
}

function renderInputText(value: InputTextResult): string {
  const lines = [
    `Input text on ${value.serial} (mode: ${value.mode}):`,
    `  text: ${JSON.stringify(value.text)}`,
  ]
  if (value.submitted) lines.push('  submitted (Enter pressed)')
  return lines.join('\n')
}

function textRender(fn: (value: never) => string): (args: unknown, value: unknown) => ContentBlock[] {
  return (_args, value) => [{ type: 'text', text: fn(value as never) }]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Register android_tap, android_swipe, android_press_key, android_input_text. */
export function registerInputTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_tap',
    description:
      'Tap a point on the Android screen, in screenshot pixels (device pixels) — the numbers printed on an android_screenshot grid label. '
      + 'Read the coordinate from the grid rather than estimating pixel positions, and prefer android_screenshot(region, magnify) to pin a small target before tapping. '
      + 'Use duration_ms for a long-press (hold) and times to repeat the tap. '
      + 'The result carries a marked pre-tap frame and a post-tap frame so the landed point and the screen change are both visible; both are compressed and retained on disk.',
    parameters: {
      x: { type: 'integer', required: true, description: 'X in screenshot pixels (device pixels), e.g. a grid label.' },
      y: { type: 'integer', required: true, description: 'Y in screenshot pixels (device pixels).' },
      duration_ms: {
        type: 'integer',
        description: 'Hold duration in milliseconds. When > 0, performs a long-press (swipe-to-same-point) instead of a quick tap.',
      },
      times: { type: 'integer', description: 'Number of times to repeat the tap (default 1).' },
      serial: { type: 'string', description: 'Device serial. Omit when only one device is attached; required when multiple are connected.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          x: { type: 'integer', required: true },
          y: { type: 'integer', required: true },
          device_x: { type: 'integer', required: true },
          device_y: { type: 'integer', required: true },
          duration_ms: { type: 'integer', required: true },
          times: { type: 'integer', required: true },
          action: { type: 'string', enum: ['tap', 'long_press'], required: true },
          pre_tap_screenshot: {
            oneOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  attachmentId: { type: 'string', required: true },
                  mediaType: { type: 'string', required: true },
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            ],
            required: true,
          },
          post_tap_screenshot: {
            oneOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  attachmentId: { type: 'string', required: true },
                  mediaType: { type: 'string', required: true },
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            ],
            required: true,
          },
          pre_saved_path: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          post_saved_path: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          screenshot_emitted: { type: 'boolean', required: true },
        },
      },
      render: renderTap,
    },
    async execute(args, exec) {
      const a = args as { x: number; y: number; duration_ms?: number; times?: number; serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)
      const dur = typeof a.duration_ms === 'number' && a.duration_ms > 0 ? a.duration_ms : 0
      const times = typeof a.times === 'number' && a.times > 0 ? a.times : 1
      const action: 'tap' | 'long_press' = dur > 0 ? 'long_press' : 'tap'
      let preSaved: string | null = null
      let postSaved: string | null = null

      let pre: Frame | null = null
      try {
        pre = await captureFrame(ctx, deps, {
          serial,
          kind: 'pre-tap',
          tap: { x: a.x, y: a.y },
          note: `tap (${a.x}, ${a.y})`,
          signal: exec.signal,
        })
        preSaved = pre.savedPath
      } catch {
        // A pre-tap frame is best effort: the tap itself must still happen.
      }

      for (let i = 0; i < times; i++) {
        if (dur > 0) {
          await deps.adb.shell(serial, `input swipe ${a.x} ${a.y} ${a.x} ${a.y} ${dur}`, exec.signal)
        } else {
          await deps.adb.shell(serial, `input tap ${a.x} ${a.y}`, exec.signal)
        }
      }

      let post: Frame | null = null
      try {
        await sleep(500)
        post = await captureFrame(ctx, deps, {
          serial,
          kind: 'post-tap',
          note: `after tap (${a.x}, ${a.y})`,
          signal: exec.signal,
        })
        postSaved = post.savedPath
      } catch {
        // A post-tap frame is best effort.
      }

      const hasImage = (pre?.image ?? null) !== null || (post?.image ?? null) !== null
      const emitted = hasImage && await routeIsImageCapable(ctx, exec, exec.signal)

      return {
        serial,
        x: a.x,
        y: a.y,
        device_x: a.x,
        device_y: a.y,
        duration_ms: dur,
        times,
        action,
        pre_tap_screenshot: toRef(pre?.image ?? null),
        post_tap_screenshot: toRef(post?.image ?? null),
        pre_saved_path: preSaved,
        post_saved_path: postSaved,
        screenshot_emitted: emitted,
      } satisfies TapResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_swipe',
    description:
      'Swipe or scroll from one point to another, in screenshot pixels (device pixels) — the numbers printed on an android_screenshot grid label. '
      + 'A vertical swipe scrolls a list: e.g. (540, 1800) -> (540, 900) scrolls down one screen. '
      + 'Use duration_ms to control speed (longer = slower, default 300).',
    parameters: {
      x1: { type: 'integer', required: true, description: 'Start X in screenshot pixels.' },
      y1: { type: 'integer', required: true, description: 'Start Y in screenshot pixels.' },
      x2: { type: 'integer', required: true, description: 'End X in screenshot pixels.' },
      y2: { type: 'integer', required: true, description: 'End Y in screenshot pixels.' },
      duration_ms: { type: 'integer', description: 'Swipe duration in milliseconds (default 300). Longer values produce slower swipes.' },
      serial: { type: 'string', description: 'Device serial. Omit when only one device is attached; required when multiple are connected.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          x1: { type: 'integer', required: true },
          y1: { type: 'integer', required: true },
          x2: { type: 'integer', required: true },
          y2: { type: 'integer', required: true },
          device_x1: { type: 'integer', required: true },
          device_y1: { type: 'integer', required: true },
          device_x2: { type: 'integer', required: true },
          device_y2: { type: 'integer', required: true },
          duration_ms: { type: 'integer', required: true },
        },
      },
      render: textRender(renderSwipe as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { x1: number; y1: number; x2: number; y2: number; duration_ms?: number; serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)
      const dur = typeof a.duration_ms === 'number' && a.duration_ms > 0 ? a.duration_ms : 300

      await deps.adb.shell(serial, `input swipe ${a.x1} ${a.y1} ${a.x2} ${a.y2} ${dur}`, exec.signal)

      return { serial, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, device_x1: a.x1, device_y1: a.y1, device_x2: a.x2, device_y2: a.y2, duration_ms: dur } satisfies SwipeResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_press_key',
    description:
      'Press a hardware/key event key on the Android device. Pass a named key '
      + '(case-insensitive: "home", "back", "app_switch", "power", "enter", "volume_up", '
      + '"volume_down", "mute", "camera", "search", "menu", "escape", "delete", "tab", "space", '
      + '"dpad_up", "dpad_down", "dpad_left", "dpad_right", "dpad_center", etc.) or a raw '
      + 'integer keycode. Use `times` to repeat.',
    parameters: {
      key: {
        oneOf: [
          { type: 'string', description: 'Named key (case-insensitive), e.g. "home", "back", "app_switch".' },
          { type: 'integer', description: 'Raw Android keycode integer.' },
        ],
        required: true,
        description: 'Key to press: a named key or a raw integer keycode.',
      },
      times: { type: 'integer', description: 'Number of times to repeat the key press (default 1).' },
      serial: { type: 'string', description: 'Device serial. Omit when only one device is attached; required when multiple are connected.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          key: { type: 'string', required: true },
          keycode: { type: 'integer', required: true },
          times: { type: 'integer', required: true },
        },
      },
      render: textRender(renderPressKey as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { key: string | number; times?: number; serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)
      const keycode = resolveKey(a.key)
      const times = typeof a.times === 'number' && a.times > 0 ? a.times : 1
      const keyStr = typeof a.key === 'number' ? String(a.key) : a.key

      for (let i = 0; i < times; i++) {
        await deps.adb.shell(serial, `input keyevent ${keycode}`, exec.signal)
      }

      return { serial, key: keyStr, keycode, times } satisfies PressKeyResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_input_text',
    description:
      'Type text into the focused input field on the Android device. In "input" mode '
      + '(default), only ASCII text is supported — non-ASCII characters require switching '
      + 'the plugin config `inputTextMode` to "adbkeyboard" (requires the ADBKeyboard IME '
      + 'installed on the device). Pass `submit: true` to press Enter after typing.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to type into the focused field.' },
      submit: { type: 'boolean', description: 'When true, presses Enter (keycode 66) after typing the text.' },
      serial: { type: 'string', description: 'Device serial. Omit when only one device is attached; required when multiple are connected.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true },
          text: { type: 'string', required: true },
          mode: { type: 'string', enum: ['input', 'adbkeyboard'], required: true },
          submitted: { type: 'boolean', required: true },
        },
      },
      render: textRender(renderInputText as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { text: string; submit?: boolean; serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)
      const mode = config.inputTextMode
      const submitted = a.submit === true

      if (mode === 'adbkeyboard') {
        const encoded = encodeAdbKeyboard(a.text)
        await deps.adb.shell(serial, `am broadcast -a ADB_INPUT_TEXT --es msg "${encoded}"`, exec.signal)
      } else {
        const escaped = escapeInputText(a.text)
        await deps.adb.shell(serial, `input text "${escaped}"`, exec.signal)
      }

      if (submitted) {
        await deps.adb.shell(serial, 'input keyevent 66', exec.signal)
      }

      return { serial, text: a.text, mode, submitted } satisfies InputTextResult
    },
  }))
}
