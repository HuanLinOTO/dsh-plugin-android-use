/**
 * screen.ts — android_screenshot and android_ui_dump.
 *
 * android_screenshot delivers a conditioned frame: cropped and magnified when
 * asked, capped and compressed for the model, and ruler-annotated with a
 * coordinate grid whose labels are screenshot pixels. android_ui_dump reads the
 * accessibility tree and reports an empty tree explicitly instead of failing
 * silently, because many apps draw their UI without accessibility nodes.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/screen
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { resolveSerial } from '../adb.js'
import { parseWmSize } from './device.js'
import { routeIsImageCapable } from '../route.js'
import { parseUiDumpXml } from '../xml.js'
import type { UiNode } from '../xml.js'
import { captureFrame, type Frame } from '../frame.js'
import type { ToolDeps } from '../registry.js'

/** Canonical result of android_screenshot. */
export interface ScreenshotResult {
  serial: string
  width: number
  height: number
  bytes: number
  media_type: string
  device_width: number
  device_height: number
  scale: number
  origin_x: number
  origin_y: number
  magnify: number
  grid_step: number | null
  saved_path: string | null
  image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number } | null
  image_emitted: boolean
}

/** Canonical result of android_ui_dump. */
export interface UiDumpResult {
  serial: string
  screen_width: number
  screen_height: number
  rotation: number
  /** True when the foreground app exposed no accessibility nodes. */
  empty: boolean
  nodes: UiNode[]
}

/** One-line explanation of the coordinate space shared by every android_* tool. */
const COORDINATE_NOTE = 'Grid labels and node coordinates are screenshot pixels, which match device pixels: pass them to android_tap, android_swipe, and android_screenshot(region) unchanged.'

function kib(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

function frameSummary(frame: Frame): string[] {
  const lines = [
    `Screenshot delivered: ${frame.width}x${frame.height} px (${frame.mediaType}, ${kib(frame.bytes)}).`,
    `Device screenshot: ${frame.deviceWidth}x${frame.deviceHeight} px, scale ${frame.scale.toFixed(3)}.`,
    COORDINATE_NOTE,
  ]
  lines.push(frame.gridStep === null
    ? 'Grid: disabled (plugin config showGrid=false).'
    : `Grid: lines every ${frame.gridStep} px on both axes, labelled with their screenshot coordinate.`)
  if (frame.originX !== 0 || frame.originY !== 0 || frame.magnify !== 1) {
    lines.push(`Region: origin (${frame.originX}, ${frame.originY}), magnified x${frame.magnify.toFixed(2)}.`)
  }
  lines.push(frame.savedPath === null
    ? 'Retained copy: not written.'
    : `Retained copy: ${frame.savedPath}`)
  return lines
}

function renderScreenshot(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as ScreenshotResult
  const lines = frameSummary({
    serial: v.serial,
    width: v.width,
    height: v.height,
    bytes: v.bytes,
    mediaType: v.media_type,
    deviceWidth: v.device_width,
    deviceHeight: v.device_height,
    scale: v.scale,
    image: v.image,
    savedPath: v.saved_path,
    originX: v.origin_x,
    originY: v.origin_y,
    magnify: v.magnify,
    gridStep: v.grid_step,
    note: null,
  })
  lines.push(v.image_emitted
    ? 'Image emitted to model context: yes.'
    : 'Image emitted to model context: no (the current route is not image-capable; the retained copy and the UI card still show it).')
  const text = lines.join('\n')
  const blocks: ContentBlock[] = [{ type: 'text', text }]
  if (v.image_emitted && v.image !== null) {
    const ref: ImageAttachmentRef = {
      attachmentId: v.image.attachmentId as unknown as ImageAttachmentRef['attachmentId'],
      mediaType: v.image.mediaType as ImageAttachmentRef['mediaType'],
      bytes: v.image.bytes,
      width: v.image.width,
      height: v.image.height,
    }
    blocks.push({ type: 'image', attachment: ref })
  }
  return blocks
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

function renderUiDump(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as UiDumpResult
  const interactive = v.nodes.filter(n =>
    n.text !== '' || n.content_desc !== '' || n.clickable || n.long_clickable || n.scrollable || n.focusable,
  )
  const lines = [`UI dump: ${v.nodes.length} nodes (${interactive.length} interactive/text), screen ${v.screen_width}x${v.screen_height}, rotation ${v.rotation}.`]
  if (v.empty) {
    lines.push('The foreground app exposed no accessibility nodes, so this dump cannot guide a tap.')
    lines.push('Do not retry android_ui_dump on this screen: call android_screenshot and read the coordinate grid instead. Zoom with android_screenshot(region, magnify) when the target is small.')
    return [{ type: 'text', text: lines.join('\n') }]
  }
  lines.push(COORDINATE_NOTE)
  lines.push(`Showing ${interactive.length} interactive/text nodes:`)
  let idx = 0
  for (const node of v.nodes) {
    const interesting = node.text !== '' || node.content_desc !== '' || node.clickable || node.long_clickable || node.scrollable || node.focusable
    if (!interesting) continue
    lines.push(nodeToTextLine(node, idx))
    idx++
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** Register android_screenshot and android_ui_dump. */
export function registerScreenTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_screenshot',
    description:
      'Capture the Android screen and deliver it with a coordinate grid burned in. '
      + 'Grid labels are screenshot pixels (= device pixels): read a label and pass that number to android_tap or android_swipe unchanged. '
      + 'Pass region {x, y, width, height} to crop around a small target and magnify to zoom in (region + magnify is the reliable way to pin a tap point in a crowded list); the grid labels stay in full-screenshot coordinates. '
      + 'The delivered image is capped and compressed for the model; the full-size device resolution and the delivered/delivered scale are always reported. '
      + 'A copy is retained under the plugin capture directory and its path is returned. '
      + 'Pass serial to target a specific device.',
    parameters: {
      region: {
        type: 'object',
        additionalProperties: false,
        description: 'Crop window in screenshot pixels, e.g. {x: 200, y: 800, width: 400, height: 300}.',
        properties: {
          x: { type: 'integer', required: true, description: 'Left edge in screenshot pixels.' },
          y: { type: 'integer', required: true, description: 'Top edge in screenshot pixels.' },
          width: { type: 'integer', required: true, description: 'Crop width in screenshot pixels.' },
          height: { type: 'integer', required: true, description: 'Crop height in screenshot pixels.' },
        },
      },
      magnify: {
        type: 'number',
        description: 'Zoom factor for a region crop (1-8). Omit to fill the size cap automatically (up to x4); ignored without region.',
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
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          media_type: { type: 'string', required: true },
          device_width: { type: 'integer', required: true },
          device_height: { type: 'integer', required: true },
          scale: { type: 'number', required: true },
          origin_x: { type: 'integer', required: true },
          origin_y: { type: 'integer', required: true },
          magnify: { type: 'number', required: true },
          grid_step: { oneOf: [{ type: 'null' }, { type: 'integer' }], required: true },
          saved_path: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          image: {
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
          image_emitted: { type: 'boolean', required: true },
        },
      },
      render: renderScreenshot,
    },
    async execute(args, exec) {
      const a = args as { region?: { x: number; y: number; width: number; height: number }; magnify?: number; serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)
      const frame = await captureFrame(ctx, deps, {
        serial,
        kind: 'shot',
        region: a.region,
        magnify: a.magnify,
        signal: exec.signal,
      })
      const imageEmitted = frame.image !== null && await routeIsImageCapable(ctx, exec, exec.signal)
      return {
        serial,
        width: frame.width,
        height: frame.height,
        bytes: frame.bytes,
        media_type: frame.mediaType,
        device_width: frame.deviceWidth,
        device_height: frame.deviceHeight,
        scale: frame.scale,
        origin_x: frame.originX,
        origin_y: frame.originY,
        magnify: frame.magnify,
        grid_step: frame.gridStep,
        saved_path: frame.savedPath,
        image: frame.image,
        image_emitted: imageEmitted,
      } satisfies ScreenshotResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_ui_dump',
    description:
      'Dump the Android accessibility tree (UI hierarchy) as a structured node list: text, content description, resource-id, class, bounds, center, and interaction flags. '
      + 'Node center values are screenshot pixels (= device pixels) and can be passed to android_tap unchanged. '
      + 'Many apps (especially self-drawn super-apps) expose no accessibility nodes at all; when that happens the result says so explicitly and android_screenshot is the only remaining way to see the screen, so do not retry this tool on the same screen. '
      + 'Pass serial to target a specific device.',
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
          rotation: { type: 'integer', required: true },
          empty: { type: 'boolean', required: true },
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
      // uiautomator prints a success banner even when it writes nothing, so the
      // file size is the only honest signal that a dump happened.
      const probe = await deps.adb.shell(serial, `uiautomator dump ${dumpPath} >/dev/null 2>&1; wc -c < ${dumpPath} 2>/dev/null || echo MISSING`, exec.signal)
      const sizeMatch = /^\s*(\d+)\s*$/m.exec(probe)
      const fileSize = sizeMatch !== null ? Number(sizeMatch[1]) : 0
      const xml = fileSize > 0 ? await deps.adb.execOut(serial, `cat ${dumpPath}`, exec.signal) : ''
      await deps.adb.shell(serial, `rm -f ${dumpPath}`, exec.signal)

      const dump = parseUiDumpXml(xml)
      let screenWidth = dump.screen_width
      let screenHeight = dump.screen_height
      if (screenWidth <= 0 || screenHeight <= 0) {
        const size = parseWmSize(await deps.adb.shell(serial, 'wm size', exec.signal))
        screenWidth = size.width
        screenHeight = size.height
      }

      return {
        serial,
        screen_width: screenWidth,
        screen_height: screenHeight,
        rotation: dump.rotation,
        empty: dump.nodes.length === 0,
        nodes: dump.nodes,
      } satisfies UiDumpResult
    },
  }))
}
