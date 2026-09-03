/**
 * xml.ts — zero-dependency uiautomator dump XML parser.
 *
 * uiautomator produces a flat `<hierarchy rotation="N">` document whose
 * `<node>` children carry accessibility-tree attributes. This parser walks
 * the tag stream once, extracting the attributes the model needs to
 * understand the screen and target taps/swipes.
 *
 * No DOM dependency: the parser scans the raw string for `<node` tags and
 * reads attributes by name, so it works on Node without `--experimental-*`
 * flags and stays bundle-friendly.
 *
 * @module @huanlin/dsh-plugin-android-use/src/xml
 */

/** Parsed `[left,top][right,bottom]` bounds. */
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** One accessibility node extracted from the dump. */
export interface UiNode {
  text: string
  content_desc: string
  resource_id: string
  class: string
  package: string
  bounds: Bounds | null
  /** Center point of the bounds, or null when bounds are absent/malformed. */
  center: { x: number; y: number } | null
  clickable: boolean
  long_clickable: boolean
  focusable: boolean
  scrollable: boolean
  enabled: boolean
  password: boolean
  selected: boolean
  checked: boolean
  /** Depth in the tree (root hierarchy child = 0). */
  depth: number
}

/** Complete parsed uiautomator dump. */
export interface UiDump {
  rotation: number
  screen_width: number
  screen_height: number
  nodes: UiNode[]
}

/**
 * Parse a `[left,top][right,bottom]` bounds string.
 * @param raw - the attribute value, e.g. `"[0,0][1080,2414]"`.
 * @returns the numeric bounds, or null when the string does not match.
 */
export function parseBounds(raw: string): Bounds | null {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(raw)
  if (match === null) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

/** Compute the center of a bounds rect. */
export function centerOfBounds(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.floor((bounds.left + bounds.right) / 2),
    y: Math.floor((bounds.top + bounds.bottom) / 2),
  }
}

/** Decode the five XML entity references uiautomator emits. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * Extract one attribute value from a `<node ...>` tag string.
 * @param tag - the raw `<node ...` text up to the closing `>` or `/>`.
 * @param name - the attribute name without quotes.
 * @returns the decoded value, or empty string when absent.
 */
function attrValue(tag: string, name: string): string {
  const pattern = new RegExp(`${name}="((?:[^"&]|&(?:amp|lt|gt|quot|apos);)*)"`, 'u')
  const match = pattern.exec(tag)
  if (match === null) return ''
  return decodeEntities(match[1]!)
}

/** Parse a boolean attribute: `"true"` → true, everything else → false. */
function boolAttr(tag: string, name: string): boolean {
  return attrValue(tag, name) === 'true'
}

/**
 * One scanned tag: opening, self-closing, or closing `<node>`.
 */
interface ScannedTag {
  /** The raw tag text (for attribute extraction on opening/self-closing). */
  raw: string
  /** True for `</node>` closing tags (no attributes, no node emitted). */
  closing: boolean
  /** True for `<node .../>` self-closing tags (node emitted, no depth change). */
  selfClosing: boolean
}

/**
 * Scan the XML for all `<node>` opening, self-closing, and closing tags in
 * document order. Closing tags are tracked so depth stays accurate.
 */
const TAG_PATTERN = /<(\/?)node\b([^>]*?)(\/?)>/gu

function scanTags(xml: string): ScannedTag[] {
  const tags: ScannedTag[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(TAG_PATTERN)
  while ((match = pattern.exec(xml)) !== null) {
    const closing = match[1] === '/'
    const selfClosing = !closing && match[3] === '/'
    tags.push({
      raw: match[0],
      closing,
      selfClosing,
    })
  }
  return tags
}

/**
 * Parse a uiautomator dump XML into a flat node list with screen metadata.
 *
 * The root `<hierarchy rotation="N">` element carries the rotation; the
 * screen dimensions are read from the first (root) node's bounds, which
 * uiautomator always emits as the full display rectangle.
 *
 * Closing `</node>` tags are tracked so `depth` accurately reflects the tree
 * nesting level (root node = depth 0, its children = depth 1, etc.).
 *
 * @param xml - the raw XML string from `uiautomator dump` + `cat`.
 * @returns the parsed dump. Empty/malformed XML yields zero nodes and
 *   zero dimensions rather than throwing (the model still gets a result).
 */
export function parseUiDumpXml(xml: string): UiDump {
  const rotationMatch = /rotation="(-?\d+)"/.exec(xml)
  const rotation = rotationMatch !== null ? Number(rotationMatch[1]) : 0

  const tags = scanTags(xml)
  const nodes: UiNode[] = []
  let depth = 0
  let screenWidth = 0
  let screenHeight = 0
  let isFirstNode = true

  for (const tag of tags) {
    if (tag.closing) {
      if (depth > 0) depth -= 1
      continue
    }
    const raw = tag.raw
    const boundsRaw = attrValue(raw, 'bounds')
    const bounds = boundsRaw !== '' ? parseBounds(boundsRaw) : null

    if (isFirstNode && bounds !== null) {
      screenWidth = bounds.right
      screenHeight = bounds.bottom
      isFirstNode = false
    }

    const node: UiNode = {
      text: attrValue(raw, 'text'),
      content_desc: attrValue(raw, 'content-desc'),
      resource_id: attrValue(raw, 'resource-id'),
      class: attrValue(raw, 'class'),
      package: attrValue(raw, 'package'),
      bounds,
      center: bounds !== null ? centerOfBounds(bounds) : null,
      clickable: boolAttr(raw, 'clickable'),
      long_clickable: boolAttr(raw, 'long-clickable'),
      focusable: boolAttr(raw, 'focusable'),
      scrollable: boolAttr(raw, 'scrollable'),
      enabled: boolAttr(raw, 'enabled'),
      password: boolAttr(raw, 'password'),
      selected: boolAttr(raw, 'selected'),
      checked: boolAttr(raw, 'checked'),
      depth,
    }
    nodes.push(node)

    if (!tag.selfClosing) depth += 1
  }

  return {
    rotation,
    screen_width: screenWidth,
    screen_height: screenHeight,
    nodes,
  }
}
