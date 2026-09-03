import { describe, it, expect } from 'vitest'
import { AdbClient, resolveSerial, parseDeviceList } from '../src/adb.js'
import { parseUiDumpXml } from '../src/xml.js'

const SMOKE = process.env.ADB_SMOKE_TEST === '1'
const describeSmoke = SMOKE ? describe : describe.skip

describeSmoke('real device smoke test', { timeout: 30000 }, () => {
  const adb = new AdbClient('adb')

  it('lists connected devices', async () => {
    const devices = await adb.devices()
    expect(devices.length).toBeGreaterThanOrEqual(1)
    const ready = devices.find(d => d.state === 'device')
    expect(ready).toBeDefined()
    console.log('devices:', JSON.stringify(devices, null, 2))
  })

  it('resolves serial and gets device info', async () => {
    const resolved = await resolveSerial(adb, undefined, undefined)
    expect(resolved.serial).toBeTruthy()
    console.log('resolved serial:', resolved)

    const batch = await adb.shell(resolved.serial,
      'echo "=SZ="; wm size; echo "=DN="; wm density; echo "=MD="; getprop ro.product.model; '
      + 'echo "=BR="; getprop ro.product.brand; echo "=VR="; getprop ro.build.version.release; '
      + 'echo "=SDK="; getprop ro.build.version.sdk; echo "=WK="; dumpsys power|grep mWakefulness')
    console.log('device_info batch:\n', batch)
    expect(batch).toContain('=SZ=')
    expect(batch).toContain('mWakefulness')
  })

  it('dumps and parses the UI tree', async () => {
    const { serial } = await resolveSerial(adb, undefined, undefined)
    const dumpPath = `/sdcard/dsh_smoke_${Date.now()}.xml`
    await adb.shell(serial, `uiautomator dump ${dumpPath}`)
    const xml = await adb.execOut(serial, `cat ${dumpPath}`)
    expect(xml).toContain('<hierarchy')
    const dump = parseUiDumpXml(xml)
    expect(dump.nodes.length).toBeGreaterThan(0)
    expect(dump.screen_width).toBeGreaterThan(0)
    expect(dump.screen_height).toBeGreaterThan(0)
    console.log(`ui_dump: ${dump.nodes.length} nodes, screen ${dump.screen_width}x${dump.screen_height}, rotation ${dump.rotation}`)
    const interactive = dump.nodes.filter(n => n.text !== '' || n.content_desc !== '' || n.clickable || n.scrollable)
    console.log(`interactive/text nodes: ${interactive.length}`)
    for (const n of interactive.slice(0, 8)) {
      const parts = []
      if (n.text) parts.push(`text=${JSON.stringify(n.text)}`)
      if (n.content_desc) parts.push(`desc=${JSON.stringify(n.content_desc)}`)
      if (n.center) parts.push(`center=(${n.center.x},${n.center.y})`)
      if (n.clickable) parts.push('clickable')
      console.log(`  ${parts.join(' | ')}`)
    }
  })
})
