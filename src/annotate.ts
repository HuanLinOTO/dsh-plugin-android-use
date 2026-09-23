/**
 * annotate.ts — overlay a coordinate grid and action markers on a screenshot.
 *
 * The grid turns the delivered image into a ruler: labels carry original
 * screenshot pixels, which are the coordinate space android_tap, android_swipe,
 * and android_screenshot(region) accept. A model that reads a label can pass
 * that number straight back.
 *
 * @module @huanlin/dsh-plugin-android-use/src/annotate
 */

import { mediaTypeOf, type ImageFormat } from './image.js'

/** Grid geometry, expressed against the original screenshot. */
export interface GridSpec {
  /** Distance between main grid lines, in original screenshot pixels. */
  step: number
  /** Original-screenshot X of delivered-image pixel 0. */
  originX: number
  /** Original-screenshot Y of delivered-image pixel 0. */
  originY: number
  /** Delivered pixels per original screenshot pixel. */
  pixelsPerSource: number
}

/** A point in original screenshot coordinates. */
export interface Point {
  x: number
  y: number
}

/** A swipe path in original screenshot coordinates. */
export interface SwipePath {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Everything to draw on one delivered frame. */
export interface OverlaySpec {
  format: ImageFormat
  quality: number
  grid?: GridSpec
  tap?: Point
  swipe?: SwipePath
  /** One-line context drawn on a bar at the bottom (already formatted). */
  note?: string
}

/** Composited bytes and their output dimensions. */
export interface OverlayResult {
  data: Uint8Array
  width: number
  height: number
}

const GRID_COLOR = '#22D3EE'
const TAP_COLOR = '#FF1744'
const SWIPE_COLOR = '#2979FF'
const START_COLOR = '#00E676'
const WHITE = '#FFFFFF'
const MONO = 'Consolas,Menlo,DejaVu Sans Mono,monospace'

/**
 * Choose the smallest tidy grid step whose lines stay readable on the
 * delivered image (at least about 96 output pixels apart, at most 8 lines).
 *
 * @param outputWidth - delivered width in pixels.
 * @param outputHeight - delivered height in pixels.
 * @param pixelsPerSource - delivered pixels per original screenshot pixel.
 * @returns the step in original screenshot pixels.
 */
export function chooseGridStep(outputWidth: number, outputHeight: number, pixelsPerSource: number): number {
  const candidates = [50, 100, 200, 250, 500, 1000, 2000]
  const longest = Math.max(outputWidth, outputHeight) / Math.max(pixelsPerSource, 1e-6)
  for (const candidate of candidates) {
    if (candidate * pixelsPerSource >= 96 && longest / candidate <= 8) return candidate
  }
  return candidates[candidates.length - 1]!
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** Text with a dark outline so it stays legible over any screenshot content. */
function text(x: number, y: number, value: string, fontSize: number, anchor: 'start' | 'middle' | 'end'): string {
  return `<text x='${Math.round(x)}' y='${Math.round(y)}' font-family='${MONO}' font-size='${fontSize}' font-weight='600' fill='${WHITE}' stroke='#000000' stroke-width='3' paint-order='stroke' stroke-linejoin='round' text-anchor='${anchor}'>${value}</text>`
}

/**
 * Coordinate label drawn on a translucent plate, so a label never blends into
 * app content it happens to sit on.
 */
function badge(x: number, y: number, value: string, fontSize: number, anchor: 'start' | 'end'): string {
  const plateWidth = value.length * fontSize * 0.62 + 8
  const plateHeight = Math.round(fontSize * 1.3)
  const left = anchor === 'end' ? x - plateWidth : x
  return `<rect x='${Math.round(left)}' y='${Math.round(y - fontSize)}' width='${Math.round(plateWidth)}' height='${plateHeight}' rx='4' fill='#000000' opacity='0.55'/>`
    + text(anchor === 'end' ? x - 4 : x + 4, y, value, fontSize, anchor)
}

/** Grid lines, edge ticks, and coordinate labels (labels carry source pixels). */
function gridSvg(grid: GridSpec, width: number, height: number, fontSize: number): string {
  const pps = grid.pixelsPerSource
  if (!(pps > 0) || grid.step <= 0) return ''
  const minSpacing = fontSize * 3.2
  const parts: string[] = []
  const endX = grid.originX + width / pps
  const endY = grid.originY + height / pps
  const tick = Math.round(fontSize * 0.55)
  let lastX = -Infinity
  for (let value = Math.ceil(grid.originX / grid.step) * grid.step; value <= endX; value += grid.step) {
    const x = (value - grid.originX) * pps
    if (x < 1 || x > width - 1) continue
    parts.push(`<line x1='${x.toFixed(1)}' y1='0' x2='${x.toFixed(1)}' y2='${height}' stroke='${GRID_COLOR}' stroke-width='1' opacity='0.26'/>`)
    parts.push(`<line x1='${x.toFixed(1)}' y1='0' x2='${x.toFixed(1)}' y2='${tick}' stroke='${GRID_COLOR}' stroke-width='3' opacity='0.75'/>`)
    parts.push(`<line x1='${x.toFixed(1)}' y1='${height}' x2='${x.toFixed(1)}' y2='${height - tick}' stroke='${GRID_COLOR}' stroke-width='2' opacity='0.5'/>`)
    if (lastX === -Infinity || x - lastX >= minSpacing) {
      const anchor: 'start' | 'end' = x > width - fontSize * 3 ? 'end' : 'start'
      parts.push(badge(anchor === 'end' ? x - 3 : x + 3, fontSize + 2, String(value), fontSize, anchor))
      lastX = x
    }
  }
  let lastY = -Infinity
  for (let value = Math.ceil(grid.originY / grid.step) * grid.step; value <= endY; value += grid.step) {
    const y = (value - grid.originY) * pps
    if (y < 1 || y > height - 1) continue
    parts.push(`<line x1='0' y1='${y.toFixed(1)}' x2='${width}' y2='${y.toFixed(1)}' stroke='${GRID_COLOR}' stroke-width='1' opacity='0.26'/>`)
    parts.push(`<line x1='0' y1='${y.toFixed(1)}' x2='${tick}' y2='${y.toFixed(1)}' stroke='${GRID_COLOR}' stroke-width='3' opacity='0.75'/>`)
    parts.push(`<line x1='${width}' y1='${y.toFixed(1)}' x2='${width - tick}' y2='${y.toFixed(1)}' stroke='${GRID_COLOR}' stroke-width='2' opacity='0.5'/>`)
    if (lastY === -Infinity || y - lastY >= minSpacing) {
      parts.push(badge(width - 3, y + fontSize, String(value), fontSize, 'end'))
      lastY = y
    }
  }
  return parts.join('')
}

/** Crosshair-and-ring marker for one tap point, in output pixels. */
function tapSvg(x: number, y: number, minSide: number): string {
  const r = Math.max(16, Math.round(minSide * 0.035))
  const ringW = Math.max(3, Math.round(r * 0.16))
  const lineW = Math.max(2, Math.round(r * 0.12))
  const armLen = Math.round(r * 2.2)
  return `<circle cx='${x}' cy='${y}' r='${Math.round(r * 2.2)}' fill='${TAP_COLOR}' opacity='0.08'/>`
    + `<circle cx='${x}' cy='${y}' r='${r}' fill='none' stroke='${WHITE}' stroke-width='${ringW + 4}' opacity='0.45'/>`
    + `<circle cx='${x}' cy='${y}' r='${r}' fill='none' stroke='${TAP_COLOR}' stroke-width='${ringW}' opacity='0.9'/>`
    + `<line x1='${x - armLen}' y1='${y}' x2='${x + armLen}' y2='${y}' stroke='${WHITE}' stroke-width='${lineW + 3}' opacity='0.35'/>`
    + `<line x1='${x}' y1='${y - armLen}' x2='${x}' y2='${y + armLen}' stroke='${WHITE}' stroke-width='${lineW + 3}' opacity='0.35'/>`
    + `<line x1='${x - armLen}' y1='${y}' x2='${x + armLen}' y2='${y}' stroke='${TAP_COLOR}' stroke-width='${lineW}' opacity='0.85'/>`
    + `<line x1='${x}' y1='${y - armLen}' x2='${x}' y2='${y + armLen}' stroke='${TAP_COLOR}' stroke-width='${lineW}' opacity='0.85'/>`
    + `<circle cx='${x}' cy='${y}' r='${Math.round(r * 0.22)}' fill='${TAP_COLOR}' opacity='0.9'/>`
}

/** Line with start/end dots for a swipe, in output pixels. */
function swipeSvg(path: { x1: number; y1: number; x2: number; y2: number }, minSide: number): string {
  const dotR = Math.max(9, Math.round(minSide * 0.018))
  const lineW = Math.max(3, Math.round(minSide * 0.007))
  return `<line x1='${path.x1}' y1='${path.y1}' x2='${path.x2}' y2='${path.y2}' stroke='${WHITE}' stroke-width='${lineW + 4}' opacity='0.4'/>`
    + `<line x1='${path.x1}' y1='${path.y1}' x2='${path.x2}' y2='${path.y2}' stroke='${SWIPE_COLOR}' stroke-width='${lineW}' opacity='0.9'/>`
    + `<circle cx='${path.x1}' cy='${path.y1}' r='${dotR}' fill='${START_COLOR}' opacity='0.9'/>`
    + `<circle cx='${path.x2}' cy='${path.y2}' r='${dotR}' fill='${TAP_COLOR}' opacity='0.9'/>`
}

/** Bottom bar carrying the frame context line. */
function noteSvg(note: string, width: number, height: number, fontSize: number): string {
  const barHeight = Math.round(fontSize * 1.9)
  const y = height - barHeight
  return `<rect x='0' y='${y}' width='${width}' height='${barHeight}' fill='#000000' opacity='0.58'/>`
    + `<text x='8' y='${height - Math.round(barHeight * 0.3)}' font-family='${MONO}' font-size='${fontSize}' fill='${WHITE}'>${note}</text>`
}

/** Marker offset that keeps the tap label clear of the crosshair arms. */
function tapLabelOffset(minSide: number): number {
  return Math.max(18, Math.round(minSide * 0.05))
}

/**
 * Composite the grid, markers, and note onto an encoded image.
 *
 * Marker coordinates are original screenshot pixels; the grid mapping
 * converts them into delivered-image pixels.
 *
 * @param image - the prepared (cropped/scaled/encoded) image bytes.
 * @param spec - grid, markers, and encoding options.
 * @returns the composited bytes and dimensions.
 */
export async function composeOverlay(image: Uint8Array, spec: OverlaySpec): Promise<OverlayResult> {
  const sharp = (await import('sharp')).default
  let meta
  try {
    meta = await sharp(image).metadata()
  } catch {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }

  const fontSize = clamp(Math.round(Math.min(width, height) / 26), 12, 24)
  const minSide = Math.min(width, height)
  const pps = spec.grid?.pixelsPerSource ?? 1
  const originX = spec.grid?.originX ?? 0
  const originY = spec.grid?.originY ?? 0
  const layers: string[] = []

  if (spec.grid !== undefined) layers.push(gridSvg(spec.grid, width, height, fontSize))

  if (spec.swipe !== undefined) {
    layers.push(swipeSvg({
      x1: (spec.swipe.x1 - originX) * pps,
      y1: (spec.swipe.y1 - originY) * pps,
      x2: (spec.swipe.x2 - originX) * pps,
      y2: (spec.swipe.y2 - originY) * pps,
    }, minSide))
  }

  if (spec.tap !== undefined) {
    const x = clamp(Math.round((spec.tap.x - originX) * pps), 0, width)
    const y = clamp(Math.round((spec.tap.y - originY) * pps), 0, height)
    layers.push(tapSvg(x, y, minSide))
    const offset = tapLabelOffset(minSide)
    const anchor: 'start' | 'end' = x > width - 170 ? 'end' : 'start'
    const labelX = anchor === 'end' ? x - offset : Math.min(x + offset, width - 4)
    layers.push(badge(labelX, Math.max(y - Math.round(offset * 0.6), fontSize + 2), `(${spec.tap.x}, ${spec.tap.y})`, fontSize, anchor))
  }

  if (spec.note !== undefined && spec.note !== '') layers.push(noteSvg(spec.note, width, height, fontSize))

  const svg = `<svg width='${width}' height='${height}' xmlns='http://www.w3.org/2000/svg'>${layers.join('')}</svg>`
  const pipe = sharp(image).composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  const encoded = spec.format === 'png'
    ? pipe.png({ compressionLevel: 9 })
    : spec.format === 'webp'
      ? pipe.webp({ quality: spec.quality })
      : pipe.jpeg({ quality: spec.quality, mozjpeg: true })
  const result = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(result.data), width: result.info.width, height: result.info.height }
}

/** Media type of the composited output, for the attachment store call. */
export function overlayMediaType(format: ImageFormat): string {
  return mediaTypeOf(format)
}
