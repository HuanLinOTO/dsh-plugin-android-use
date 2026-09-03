/**
 * input.ts — `android_tap`, `android_swipe`, `android_press_key`, `android_input_text` tools.
 *
 * `android_tap` captures a pre-tap screenshot, annotates it with a marker at
 * the tap coordinates, saves it to the attachment store, and renders it as
 * the tool-call result so the model (and the UI) can visually verify where
 * the tap landed.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/input
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { resolveSerial } from '../adb.js'
import { parseWmSize } from '../adb.js'
import { routeIsImageCapable } from '../route.js'
import { annotateTap } from '../annotate.js'
import { fitToMaxDimension, computeScale } from '../image.js'
import { resolveKey } from '../keys.js'
import type { ToolDeps } from '../registry.js'

/** Annotated screenshot attached to a tap result. */
export interface TapScreenshot {
  attachmentId: string
  bytes: number
  width: number
  height: number
}

/** Canonical result of `android_tap`. */
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
  screenshot_emitted: boolean
}

/** Canonical result of `android_swipe`. */
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

/** Canonical result of `android_press_key`. */
export interface PressKeyResult {
  serial: string
  key: string
  keycode: number
  times: number
}

/** Canonical result of `android_input_text`. */
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
      case '|': case '^': case '*': case '~': case '"': case '\'':
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

function renderTap(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as TapResult
  const lines = [
    `Tap at image (${v.x}, ${v.y}) → device (${v.device_x}, ${v.device_y}) on ${v.serial}: ${v.action} ×${v.times}` +
      (v.duration_ms > 0 ? ` (${v.duration_ms}ms)` : ''),
  ]
  if (v.pre_tap_screenshot !== null) {
    lines.push(`Pre-tap screenshot (annotated with tap position marker): ${v.pre_tap_screenshot.width}x${v.pre_tap_screenshot.height} px, ${v.pre_tap_screenshot.bytes} bytes.`)
  } else {
    lines.push('No pre-tap screenshot (attachment store unavailable or capture failed).')
  }
  if (v.post_tap_screenshot !== null) {
    lines.push(`Post-tap screenshot (showing the screen result after tap): ${v.post_tap_screenshot.width}x${v.post_tap_screenshot.height} px, ${v.post_tap_screenshot.bytes} bytes.`)
  } else {
    lines.push('No post-tap screenshot (attachment store unavailable or capture failed).')
  }
  lines.push(`Images emitted to model: ${v.screenshot_emitted ? 'yes' : 'no'}.`)
  const text = lines.join('\n')

  const blocks: ContentBlock[] = [{ type: 'text', text }]

  if (v.screenshot_emitted) {
    if (v.pre_tap_screenshot !== null) {
      blocks.push({ type: 'text', text: 'Pre-tap screenshot (annotated with tap position marker):' })
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: v.pre_tap_screenshot.attachmentId as unknown as ImageAttachmentRef['attachmentId'],
          mediaType: 'image/png',
          bytes: v.pre_tap_screenshot.bytes,
          width: v.pre_tap_screenshot.width,
          height: v.pre_tap_screenshot.height,
        },
      })
    }
    if (v.post_tap_screenshot !== null) {
      blocks.push({ type: 'text', text: 'Post-tap screenshot (showing the screen result after tap):' })
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: v.post_tap_screenshot.attachmentId as unknown as ImageAttachmentRef['attachmentId'],
          mediaType: 'image/png',
          bytes: v.post_tap_screenshot.bytes,
          width: v.post_tap_screenshot.width,
          height: v.post_tap_screenshot.height,
        },
      })
    }
  }

  return blocks
}

function renderSwipe(value: SwipeResult): string {
  return `Swipe image (${value.x1}, ${value.y1}) → (${value.x2}, ${value.y2})` +
    ` / device (${value.device_x1}, ${value.device_y1}) → (${value.device_x2}, ${value.device_y2})` +
    ` on ${value.serial}` + (value.duration_ms > 0 ? ` over ${value.duration_ms}ms` : '')
}

function renderPressKey(value: PressKeyResult): string {
  return `Pressed key "${value.key}" (keycode ${value.keycode}) on ${value.serial} ×${value.times}`
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

/** Register `android_tap`, `android_swipe`, `android_press_key`, `android_input_text`. */
export function registerInputTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_tap',
    description:
      'Tap a point on the Android screen. Pass (x, y) in screenshot image '
      + 'coordinates — the same coordinate space as the pixels in android_screenshot '
      + 'and the "center" values from android_ui_dump. The plugin automatically '
      + 'converts these to device-native coordinates for execution. '
      + 'Use `duration_ms` for a long-press (hold). Use `times` to repeat the tap. '
      + 'A pre-tap screenshot annotated with a marker at the tap position is captured '
      + 'and returned when an attachment store is available.',
    parameters: {
      x: { type: 'integer', required: true, description: 'X coordinate in screenshot image space.' },
      y: { type: 'integer', required: true, description: 'Y coordinate in screenshot image space.' },
      duration_ms: {
        type: 'integer',
        description: 'Hold duration in milliseconds. When > 0, performs a long-press (swipe-to-same-point) instead of a quick tap.',
      },
      times: {
        type: 'integer',
        description: 'Number of times to repeat the tap (default 1).',
      },
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
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            ],
            required: true,
          },
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

      let preScreenshot: TapScreenshot | null = null
      let postScreenshot: TapScreenshot | null = null
      let screenshotEmitted = false

      const attachments = ctx.get('attachments') as import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined

      let scaleX = 1
      let scaleY = 1

      // Capture pre-tap screenshot (annotated with tap marker)
      if (attachments !== undefined) {
        try {
          const raw = await deps.adb.execOutBinary(serial, 'screencap -p', exec.signal)
          const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension)
          scaleX = fitted.scaleX
          scaleY = fitted.scaleY
          const annotated = await annotateTap(fitted.data, a.x, a.y)
          const ref = await attachments.saveImage({
            data: annotated.data,
            mediaType: 'image/png',
            name: 'pre_tap_screenshot.png',
          })
          preScreenshot = {
            attachmentId: ref.attachmentId as unknown as string,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
          }
        } catch {
          // Pre-tap screenshot is best-effort; the tap itself must still proceed.
        }
      }

      // Convert image-space coordinates to device-space for adb input.
      const deviceX = Math.round(a.x / scaleX)
      const deviceY = Math.round(a.y / scaleY)

      for (let i = 0; i < times; i++) {
        if (dur > 0) {
          await deps.adb.shell(serial, `input swipe ${deviceX} ${deviceY} ${deviceX} ${deviceY} ${dur}`, exec.signal)
        } else {
          await deps.adb.shell(serial, `input tap ${deviceX} ${deviceY}`, exec.signal)
        }
      }

      // Capture post-tap screenshot (plain, no annotation) after a short delay
      // to let UI animations settle.
      if (attachments !== undefined) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500))
          const raw = await deps.adb.execOutBinary(serial, 'screencap -p', exec.signal)
          const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension)
          const ref = await attachments.saveImage({
            data: fitted.data,
            mediaType: 'image/png',
            name: 'post_tap_screenshot.png',
          })
          postScreenshot = {
            attachmentId: ref.attachmentId as unknown as string,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
          }
          screenshotEmitted = await routeIsImageCapable(ctx, exec, exec.signal)
        } catch {
          // Post-tap screenshot is best-effort.
        }
      }

      return { serial, x: a.x, y: a.y, device_x: deviceX, device_y: deviceY, duration_ms: dur, times, action, pre_tap_screenshot: preScreenshot, post_tap_screenshot: postScreenshot, screenshot_emitted: screenshotEmitted } satisfies TapResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_swipe',
    description:
      'Swipe from one point to another on the Android screen. Pass start and end '
      + 'coordinates in screenshot image space (the same coordinate space as '
      + 'android_screenshot and android_ui_dump). The plugin automatically converts '
      + 'these to device-native coordinates for execution. '
      + 'Use `duration_ms` to control swipe speed (longer = slower).',
    parameters: {
      x1: { type: 'integer', required: true, description: 'Start X coordinate in screenshot image space.' },
      y1: { type: 'integer', required: true, description: 'Start Y coordinate in screenshot image space.' },
      x2: { type: 'integer', required: true, description: 'End X coordinate in screenshot image space.' },
      y2: { type: 'integer', required: true, description: 'End Y coordinate in screenshot image space.' },
      duration_ms: {
        type: 'integer',
        description: 'Swipe duration in milliseconds (default 300). Longer values produce slower swipes.',
      },
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

      const attachments = ctx.get('attachments') as import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
      let scale = 1
      if (attachments !== undefined) {
        const sizeOutput = await deps.adb.shell(serial, 'wm size', exec.signal)
        const { width: devW, height: devH } = parseWmSize(sizeOutput)
        scale = computeScale(devW, devH, attachments.imageLimits.maxImageDimension)
      }

      const dx1 = Math.round(a.x1 / scale)
      const dy1 = Math.round(a.y1 / scale)
      const dx2 = Math.round(a.x2 / scale)
      const dy2 = Math.round(a.y2 / scale)

      await deps.adb.shell(serial, `input swipe ${dx1} ${dy1} ${dx2} ${dy2} ${dur}`, exec.signal)

      return { serial, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, device_x1: dx1, device_y1: dy1, device_x2: dx2, device_y2: dy2, duration_ms: dur } satisfies SwipeResult
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
      times: {
        type: 'integer',
        description: 'Number of times to repeat the key press (default 1).',
      },
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
      submit: {
        type: 'boolean',
        description: 'When true, presses Enter (keycode 66) after typing the text.',
      },
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
