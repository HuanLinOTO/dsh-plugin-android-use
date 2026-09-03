/**
 * annotate.ts — overlay tap/swipe markers on a PNG screenshot using sharp.
 *
 * The annotated image is saved to the attachment store and rendered as the
 * tool-call result so the model (and the UI card) can see exactly where the
 * tap landed on the pre-tap screen.
 *
 * @module @huanlin/dsh-plugin-android-use/src/annotate
 */

/** Annotated image bytes and final dimensions. */
export interface AnnotatedImage {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Overlay a prominent tap marker on a PNG at device-native coordinates.
 *
 * The marker is a layered target: outer glow zone, white-bordered red ring,
 * solid center dot, and long crosshair arms — designed to be visible on any
 * background.
 *
 * @param png - the original PNG bytes (no scaling).
 * @param x - tap X in device pixels.
 * @param y - tap Y in device pixels.
 * @returns the annotated PNG bytes and dimensions.
 */
export async function annotateTap(png: Uint8Array, x: number, y: number): Promise<AnnotatedImage> {
  const sharp = (await import('sharp')).default
  let meta
  try {
    meta = await sharp(png).metadata()
  } catch {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }

  const minSide = Math.min(width, height)
  const r = Math.max(28, Math.round(minSide * 0.04))
  const ringW = Math.max(4, Math.round(r * 0.14))
  const lineW = Math.max(3, Math.round(r * 0.10))
  const armLen = r * 2.4
  const red = '#FF1744'
  const white = '#FFFFFF'

  const svg
    = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    // Outer glow zone — large semi-transparent filled circle
    + `<circle cx="${x}" cy="${y}" r="${Math.round(r * 2.2)}" fill="${red}" opacity="0.08"/>`
    // White border ring (for contrast on dark backgrounds)
    + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${white}" stroke-width="${ringW + 4}" opacity="0.45"/>`
    // Main red ring (thick)
    + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${red}" stroke-width="${ringW}" opacity="0.9"/>`
    // Inner white ring
    + `<circle cx="${x}" cy="${y}" r="${Math.round(r * 0.82)}" fill="none" stroke="${white}" stroke-width="2" opacity="0.5"/>`
    // Crosshair — white shadow first, then red on top
    + `<line x1="${Math.round(x - armLen)}" y1="${y}" x2="${Math.round(x + armLen)}" y2="${y}" stroke="${white}" stroke-width="${lineW + 3}" opacity="0.35"/>`
    + `<line x1="${x}" y1="${Math.round(y - armLen)}" x2="${x}" y2="${Math.round(y + armLen)}" stroke="${white}" stroke-width="${lineW + 3}" opacity="0.35"/>`
    + `<line x1="${Math.round(x - armLen)}" y1="${y}" x2="${Math.round(x + armLen)}" y2="${y}" stroke="${red}" stroke-width="${lineW}" opacity="0.8"/>`
    + `<line x1="${x}" y1="${Math.round(y - armLen)}" x2="${x}" y2="${Math.round(y + armLen)}" stroke="${red}" stroke-width="${lineW}" opacity="0.8"/>`
    // Center dot — white border + solid red fill
    + `<circle cx="${x}" cy="${y}" r="${Math.round(r * 0.24)}" fill="none" stroke="${white}" stroke-width="2" opacity="0.6"/>`
    + `<circle cx="${x}" cy="${y}" r="${Math.round(r * 0.24)}" fill="${red}" opacity="0.85"/>`
    + `</svg>`

  const buf = await sharp(png)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return { data: new Uint8Array(buf), width, height }
}

/**
 * Overlay a swipe path (line with start/end markers) on a PNG.
 *
 * @param png - the original PNG bytes.
 * @param x1 - start X in device pixels.
 * @param y1 - start Y.
 * @param x2 - end X.
 * @param y2 - end Y.
 * @returns the annotated PNG bytes and dimensions.
 */
export async function annotateSwipe(
  png: Uint8Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<AnnotatedImage> {
  const sharp = (await import('sharp')).default
  let meta
  try {
    meta = await sharp(png).metadata()
  } catch {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) {
    throw new Error('cannot annotate: screenshot has no dimensions')
  }

  const minSide = Math.min(width, height)
  const dotR = Math.max(14, Math.round(minSide * 0.02))
  const lineWidth = Math.max(5, Math.round(minSide * 0.008))
  const startColor = '#00E676'
  const endColor = '#FF1744'
  const lineColor = '#FFEB3B'
  const white = '#FFFFFF'

  const svg
    = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    // Line — white shadow first, then yellow on top
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${white}" stroke-width="${lineWidth + 4}" opacity="0.3" stroke-linecap="round"/>`
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${lineColor}" stroke-width="${lineWidth}" opacity="0.9" stroke-linecap="round"/>`
    // Start dot (green) with white border
    + `<circle cx="${x1}" cy="${y1}" r="${dotR + 2}" fill="none" stroke="${white}" stroke-width="2" opacity="0.5"/>`
    + `<circle cx="${x1}" cy="${y1}" r="${dotR}" fill="${startColor}" opacity="0.85"/>`
    // End dot (red) with white border
    + `<circle cx="${x2}" cy="${y2}" r="${dotR + 2}" fill="none" stroke="${white}" stroke-width="2" opacity="0.5"/>`
    + `<circle cx="${x2}" cy="${y2}" r="${dotR}" fill="${endColor}" opacity="0.85"/>`
    + `</svg>`

  const buf = await sharp(png)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return { data: new Uint8Array(buf), width, height }
}
