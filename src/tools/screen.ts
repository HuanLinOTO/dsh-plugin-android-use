/**
 * screen.ts — `android_screenshot` and `android_ui_dump` tools.
 *
 * The screenshot tool follows `read_image`'s pattern: screencap → attachment
 * store → image block. Unlike `read_image`, it does NOT throw when the route
 * is not image-capable — the image is always saved to the attachment store
 * (for the UI card), but the image block is only emitted to the model when
 * the current route declares image input. When the route is unknown or
 * text-only, the model relies on `android_ui_dump` for screen perception.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/screen
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { resolveSerial } from '../adb.js'
import { routeIsImageCapable } from '../route.js'
import { parseUiDumpXml } from '../xml.js'
import type { UiDump, UiNode } from '../xml.js'
import { fitToMaxDimension, computeScale } from '../image.js'
import type { ToolDeps } from '../registry.js'

/** Canonical image metadata carried by `android_screenshot`. */
export interface ScreenshotImage {
  attachmentId: string
  mediaType: 'image/png'
  bytes: number
  width: number
  height: number
}

/** Canonical result of `android_screenshot`. */
export interface ScreenshotResult {
  serial: string
  width: number
  height: number
  bytes: number
  device_width: number
  device_height: number
  scale: number
  image: ScreenshotImage
  image_emitted: boolean
}

/** Canonical result of `android_ui_dump`. */
export interface UiDumpResult {
  serial: string
  screen_width: number
  screen_height: number
  image_width: number
  image_height: number
  scale: number
  rotation: number
  nodes: UiNode[]
}

function renderScreenshot(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as ScreenshotResult
  const lines = [
    `Screenshot captured: ${v.width}x${v.height} px, ${v.bytes} bytes (image/png).`,
    `Device resolution: ${v.device_width}x${v.device_height}, scale: ${v.scale.toFixed(4)}.`,
    `Coordinates from android_ui_dump and android_tap use the ${v.width}x${v.height} image space.`,
    `Image emitted to model context: ${v.image_emitted ? 'yes' : 'no'}${v.image_emitted ? '' : ' (current route is not image-capable; use android_ui_dump for screen perception)'}.`,
  ]
  const text = lines.join('\n')
  if (v.image_emitted) {
    const ref: ImageAttachmentRef = {
      attachmentId: v.image.attachmentId as unknown as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: v.image.bytes,
      width: v.image.width,
      height: v.image.height,
    }
    return [
      { type: 'text', text },
      { type: 'image', attachment: ref },
    ]
  }
  return [{ type: 'text', text }]
}

function nodeToTextLine(node: UiNode, index: number): string {
  const parts: string[] = [`[${index}]`]
  if (node.text !== '') parts.push(`text=${JSON.stringify(node.text)}`)
  if (node.content_desc !== '') parts.push(`desc=${JSON.stringify(node.content_desc)}`)
  if (node.resource_id !== '') parts.push(`id=${node.resource_id}`)
  parts.push(`class=${node.class}`)
  if (node.bounds !== null) parts.push(`bounds=[${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}]`)
  if (node.center !== null) parts.push(`center=(${node.center.x},${node.center.y})`)
  const flags: string[] = []
  if (node.clickable) flags.push('clickable')
  if (node.long_clickable) flags.push('long-clickable')
  if (node.scrollable) flags.push('scrollable')
  if (node.focusable) flags.push('focusable')
  if (!node.enabled) flags.push('disabled')
  if (node.checked) flags.push('checked')
  if (node.password) flags.push('password')
  if (node.selected) flags.push('selected')
  if (flags.length > 0) parts.push(flags.join(','))
  return `  ${parts.join(' | ')}`
}

function scaleDump(dump: UiDump, scale: number): UiDump {
  if (scale >= 1) return dump
  const r = (n: number): number => Math.round(n * scale)
  const nodes = dump.nodes.map(node => ({
    ...node,
    bounds: node.bounds !== null
      ? { left: r(node.bounds.left), top: r(node.bounds.top), right: r(node.bounds.right), bottom: r(node.bounds.bottom) }
      : null,
    center: node.center !== null ? { x: r(node.center.x), y: r(node.center.y) } : null,
  }))
  return { rotation: dump.rotation, screen_width: dump.screen_width, screen_height: dump.screen_height, nodes }
}

function renderUiDump(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as UiDumpResult
  const total = v.nodes.length
  const interactive = v.nodes.filter(n =>
    n.text !== '' || n.content_desc !== '' || n.clickable || n.long_clickable || n.scrollable || n.focusable,
  )
  const lines = [
    `UI dump: ${total} nodes total (${interactive.length} interactive/text), screen ${v.screen_width}x${v.screen_height}, rotation ${v.rotation}.`,
    `Coordinates are in screenshot image space (${v.image_width}x${v.image_height}, scale ${v.scale.toFixed(4)}). Use these center values directly with android_tap.`,
    `Showing ${interactive.length} interactive/text nodes:`,
  ]
  let idx = 0
  for (const node of v.nodes) {
    const isInteresting = node.text !== '' || node.content_desc !== '' || node.clickable || node.long_clickable || node.scrollable || node.focusable
    if (!isInteresting) continue
    lines.push(nodeToTextLine(node, idx))
    idx++
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** Register `android_screenshot` and `android_ui_dump`. */
export function registerScreenTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_screenshot',
    description:
      'Capture a screenshot from the Android device. The image may be scaled '
      + 'to fit the attachment store pixel limit; the result includes device_width, '
      + 'device_height, and scale so you know the mapping. Coordinates from '
      + 'android_ui_dump and android_tap use the scaled image space. '
      + 'The image is always saved to the attachment store (visible in the UI card). '
      + 'The image is emitted to the model only when the current model route accepts '
      + 'image input; otherwise, use android_ui_dump for text-based screen perception. '
      + 'Pass "serial" to target a specific device.',
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
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          device_width: { type: 'integer', required: true },
          device_height: { type: 'integer', required: true },
          scale: { type: 'number', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', const: 'image/png', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
          image_emitted: { type: 'boolean', required: true },
        },
      },
      render: renderScreenshot,
    },
    async execute(args, exec) {
      const a = args as { serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)

      const attachments = ctx.get('attachments') as import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
      if (attachments === undefined) {
        throw new Error('cannot capture screenshot: no attachment service is mounted')
      }

      const raw = await deps.adb.execOutBinary(serial, 'screencap -p', exec.signal)
      const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension)
      const ref = await attachments.saveImage({
        data: fitted.data,
        mediaType: 'image/png',
        name: 'screenshot.png',
      })

      const imageEmitted = await routeIsImageCapable(ctx, exec, exec.signal)

      const scale = fitted.scaleX

      return {
        serial,
        width: ref.width,
        height: ref.height,
        bytes: ref.bytes,
        device_width: Math.round(ref.width / fitted.scaleX),
        device_height: Math.round(ref.height / fitted.scaleY),
        scale,
        image: {
          attachmentId: ref.attachmentId as unknown as string,
          mediaType: 'image/png',
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
        },
        image_emitted: imageEmitted,
      } satisfies ScreenshotResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_ui_dump',
    description:
      'Dump the Android accessibility tree (UI hierarchy) as a structured node list. '
      + 'Each node includes text, content description, resource-id, class, bounds, '
      + 'center coordinates, and interaction flags (clickable, scrollable, etc.). '
      + 'All coordinates are in screenshot image space (scaled to match the screenshot '
      + 'from android_screenshot). Use node "center" values directly with android_tap. '
      + 'Pass "serial" to target a specific device.',
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
          screen_width: { type: 'integer', required: true },
          screen_height: { type: 'integer', required: true },
          image_width: { type: 'integer', required: true },
          image_height: { type: 'integer', required: true },
          scale: { type: 'number', required: true },
          rotation: { type: 'integer', required: true },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', required: true },
                content_desc: { type: 'string', required: true },
                resource_id: { type: 'string', required: true },
                class: { type: 'string', required: true },
                package: { type: 'string', required: true },
                bounds: {
                  oneOf: [
                    { type: 'null' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        left: { type: 'integer', required: true },
                        top: { type: 'integer', required: true },
                        right: { type: 'integer', required: true },
                        bottom: { type: 'integer', required: true },
                      },
                    },
                  ],
                  required: true,
                },
                center: {
                  oneOf: [
                    { type: 'null' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        x: { type: 'integer', required: true },
                        y: { type: 'integer', required: true },
                      },
                    },
                  ],
                  required: true,
                },
                clickable: { type: 'boolean', required: true },
                long_clickable: { type: 'boolean', required: true },
                focusable: { type: 'boolean', required: true },
                scrollable: { type: 'boolean', required: true },
                enabled: { type: 'boolean', required: true },
                password: { type: 'boolean', required: true },
                selected: { type: 'boolean', required: true },
                checked: { type: 'boolean', required: true },
                depth: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: renderUiDump,
    },
    async execute(args, exec) {
      const a = args as { serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)

      const dumpPath = `/sdcard/dsh_ui_dump_${Date.now()}.xml`
      await deps.adb.shell(serial, `uiautomator dump ${dumpPath}`, exec.signal)
      const xml = await deps.adb.execOut(serial, `cat ${dumpPath}`, exec.signal)
      const dump: UiDump = parseUiDumpXml(xml)

      const attachments = ctx.get('attachments') as import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
      const maxDim = attachments?.imageLimits.maxImageDimension ?? Infinity
      const scale = computeScale(dump.screen_width, dump.screen_height, maxDim)
      const scaled = scaleDump(dump, scale)

      return {
        serial,
        screen_width: dump.screen_width,
        screen_height: dump.screen_height,
        image_width: Math.round(dump.screen_width * scale),
        image_height: Math.round(dump.screen_height * scale),
        scale,
        rotation: dump.rotation,
        nodes: scaled.nodes,
      } satisfies UiDumpResult
    },
  }))
}
