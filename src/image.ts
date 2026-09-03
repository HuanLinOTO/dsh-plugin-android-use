/**
 * image.ts — fit a PNG within the attachment store's per-side pixel limit.
 *
 * The attachment store enforces `maxImageDimension` (2000px by default).
 * This module downscales only when necessary, returning a scale factor so
 * callers can map device-native coordinates to image space for annotation.
 *
 * @module @huanlin/dsh-plugin-android-use/src/image
 */

/**
 * Compute the uniform scale factor applied when a screenshot of the given
 * device resolution is fit within `maxDimension`.
 *
 * The scale is uniform (same for X and Y) because `fitToMaxDimension` uses
 * `fit: 'inside'` which preserves aspect ratio.
 *
 * @returns a value in (0, 1]. Returns 1 when no scaling is needed.
 */
export function computeScale(deviceWidth: number, deviceHeight: number, maxDimension: number): number {
  if (deviceWidth <= 0 || deviceHeight <= 0) return 1
  return Math.min(1, maxDimension / Math.max(deviceWidth, deviceHeight))
}

/** Outcome of {@link fitToMaxDimension}. */
export interface FittedImage {
  data: Uint8Array
  width: number
  height: number
  /** Multiply device X by this to get image-space X (1 when no scaling). */
  scaleX: number
  /** Multiply device Y by this to get image-space Y (1 when no scaling). */
  scaleY: number
}

/**
 * Downscale a PNG so its longest side fits within `maxDimension`, preserving
 * aspect ratio. Returns the original bytes unchanged when already within the
 * limit. Uses `sharp` for the resize.
 *
 * @param data - the raw PNG bytes from `screencap -p`.
 * @param maxDimension - the attachment store's per-side pixel limit.
 */
export async function fitToMaxDimension(data: Uint8Array, maxDimension: number): Promise<FittedImage> {
  const sharp = (await import('sharp')).default
  let meta
  try {
    meta = await sharp(data).metadata()
  } catch {
    throw new Error('screencap returned an image with no dimensions')
  }
  const origW = meta.width ?? 0
  const origH = meta.height ?? 0
  if (origW === 0 || origH === 0) {
    throw new Error('screencap returned an image with no dimensions')
  }
  if (Math.max(origW, origH) <= maxDimension) {
    return { data, width: origW, height: origH, scaleX: 1, scaleY: 1 }
  }
  const result = await sharp(data, { failOn: 'error', limitInputPixels: false })
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  return {
    data: new Uint8Array(result.data),
    width: result.info.width,
    height: result.info.height,
    scaleX: result.info.width / origW,
    scaleY: result.info.height / origH,
  }
}
