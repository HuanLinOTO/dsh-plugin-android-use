import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseUiDumpXml, parseBounds, centerOfBounds } from '../src/xml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(__dirname, 'fixtures/launcher_dump.xml'), 'utf8')

describe('parseBounds', () => {
  it('parses valid bounds', () => {
    expect(parseBounds('[0,0][1080,2414]')).toEqual({ left: 0, top: 0, right: 1080, bottom: 2414 })
    expect(parseBounds('[100,200][300,400]')).toEqual({ left: 100, top: 200, right: 300, bottom: 400 })
  })

  it('returns null for malformed input', () => {
    expect(parseBounds('')).toBeNull()
    expect(parseBounds('invalid')).toBeNull()
    expect(parseBounds('[0,0]')).toBeNull()
  })
})

describe('centerOfBounds', () => {
  it('computes center', () => {
    expect(centerOfBounds({ left: 0, top: 0, right: 1080, bottom: 2414 })).toEqual({ x: 540, y: 1207 })
  })
})

describe('parseUiDumpXml with real launcher fixture', () => {
  const dump = parseUiDumpXml(fixture)

  it('parses the correct rotation', () => {
    expect(dump.rotation).toBe(0)
  })

  it('extracts screen dimensions from the root node', () => {
    expect(dump.screen_width).toBe(1080)
    expect(dump.screen_height).toBe(2414)
  })

  it('parses all nodes (44 in the fixture)', () => {
    expect(dump.nodes.length).toBe(44)
  })

  it('the root node is a FrameLayout with full-screen bounds', () => {
    const root = dump.nodes[0]!
    expect(root.class).toBe('android.widget.FrameLayout')
    expect(root.bounds).toEqual({ left: 0, top: 0, right: 1080, bottom: 2414 })
    expect(root.center).toEqual({ x: 540, y: 1207 })
  })

  it('the root node has depth 0', () => {
    expect(dump.nodes[0]!.depth).toBe(0)
  })

  it('child nodes have depth > 0', () => {
    const depthOne = dump.nodes.filter(n => n.depth === 1)
    expect(depthOne.length).toBeGreaterThan(0)
  })

  it('depth values are monotonically consistent (never exceed node count)', () => {
    for (const node of dump.nodes) {
      expect(node.depth).toBeGreaterThanOrEqual(0)
      expect(node.depth).toBeLessThan(dump.nodes.length)
    }
  })

  it('finds at least some clickable nodes', () => {
    const clickable = dump.nodes.filter(n => n.clickable)
    expect(clickable.length).toBeGreaterThan(0)
  })

  it('finds at least some nodes with text', () => {
    const withText = dump.nodes.filter(n => n.text !== '')
    expect(withText.length).toBeGreaterThan(0)
  })

  it('all nodes have a class attribute', () => {
    for (const node of dump.nodes) {
      expect(node.class).not.toBe('')
    }
  })

  it('all nodes have a package attribute', () => {
    for (const node of dump.nodes) {
      expect(node.package).toBe('com.android.launcher')
    }
  })

  it('center coordinates are within screen bounds', () => {
    for (const node of dump.nodes) {
      if (node.center !== null) {
        expect(node.center.x).toBeGreaterThanOrEqual(0)
        expect(node.center.x).toBeLessThanOrEqual(dump.screen_width)
        expect(node.center.y).toBeGreaterThanOrEqual(0)
        expect(node.center.y).toBeLessThanOrEqual(dump.screen_height)
      }
    }
  })
})

describe('parseUiDumpXml edge cases', () => {
  it('returns empty nodes for empty string', () => {
    const dump = parseUiDumpXml('')
    expect(dump.nodes).toEqual([])
    expect(dump.screen_width).toBe(0)
    expect(dump.screen_height).toBe(0)
    expect(dump.rotation).toBe(0)
  })

  it('returns empty nodes for malformed XML', () => {
    const dump = parseUiDumpXml('not xml at all')
    expect(dump.nodes).toEqual([])
  })

  it('handles a minimal single-node dump', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="90"><node text="Hello" resource-id="id/test" class="android.widget.TextView" package="com.test" content-desc="" clickable="true" enabled="true" bounds="[10,20][100,200]" /></hierarchy>`
    const dump = parseUiDumpXml(xml)
    expect(dump.rotation).toBe(90)
    expect(dump.screen_width).toBe(100)
    expect(dump.screen_height).toBe(200)
    expect(dump.nodes).toHaveLength(1)
    expect(dump.nodes[0]!.text).toBe('Hello')
    expect(dump.nodes[0]!.resource_id).toBe('id/test')
    expect(dump.nodes[0]!.clickable).toBe(true)
    expect(dump.nodes[0]!.center).toEqual({ x: 55, y: 110 })
    expect(dump.nodes[0]!.depth).toBe(0)
  })

  it('tracks depth correctly for nested non-self-closing nodes', () => {
    const xml = `<hierarchy rotation="0"><node text="" class="A" bounds="[0,0][100,100]"><node text="" class="B" bounds="[0,0][50,50]"><node text="leaf" class="C" bounds="[0,0][10,10]" /></node></node></hierarchy>`
    const dump = parseUiDumpXml(xml)
    expect(dump.nodes).toHaveLength(3)
    expect(dump.nodes[0]!.depth).toBe(0)
    expect(dump.nodes[1]!.depth).toBe(1)
    expect(dump.nodes[2]!.depth).toBe(2)
  })

  it('decodes XML entities in text attributes', () => {
    const xml = `<hierarchy rotation="0"><node text="a&amp;b&lt;c&gt;d&quot;e&apos;f" class="T" bounds="[0,0][1,1]" /></hierarchy>`
    const dump = parseUiDumpXml(xml)
    expect(dump.nodes[0]!.text).toBe('a&b<c>d"e\'f')
  })

  it('handles nodes without bounds', () => {
    const xml = `<hierarchy rotation="0"><node text="no bounds" class="T" /></hierarchy>`
    const dump = parseUiDumpXml(xml)
    expect(dump.nodes).toHaveLength(1)
    expect(dump.nodes[0]!.bounds).toBeNull()
    expect(dump.nodes[0]!.center).toBeNull()
    expect(dump.screen_width).toBe(0)
    expect(dump.screen_height).toBe(0)
  })
})
