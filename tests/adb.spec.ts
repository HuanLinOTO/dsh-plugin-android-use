import { describe, it, expect } from 'vitest'
import { parseDeviceList, resolveSerial, parseWmSize } from '../src/adb.js'
import type { AdbClient, AdbDevice } from '../src/adb.js'

const REAL_DEVICES_OUTPUT = `List of devices attached
192.168.5.15:43709     device product:PJF110 model:PJF110 device:OP5CFBL1 transport_id:1

`

const MULTI_DEVICE_OUTPUT = `List of devices attached
emulator-5554   device product:sdk_gphone64 model:sdk_gphone64 device:emu64x transport_id:1
192.168.5.15:43709     device product:PJF110 model:PJF110 device:OP5CFBL1 transport_id:2

`

const OFFLINE_DEVICE_OUTPUT = `List of devices attached
192.168.5.15:43709     offline transport_id:1
`

describe('parseDeviceList', () => {
  it('parses a single real device', () => {
    const devices = parseDeviceList(REAL_DEVICES_OUTPUT)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      serial: '192.168.5.15:43709',
      state: 'device',
      product: 'PJF110',
      model: 'PJF110',
      device: 'OP5CFBL1',
      transportId: 1,
    })
  })

  it('parses multiple devices', () => {
    const devices = parseDeviceList(MULTI_DEVICE_OUTPUT)
    expect(devices).toHaveLength(2)
    expect(devices[0]!.serial).toBe('emulator-5554')
    expect(devices[1]!.serial).toBe('192.168.5.15:43709')
  })

  it('parses offline devices', () => {
    const devices = parseDeviceList(OFFLINE_DEVICE_OUTPUT)
    expect(devices).toHaveLength(1)
    expect(devices[0]!.state).toBe('offline')
  })

  it('returns empty for no devices', () => {
    expect(parseDeviceList('List of devices attached\n\n')).toEqual([])
  })

  it('returns empty for empty output', () => {
    expect(parseDeviceList('')).toEqual([])
  })

  it('skips daemon banner lines', () => {
    const withBanner = '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n192.168.5.15:43709     device\n\n'
    const devices = parseDeviceList(withBanner)
    expect(devices).toHaveLength(1)
    expect(devices[0]!.serial).toBe('192.168.5.15:43709')
  })

  it('handles unauthorized state', () => {
    const devices = parseDeviceList('List of devices attached\n192.168.5.15:43709     unauthorized\n\n')
    expect(devices).toHaveLength(1)
    expect(devices[0]!.state).toBe('unauthorized')
  })

  it('handles devices without -l fields', () => {
    const devices = parseDeviceList('List of devices attached\n192.168.5.15:43709     device\n\n')
    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({ serial: '192.168.5.15:43709', state: 'device' })
  })
})

describe('resolveSerial', () => {
  function makeFakeAdb(devices: AdbDevice[]): AdbClient {
    return {
      devices: async () => devices,
    } as unknown as AdbClient
  }

  it('uses the param serial when provided', async () => {
    const adb = makeFakeAdb([])
    const result = await resolveSerial(adb, 'my-serial', undefined)
    expect(result.serial).toBe('my-serial')
    expect(result.source).toBe('param')
  })

  it('uses the config serial when no param is provided', async () => {
    const adb = makeFakeAdb([])
    const result = await resolveSerial(adb, undefined, 'config-serial')
    expect(result.serial).toBe('config-serial')
    expect(result.source).toBe('config')
  })

  it('param takes precedence over config', async () => {
    const adb = makeFakeAdb([])
    const result = await resolveSerial(adb, 'param-serial', 'config-serial')
    expect(result.serial).toBe('param-serial')
    expect(result.source).toBe('param')
  })

  it('auto-selects when exactly one ready device is attached', async () => {
    const adb = makeFakeAdb([
      { serial: 'only-device', state: 'device' },
    ])
    const result = await resolveSerial(adb, undefined, undefined)
    expect(result.serial).toBe('only-device')
    expect(result.source).toBe('auto')
  })

  it('throws when multiple devices are attached and no serial is given', async () => {
    const adb = makeFakeAdb([
      { serial: 'device-1', state: 'device' },
      { serial: 'device-2', state: 'device' },
    ])
    await expect(resolveSerial(adb, undefined, undefined)).rejects.toThrow('multiple devices')
  })

  it('throws when no device is ready', async () => {
    const adb = makeFakeAdb([
      { serial: 'offline-device', state: 'offline' },
    ])
    await expect(resolveSerial(adb, undefined, undefined)).rejects.toThrow('no device is ready')
  })

  it('ignores empty string param and falls through to config', async () => {
    const adb = makeFakeAdb([])
    const result = await resolveSerial(adb, '', 'config-serial')
    expect(result.serial).toBe('config-serial')
    expect(result.source).toBe('config')
  })

  it('ignores empty string config and falls through to auto', async () => {
    const adb = makeFakeAdb([{ serial: 'auto-device', state: 'device' }])
    const result = await resolveSerial(adb, undefined, '')
    expect(result.serial).toBe('auto-device')
    expect(result.source).toBe('auto')
  })
})

describe('parseWmSize', () => {
  it('parses physical size', () => {
    const result = parseWmSize('Physical size: 1080x2414\n')
    expect(result).toEqual({ width: 1080, height: 2414 })
  })

  it('prefers override size over physical size', () => {
    const result = parseWmSize('Physical size: 1240x2772\nOverride size: 1080x2414\n')
    expect(result).toEqual({ width: 1080, height: 2414 })
  })

  it('throws on unparseable output', () => {
    expect(() => parseWmSize('')).toThrow('could not parse')
    expect(() => parseWmSize('no size info here')).toThrow('could not parse')
  })
})
