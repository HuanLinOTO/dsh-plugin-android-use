/**
 * device.ts — `android_list_devices` and `android_device_info` tools.
 *
 * @module @huanlin/dsh-plugin-android-use/src/tools/device
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AdbClient, AdbDevice } from '../adb.js'
import { resolveSerial } from '../adb.js'
import type { ToolDeps } from '../registry.js'

/** Canonical result of `android_list_devices`. */
export interface ListDevicesResult {
  devices: Array<{
    serial: string
    state: string
    product?: string
    model?: string
    device?: string
  }>
  total: number
}

/** Canonical result of `android_device_info`. */
export interface DeviceInfoResult {
  serial: string
  model: string
  brand: string
  android_version: string
  sdk: number
  screen: { width: number; height: number; density: number }
  screen_on: boolean
}

/** Parse `wm size` output, preferring the override (effective) resolution. */
export function parseWmSize(output: string): { width: number; height: number; physicalWidth: number; physicalHeight: number } {
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(output)
  const override = /Override size:\s*(\d+)x(\d+)/.exec(output)
  const pw = physical !== null ? Number(physical[1]) : 0
  const ph = physical !== null ? Number(physical[2]) : 0
  const ow = override !== null ? Number(override[1]) : pw
  const oh = override !== null ? Number(override[2]) : ph
  return { width: ow, height: oh, physicalWidth: pw, physicalHeight: ph }
}

/** Parse `wm density` output, preferring the override density. */
export function parseWmDensity(output: string): { density: number; physicalDensity: number } {
  const physical = /Physical density:\s*(\d+)/.exec(output)
  const override = /Override density:\s*(\d+)/.exec(output)
  const pd = physical !== null ? Number(physical[1]) : 0
  return { density: override !== null ? Number(override[1]) : pd, physicalDensity: pd }
}

/** Parse `dumpsys power` output for the wakefulness state. */
export function parseWakefulness(output: string): boolean {
  return /mWakefulness=Awake/.test(output)
}

/** Convert an `AdbDevice` to the canonical list-devices entry. */
function deviceToEntry(d: AdbDevice): ListDevicesResult['devices'][number] {
  const entry: ListDevicesResult['devices'][number] = { serial: d.serial, state: d.state }
  if (d.product !== undefined) entry.product = d.product
  if (d.model !== undefined) entry.model = d.model
  if (d.device !== undefined) entry.device = d.device
  return entry
}

function renderListDevices(value: ListDevicesResult): string {
  if (value.devices.length === 0) return 'No devices attached.'
  const lines = [`Found ${value.devices.length} device(s):`]
  for (const d of value.devices) {
    const parts = [`state: ${d.state}`]
    if (d.model !== undefined) parts.push(`model: ${d.model}`)
    if (d.product !== undefined) parts.push(`product: ${d.product}`)
    lines.push(`  - ${d.serial} (${parts.join(', ')})`)
  }
  return lines.join('\n')
}

function renderDeviceInfo(value: DeviceInfoResult): string {
  const lines = [
    `Device: ${value.serial}`,
    `  Model: ${value.model} (${value.brand})`,
    `  Android: ${value.android_version} (SDK ${value.sdk})`,
    `  Screen: ${value.screen.width}x${value.screen.height} @ ${value.screen.density}dpi`,
    `  Screen on: ${value.screen_on}`,
  ]
  return lines.join('\n')
}

function textRender(fn: (value: never) => string): (args: unknown, value: unknown) => ContentBlock[] {
  return (_args, value) => [{ type: 'text', text: fn(value as never) }]
}

/** Register `android_list_devices` and `android_device_info`. */
export function registerDeviceTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'android_list_devices',
    description:
      'List all Android devices attached via adb. Returns each device\'s serial, '
      + 'state, product, model, and device name. Call this first to discover '
      + 'available devices before using other android_* tools.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                serial: { type: 'string', required: true },
                state: { type: 'string', required: true },
                product: { type: 'string' },
                model: { type: 'string' },
                device: { type: 'string' },
              },
            },
          },
          total: { type: 'integer', required: true },
        },
      },
      render: textRender(renderListDevices as (value: never) => string),
    },
    async execute(_args, exec) {
      const devices = await deps.adb.devices(exec.signal)
      const result: ListDevicesResult = {
        devices: devices.map(deviceToEntry),
        total: devices.length,
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_device_info',
    description:
      'Get detailed information about an Android device: model, brand, Android '
      + 'version, SDK level, screen resolution, density, and whether the screen '
      + 'is currently on. Pass "serial" to target a specific device, or omit it '
      + 'when only one device is attached.',
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
          model: { type: 'string', required: true },
          brand: { type: 'string', required: true },
          android_version: { type: 'string', required: true },
          sdk: { type: 'integer', required: true },
          screen: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              density: { type: 'integer', required: true },
            },
          },
          screen_on: { type: 'boolean', required: true },
        },
      },
      render: textRender(renderDeviceInfo as (value: never) => string),
    },
    async execute(args, exec) {
      const a = args as { serial?: string }
      const config = deps.getConfig()
      const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal)

      const batch = await deps.adb.shell(serial,
        'echo "=SZ="; wm size; echo "=DN="; wm density; echo "=MD="; getprop ro.product.model; '
        + 'echo "=BR="; getprop ro.product.brand; echo "=VR="; getprop ro.build.version.release; '
        + 'echo "=SDK="; getprop ro.build.version.sdk; echo "=WK="; dumpsys power|grep mWakefulness',
        exec.signal)

      const sections = splitByMarkers(batch)
      const sz = parseWmSize(sections.sz)
      const dn = parseWmDensity(sections.dn)

      const result: DeviceInfoResult = {
        serial,
        model: sections.md.trim(),
        brand: sections.br.trim(),
        android_version: sections.vr.trim(),
        sdk: Number(sections.sdk.trim()) || 0,
        screen: { width: sz.width, height: sz.height, density: dn.density },
        screen_on: parseWakefulness(sections.wk),
      }
      return result
    },
  }))
}

/** Split a batched shell output by `=XX=` markers into named sections. */
function splitByMarkers(output: string): { sz: string; dn: string; md: string; br: string; vr: string; sdk: string; wk: string } {
  const parts = output.split(/=[A-Z]+=/)
  return {
    sz: parts[1] ?? '',
    dn: parts[2] ?? '',
    md: parts[3] ?? '',
    br: parts[4] ?? '',
    vr: parts[5] ?? '',
    sdk: parts[6] ?? '',
    wk: parts[7] ?? '',
  }
}
