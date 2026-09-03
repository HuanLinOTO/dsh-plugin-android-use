import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import sharp from 'sharp'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: vi.fn((opts: unknown) => opts),
}))

import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerTools } from '../src/registry.js'
import type { ResolvedConfig, ToolDeps } from '../src/registry.js'
import type { AdbClient, AdbDevice } from '../src/adb.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureXml = readFileSync(join(__dirname, 'fixtures/launcher_dump.xml'), 'utf8')

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer()
}

const defaultConfig: ResolvedConfig = {
  defaultSerial: undefined,
  inputTextMode: 'input',
}

interface FakeAdbBehaviors {
  devicesValue?: AdbDevice[]
  shellFn?: (serial: string, command: string) => string
  execOutFn?: (serial: string, command: string) => string
  execOutBinaryFn?: (serial: string, command: string) => Buffer
}

function makeFakeAdb(behaviors: FakeAdbBehaviors = {}): AdbClient {
  return {
    devices: async () => behaviors.devicesValue ?? [],
    shell: async (serial: string, command: string) => behaviors.shellFn?.(serial, command) ?? '',
    execOut: async (serial: string, command: string) => behaviors.execOutFn?.(serial, command) ?? '',
    execOutBinary: async (serial: string, command: string) => behaviors.execOutBinaryFn?.(serial, command) ?? Buffer.alloc(0),
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    runBinary: async () => Buffer.alloc(0),
  } as unknown as AdbClient
}

interface FakeStore {
  saveImage: ReturnType<typeof vi.fn>
  imageLimits: object
}

function makeFakeStore(): FakeStore {
  return {
    saveImage: vi.fn(async (input: { data: Uint8Array; mediaType: string; name?: string }) => {
      const meta = await sharp(input.data).metadata()
      return {
        attachmentId: 'sha256:fakeattachmentid',
        mediaType: 'image/png',
        bytes: input.data.byteLength,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        ...(input.name !== undefined ? { name: input.name } : {}),
      }
    }),
    imageLimits: {
      maxImageBytes: 999999,
      maxImagesPerMessage: 1,
      maxMessageImageBytes: 999999,
      maxImagePixels: 999999,
      maxImageDimension: 9999,
      mediaTypes: ['image/png'],
    },
  }
}

function makeCtx(options?: { attachments?: FakeStore | object; llm?: object }): Context & { registered: unknown[] } {
  const registered: unknown[] = []
  const ctx = {
    tools: {
      register(definition: unknown): () => void {
        registered.push(definition)
        return () => {
          const i = registered.indexOf(definition)
          if (i >= 0) registered.splice(i, 1)
        }
      },
      schemas(): readonly { name: string; description: string }[] {
        return registered.map((d) => {
          const opts = d as { name: string; description: string }
          return { name: opts.name, description: opts.description }
        })
      },
    },
    get(name: string): unknown {
      if (name === 'attachments') return options?.attachments
      if (name === 'llm') return options?.llm
      return undefined
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Context & { registered: unknown[] }
  Object.defineProperty(ctx, 'registered', { value: registered })
  return ctx
}

interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (args: unknown, value: unknown) => unknown[] }
  execute: (args: unknown, exec: { signal: AbortSignal; agent?: unknown }) => Promise<unknown>
}

function getTool(ctx: Context & { registered: unknown[] }, name: string): RegisteredTool {
  const tool = ctx.registered.find((d) => (d as { name: string }).name === name)
  if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
  return tool as RegisteredTool
}

function toolNames(ctx: Context & { registered: unknown[] }): string[] {
  return ctx.registered.map((d) => (d as { name: string }).name).sort()
}

const signal = new AbortController().signal

const DEVICE_INFO_BATCH = `=SZ=
Physical size: 1240x2772
Override size: 1080x2414
=DN=
Physical density: 560
Override density: 480
=MD=
PJF110
=BR=
OnePlus
=VR=
16
=SDK=
36
=WK=
  mWakefulness=Awake
`

const FOREGROUND_BATCH = `=FOCUS=
  mCurrentFocus=Window{f6144b2 u0 com.android.launcher/com.android.launcher.Launcher}
=WAKE=
  mWakefulness=Awake
`

describe('registerTools', () => {
  beforeEach(() => {
    vi.mocked(defineTool).mockClear()
  })

  it('registers exactly 10 tools', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    expect(ctx.registered).toHaveLength(10)
  })

  it('registers all expected tool names', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    expect(toolNames(ctx)).toEqual([
      'android_device_info',
      'android_foreground_app',
      'android_input_text',
      'android_list_devices',
      'android_open_app',
      'android_press_key',
      'android_screenshot',
      'android_swipe',
      'android_tap',
      'android_ui_dump',
    ])
  })
})

describe('android_list_devices', () => {
  it('returns the device list and total count', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [
        { serial: 'dev1', state: 'device', model: 'Pixel' },
        { serial: 'dev2', state: 'device', model: 'Galaxy' },
      ],
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_list_devices')
    const result = await tool.execute({}, { signal }) as { devices: unknown[]; total: number }
    expect(result.total).toBe(2)
    expect(result.devices).toHaveLength(2)
  })

  it('render produces text with device count', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_list_devices')
    const blocks = tool.output.render({}, { devices: [], total: 0 })
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { text: string }).text).toContain('No devices')
  })
})

describe('android_device_info', () => {
  it('parses batched shell output into device info', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'test-dev', state: 'device' }],
      shellFn: (_s, cmd) => cmd.includes('=SZ=') ? DEVICE_INFO_BATCH : '',
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_device_info')
    const result = await tool.execute({}, { signal }) as {
      serial: string; model: string; brand: string; android_version: string
      sdk: number; screen: { width: number; height: number; density: number }; screen_on: boolean
    }
    expect(result.serial).toBe('test-dev')
    expect(result.model).toBe('PJF110')
    expect(result.brand).toBe('OnePlus')
    expect(result.android_version).toBe('16')
    expect(result.sdk).toBe(36)
    expect(result.screen).toEqual({ width: 1080, height: 2414, density: 480 })
    expect(result.screen_on).toBe(true)
  })

  it('uses the param serial when provided', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      shellFn: (_s, cmd) => cmd.includes('=SZ=') ? DEVICE_INFO_BATCH : '',
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_device_info')
    const result = await tool.execute({ serial: 'explicit-serial' }, { signal }) as { serial: string }
    expect(result.serial).toBe('explicit-serial')
  })
})

describe('android_screenshot', () => {
  it('captures a screenshot and saves to attachment store', async () => {
    const store = makeFakeStore()
    const ctx = makeCtx({ attachments: store })
    const pngBytes = await makePng(1080, 2414)
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      execOutBinaryFn: () => pngBytes,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    const result = await tool.execute({}, { signal }) as {
      serial: string; width: number; height: number; bytes: number
      device_width: number; device_height: number; scale: number
      image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }
      image_emitted: boolean
    }
    expect(result.serial).toBe('dev')
    expect(result.bytes).toBe(pngBytes.byteLength)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(2414)
    expect(result.device_width).toBe(1080)
    expect(result.device_height).toBe(2414)
    expect(result.scale).toBe(1)
    expect(result.image.attachmentId).toBe('sha256:fakeattachmentid')
    expect(result.image.mediaType).toBe('image/png')
    expect(result.image_emitted).toBe(false)
    expect(store.saveImage).toHaveBeenCalledOnce()
  })

  it('scales screenshot and reports device dimensions when maxDimension < device resolution', async () => {
    const store = makeFakeStore()
    store.imageLimits = { ...store.imageLimits, maxImageDimension: 2000 }
    const ctx = makeCtx({ attachments: store })
    const pngBytes = await makePng(1080, 2414)
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      execOutBinaryFn: () => pngBytes,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    const result = await tool.execute({}, { signal }) as {
      width: number; height: number; device_width: number; device_height: number; scale: number
    }
    expect(result.width).toBe(895)
    expect(result.height).toBe(2000)
    expect(result.device_width).toBe(1080)
    expect(result.device_height).toBe(2414)
    expect(result.scale).toBeCloseTo(895 / 1080, 3)
  })

  it('render returns only a text block when image_emitted is false', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    const blocks = tool.output.render({}, {
      serial: 'dev', width: 1080, height: 2414, bytes: 100,
      device_width: 1080, device_height: 2414, scale: 1,
      image: { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 100, width: 1080, height: 2414 },
      image_emitted: false,
    })
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { type: string }).type).toBe('text')
  })

  it('render returns text + image block when image_emitted is true', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    const blocks = tool.output.render({}, {
      serial: 'dev', width: 1080, height: 2414, bytes: 100,
      device_width: 1080, device_height: 2414, scale: 1,
      image: { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 100, width: 1080, height: 2414 },
      image_emitted: true,
    })
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as { type: string }).type).toBe('text')
    expect((blocks[1] as { type: string }).type).toBe('image')
  })

  it('throws when no attachment service is mounted', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    await expect(tool.execute({}, { signal })).rejects.toThrow('no attachment service')
  })
})

describe('android_ui_dump', () => {
  it('dumps and parses the accessibility tree', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: () => 'UI hierchary dumped to: /sdcard/dsh_ui_dump.xml',
      execOutFn: () => fixtureXml,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_ui_dump')
    const result = await tool.execute({}, { signal }) as {
      serial: string; screen_width: number; screen_height: number
      image_width: number; image_height: number; scale: number
      rotation: number; nodes: unknown[]
    }
    expect(result.serial).toBe('dev')
    expect(result.screen_width).toBe(1080)
    expect(result.screen_height).toBe(2414)
    expect(result.image_width).toBe(1080)
    expect(result.image_height).toBe(2414)
    expect(result.scale).toBe(1)
    expect(result.rotation).toBe(0)
    expect(result.nodes).toHaveLength(44)
  })

  it('scales node coordinates to image space when attachment store limits resolution', async () => {
    const store = makeFakeStore()
    store.imageLimits = { ...store.imageLimits, maxImageDimension: 2000 }
    const ctx = makeCtx({ attachments: store })
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: () => 'UI hierchary dumped to: /sdcard/dsh_ui_dump.xml',
      execOutFn: () => fixtureXml,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_ui_dump')
    const result = await tool.execute({}, { signal }) as {
      screen_width: number; screen_height: number
      image_width: number; image_height: number; scale: number
      nodes: { center: { x: number; y: number } | null }[]
    }
    expect(result.screen_width).toBe(1080)
    expect(result.screen_height).toBe(2414)
    expect(result.image_width).toBe(895)
    expect(result.image_height).toBe(2000)
    expect(result.scale).toBeCloseTo(2000 / 2414, 3)
    // Nodes should have scaled centers
    const nodeWithCenter = result.nodes.find(n => n.center !== null)
    expect(nodeWithCenter).toBeDefined()
    // Scale factor ≈ 0.8285, so centers should be smaller than device coords
    expect(nodeWithCenter!.center!.x).toBeLessThan(1080)
    expect(nodeWithCenter!.center!.y).toBeLessThan(2414)
  })

  it('render produces text with node count and interactive summary', () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb()
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_ui_dump')
    const blocks = tool.output.render({}, {
      serial: 'dev', screen_width: 1080, screen_height: 2414,
      image_width: 1080, image_height: 2414, scale: 1, rotation: 0,
      nodes: [
        { text: 'Settings', content_desc: '', resource_id: '', class: 'TextView', package: 'com.android.settings', bounds: { left: 0, top: 0, right: 100, bottom: 50 }, center: { x: 50, y: 25 }, clickable: true, long_clickable: false, focusable: false, scrollable: false, enabled: true, password: false, selected: false, checked: false, depth: 0 },
        { text: '', content_desc: '', resource_id: '', class: 'FrameLayout', package: 'com.android.launcher', bounds: null, center: null, clickable: false, long_clickable: false, focusable: false, scrollable: false, enabled: true, password: false, selected: false, checked: false, depth: 0 },
      ],
    })
    expect(blocks).toHaveLength(1)
    const text = (blocks[0] as { text: string }).text
    expect(text).toContain('2 nodes total')
    expect(text).toContain('1 interactive')
    expect(text).toContain('Settings')
    expect(text).not.toContain('FrameLayout')
  })
})

describe('android_tap', () => {
  it('executes input tap for a quick tap', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 100, y: 200 }, { signal }) as { action: string; x: number; y: number; device_x: number; device_y: number; pre_tap_screenshot: unknown; post_tap_screenshot: unknown; screenshot_emitted: boolean }
    expect(result.action).toBe('tap')
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
    expect(result.device_x).toBe(100)
    expect(result.device_y).toBe(200)
    expect(result.pre_tap_screenshot).toBeNull()
    expect(result.post_tap_screenshot).toBeNull()
    expect(result.screenshot_emitted).toBe(false)
    expect(shellCalls).toContain('input tap 100 200')
  })

  it('executes input swipe for a long press', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 50, y: 60, duration_ms: 500 }, { signal }) as { action: string; duration_ms: number; device_x: number; device_y: number }
    expect(result.action).toBe('long_press')
    expect(result.duration_ms).toBe(500)
    expect(result.device_x).toBe(50)
    expect(result.device_y).toBe(60)
    expect(shellCalls.some(c => c.includes('input swipe 50 60 50 60 500'))).toBe(true)
  })

  it('repeats the tap times times', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 10, y: 20, times: 3 }, { signal }) as { times: number; device_x: number; device_y: number }
    expect(result.times).toBe(3)
    expect(result.device_x).toBe(10)
    expect(result.device_y).toBe(20)
    expect(shellCalls.filter(c => c.includes('input tap 10 20'))).toHaveLength(3)
  })

  it('captures both pre-tap and post-tap screenshots when attachment store is available', async () => {
    const store = makeFakeStore()
    const ctx = makeCtx({ attachments: store })
    const pngBytes = await makePng(1080, 2414)
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
      execOutBinaryFn: () => pngBytes,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 540, y: 1207 }, { signal }) as {
      pre_tap_screenshot: { attachmentId: string; width: number; height: number; bytes: number } | null
      post_tap_screenshot: { attachmentId: string; width: number; height: number; bytes: number } | null
      screenshot_emitted: boolean
      device_x: number; device_y: number
    }
    expect(result.pre_tap_screenshot).not.toBeNull()
    expect(result.pre_tap_screenshot!.attachmentId).toBe('sha256:fakeattachmentid')
    expect(result.pre_tap_screenshot!.width).toBe(1080)
    expect(result.pre_tap_screenshot!.height).toBe(2414)
    expect(result.post_tap_screenshot).not.toBeNull()
    expect(result.post_tap_screenshot!.attachmentId).toBe('sha256:fakeattachmentid')
    expect(result.post_tap_screenshot!.width).toBe(1080)
    expect(result.post_tap_screenshot!.height).toBe(2414)
    expect(result.screenshot_emitted).toBe(false)
    expect(result.device_x).toBe(540)
    expect(result.device_y).toBe(1207)
    expect(store.saveImage).toHaveBeenCalledTimes(2)
    expect(shellCalls).toContain('input tap 540 1207')
  })

  it('converts image-space tap coordinates to device-space when screenshot is scaled', async () => {
    const store = makeFakeStore()
    store.imageLimits = { ...store.imageLimits, maxImageDimension: 2000 }
    const ctx = makeCtx({ attachments: store })
    const pngBytes = await makePng(1080, 2414)
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
      execOutBinaryFn: () => pngBytes,
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    // Model sees a 895x2000 image and picks center (447, 1000)
    const result = await tool.execute({ x: 447, y: 1000 }, { signal }) as {
      device_x: number; device_y: number
      pre_tap_screenshot: { width: number; height: number } | null
      post_tap_screenshot: { width: number; height: number } | null
    }
    // Plugin converts back to device coords: 447/(895/1080)≈539, 1000/(2000/2414)≈1207
    expect(result.device_x).toBe(539)
    expect(result.device_y).toBe(1207)
    expect(result.pre_tap_screenshot).not.toBeNull()
    expect(result.pre_tap_screenshot!.width).toBe(895)
    expect(result.pre_tap_screenshot!.height).toBe(2000)
    expect(result.post_tap_screenshot).not.toBeNull()
    expect(result.post_tap_screenshot!.width).toBe(895)
    expect(result.post_tap_screenshot!.height).toBe(2000)
    expect(shellCalls).toContain('input tap 539 1207')
  })

  it('still performs the tap when screenshot capture fails', async () => {
    const store = makeFakeStore()
    const ctx = makeCtx({ attachments: store })
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
      execOutBinaryFn: () => Buffer.from([0x00, 0x01, 0x02]),
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 100, y: 200 }, { signal }) as {
      pre_tap_screenshot: unknown; post_tap_screenshot: unknown; screenshot_emitted: boolean; device_x: number; device_y: number
    }
    expect(result.pre_tap_screenshot).toBeNull()
    expect(result.post_tap_screenshot).toBeNull()
    expect(result.screenshot_emitted).toBe(false)
    expect(result.device_x).toBe(100)
    expect(result.device_y).toBe(200)
    expect(shellCalls).toContain('input tap 100 200')
  })

  it('render returns text only when both screenshots are null', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const blocks = tool.output.render({}, {
      serial: 'dev', x: 100, y: 200, device_x: 100, device_y: 200, duration_ms: 0, times: 1, action: 'tap',
      pre_tap_screenshot: null, post_tap_screenshot: null, screenshot_emitted: false,
    })
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { type: string }).type).toBe('text')
  })

  it('render returns text only when screenshots exist but not emitted', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const blocks = tool.output.render({}, {
      serial: 'dev', x: 100, y: 200, device_x: 100, device_y: 200, duration_ms: 0, times: 1, action: 'tap',
      pre_tap_screenshot: { attachmentId: 'sha256:x', bytes: 100, width: 1080, height: 2414 },
      post_tap_screenshot: { attachmentId: 'sha256:y', bytes: 100, width: 1080, height: 2414 },
      screenshot_emitted: false,
    })
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { type: string }).type).toBe('text')
    expect(((blocks[0] as { text: string }).text)).toContain('Images emitted to model: no')
  })

  it('render returns text + two labeled images when screenshots are emitted', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const blocks = tool.output.render({}, {
      serial: 'dev', x: 100, y: 200, device_x: 100, device_y: 200, duration_ms: 0, times: 1, action: 'tap',
      pre_tap_screenshot: { attachmentId: 'sha256:x', bytes: 100, width: 1080, height: 2414 },
      post_tap_screenshot: { attachmentId: 'sha256:y', bytes: 100, width: 1080, height: 2414 },
      screenshot_emitted: true,
    })
    // 1 text summary + 1 text label + 1 image + 1 text label + 1 image = 5
    expect(blocks).toHaveLength(5)
    expect((blocks[0] as { type: string }).type).toBe('text')
    expect((blocks[1] as { type: string }).type).toBe('text')
    expect((blocks[1] as { text: string }).text).toContain('Pre-tap')
    expect((blocks[2] as { type: string }).type).toBe('image')
    expect((blocks[3] as { type: string }).type).toBe('text')
    expect((blocks[3] as { text: string }).text).toContain('Post-tap')
    expect((blocks[4] as { type: string }).type).toBe('image')
  })
})

describe('android_swipe', () => {
  it('executes input swipe with coordinates and duration', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_swipe')
    const result = await tool.execute({ x1: 100, y1: 200, x2: 300, y2: 400, duration_ms: 500 }, { signal }) as { duration_ms: number; device_x1: number; device_y1: number; device_x2: number; device_y2: number }
    expect(result.duration_ms).toBe(500)
    expect(result.device_x1).toBe(100)
    expect(result.device_y1).toBe(200)
    expect(result.device_x2).toBe(300)
    expect(result.device_y2).toBe(400)
    expect(shellCalls.some(c => c.includes('input swipe 100 200 300 400 500'))).toBe(true)
  })

  it('defaults duration to 300ms', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_swipe')
    await tool.execute({ x1: 0, y1: 0, x2: 100, y2: 100 }, { signal })
    expect(shellCalls.some(c => c.includes('300'))).toBe(true)
  })

  it('converts image-space swipe coordinates to device-space when attachment store limits resolution', async () => {
    const store = makeFakeStore()
    store.imageLimits = { ...store.imageLimits, maxImageDimension: 2000 }
    const ctx = makeCtx({ attachments: store })
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => {
        shellCalls.push(cmd)
        if (cmd === 'wm size') return 'Physical size: 1080x2414\n'
        return ''
      },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_swipe')
    const result = await tool.execute({ x1: 100, y1: 200, x2: 300, y2: 400, duration_ms: 500 }, { signal }) as {
      device_x1: number; device_y1: number; device_x2: number; device_y2: number
    }
    // scale = 2000/2414 ≈ 0.8285
    expect(result.device_x1).toBe(121)
    expect(result.device_y1).toBe(241)
    expect(result.device_x2).toBe(362)
    expect(result.device_y2).toBe(483)
    expect(shellCalls.some(c => c.includes('input swipe 121 241 362 483 500'))).toBe(true)
  })
})

describe('android_press_key', () => {
  it('resolves named key to keycode', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_press_key')
    const result = await tool.execute({ key: 'home' }, { signal }) as { keycode: number; key: string }
    expect(result.keycode).toBe(3)
    expect(result.key).toBe('home')
    expect(shellCalls.some(c => c.includes('input keyevent 3'))).toBe(true)
  })

  it('passes through integer keycode', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: () => '',
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_press_key')
    const result = await tool.execute({ key: 187 }, { signal }) as { keycode: number }
    expect(result.keycode).toBe(187)
  })

  it('throws for unknown key names', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_press_key')
    await expect(tool.execute({ key: 'nonexistent' }, { signal })).rejects.toThrow('unknown key name')
  })
})

describe('android_input_text', () => {
  it('types ASCII text in input mode', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_input_text')
    const result = await tool.execute({ text: 'hello' }, { signal }) as { mode: string; submitted: boolean }
    expect(result.mode).toBe('input')
    expect(result.submitted).toBe(false)
    expect(shellCalls.some(c => c.includes('input text') && c.includes('hello'))).toBe(true)
  })

  it('presses enter when submit is true', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_input_text')
    const result = await tool.execute({ text: 'test', submit: true }, { signal }) as { submitted: boolean }
    expect(result.submitted).toBe(true)
    expect(shellCalls.some(c => c.includes('keyevent 66'))).toBe(true)
  })

  it('throws on non-ASCII in input mode', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_input_text')
    await expect(tool.execute({ text: '你好' }, { signal })).rejects.toThrow('non-ASCII')
  })

  it('uses adbkeyboard broadcast in adbkeyboard mode', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => ({ defaultSerial: undefined, inputTextMode: 'adbkeyboard' }) })
    const tool = getTool(ctx, 'android_input_text')
    const result = await tool.execute({ text: '你好' }, { signal }) as { mode: string }
    expect(result.mode).toBe('adbkeyboard')
    expect(shellCalls.some(c => c.includes('ADB_INPUT_TEXT'))).toBe(true)
  })
})

describe('android_open_app', () => {
  it('starts app with activity when provided', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_open_app')
    const result = await tool.execute({ package: 'com.test', activity: '.MainActivity' }, { signal }) as { package: string; activity?: string }
    expect(result.package).toBe('com.test')
    expect(result.activity).toBe('.MainActivity')
    expect(shellCalls.some(c => c.includes('am start -n com.test/com.test.MainActivity'))).toBe(true)
  })

  it('uses monkey when no activity is provided', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_open_app')
    await tool.execute({ package: 'com.android.settings' }, { signal })
    expect(shellCalls.some(c => c.includes('monkey -p com.android.settings'))).toBe(true)
  })
})

describe('android_foreground_app', () => {
  it('parses the foreground app from dumpsys output', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [{ serial: 'dev', state: 'device' }],
      shellFn: (_s, cmd) => cmd.includes('=FOCUS=') ? FOREGROUND_BATCH : '',
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_foreground_app')
    const result = await tool.execute({}, { signal }) as {
      serial: string; package: string | null; activity: string | null; screen_on: boolean
    }
    expect(result.serial).toBe('dev')
    expect(result.package).toBe('com.android.launcher')
    expect(result.activity).toBe('com.android.launcher.Launcher')
    expect(result.screen_on).toBe(true)
  })
})

describe('serial resolution across tools', () => {
  it('uses config defaultSerial when no param is given', async () => {
    const ctx = makeCtx()
    const shellCalls: string[] = []
    const adb = makeFakeAdb({
      shellFn: (_s, cmd) => { shellCalls.push(cmd); return '' },
    })
    registerTools(ctx, { adb, getConfig: () => ({ defaultSerial: 'config-dev', inputTextMode: 'input' }) })
    const tool = getTool(ctx, 'android_tap')
    const result = await tool.execute({ x: 1, y: 2 }, { signal }) as { serial: string }
    expect(result.serial).toBe('config-dev')
  })

  it('throws when multiple devices are attached and no serial is given', async () => {
    const ctx = makeCtx()
    const adb = makeFakeAdb({
      devicesValue: [
        { serial: 'dev1', state: 'device' },
        { serial: 'dev2', state: 'device' },
      ],
    })
    registerTools(ctx, { adb, getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    await expect(tool.execute({ x: 1, y: 2 }, { signal })).rejects.toThrow('multiple devices')
  })
})

describe('schema validation', () => {
  it('android_tap requires x and y', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const params = tool.parameters as { x: { required?: true }; y: { required?: true }; duration_ms: { required?: true }; serial: { required?: true } }
    expect(params.x.required).toBe(true)
    expect(params.y.required).toBe(true)
    expect(params.duration_ms.required).toBeUndefined()
    expect(params.serial.required).toBeUndefined()
  })

  it('android_tap output schema has pre_tap_screenshot, post_tap_screenshot, and screenshot_emitted', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_tap')
    const schema = tool.output.schema as {
      type: string; properties: {
        pre_tap_screenshot: { oneOf?: unknown[]; required?: true }
        post_tap_screenshot: { oneOf?: unknown[]; required?: true }
        screenshot_emitted: { type: string; required?: true }
      }
    }
    expect(schema.type).toBe('object')
    expect(schema.properties.pre_tap_screenshot.oneOf).toBeDefined()
    expect(schema.properties.pre_tap_screenshot.required).toBe(true)
    expect(schema.properties.post_tap_screenshot.oneOf).toBeDefined()
    expect(schema.properties.post_tap_screenshot.required).toBe(true)
    expect(schema.properties.screenshot_emitted.type).toBe('boolean')
    expect(schema.properties.screenshot_emitted.required).toBe(true)
  })

  it('android_press_key requires key', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_press_key')
    const params = tool.parameters as { key: { required?: true; oneOf?: unknown[] } }
    expect(params.key.required).toBe(true)
    expect(params.key.oneOf).toBeDefined()
  })

  it('android_input_text requires text', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_input_text')
    const params = tool.parameters as { text: { required?: true }; submit: { required?: true } }
    expect(params.text.required).toBe(true)
    expect(params.submit.required).toBeUndefined()
  })

  it('android_open_app requires package', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_open_app')
    const params = tool.parameters as { package: { required?: true }; activity: { required?: true } }
    expect(params.package.required).toBe(true)
    expect(params.activity.required).toBeUndefined()
  })

  it('android_screenshot output schema has image_emitted', () => {
    const ctx = makeCtx()
    registerTools(ctx, { adb: makeFakeAdb(), getConfig: () => defaultConfig })
    const tool = getTool(ctx, 'android_screenshot')
    const schema = tool.output.schema as {
      type: string; properties: { image_emitted: { type: string; required?: true } }
    }
    expect(schema.type).toBe('object')
    expect(schema.properties.image_emitted.type).toBe('boolean')
    expect(schema.properties.image_emitted.required).toBe(true)
  })
})
