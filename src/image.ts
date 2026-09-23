/**
 * image.ts — screenshot conditioning for model delivery.
 *
 * One pipeline produces the bytes the model actually sees: optional region
 * crop, optional magnification, a longest-side cap, and a compressed
 * encoding. Every stage reports the mapping between the delivered image and
 * the original screenshot pixels, because tap/swipe coordinates are always
 * expressed in original screenshot pixels (a 1:1 match with device pixels on
 * stock devices).
 *
 * @module @huanlin/dsh-plugin-android-use/src/image
 */

/** Output encodings this plugin can deliver to the attachment store. */
export type ImageFormat = 'jpeg' | 'webp' | 'png'

/** A crop window in original screenshot pixels. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** Options for {@link prepareImage}. */
export interface PrepareOptions {
  /** Longest-side cap of the delivered image, in output pixels. */
  maxDimension: number
  /** Encoding of the delivered image. */
  format: ImageFormat
  /** Encoder quality (1-100); ignored by `png`. */
  quality: number
  /** Crop window in original screenshot pixels. */
  region?: Region
  /** Explicit magnification for a region crop; `auto` fills {@link maxDimension} (clamped to 4). */
  magnify?: number | 'auto'
}

/** A prepared image plus the mapping back to original screenshot pixels. */
export interface PreparedImage {
  data: Uint8Array
  /** Delivered width in output pixels. */
  width: number
  /** Delivered height in output pixels. */
  height: number
  format: ImageFormat
  /** MIME type matching {@link format}. */
  mediaType: string
  /** Output pixels per original screenshot pixel (magnification folded in). */
  pixelsPerSource: number
  /** Crop origin in original screenshot pixels (0,0 when no region was given). */
  originX: number
  originY: number
  /** Magnification applied inside the crop. */
  magnify: number
  /** Width of the full screenshot in source pixels (before any crop). */
  sourceWidth: number
  /** Height of the full screenshot in source pixels (before any crop). */
  sourceHeight: number
}

/** MIME type for an output format. */
export function mediaTypeOf(format: ImageFormat): string {
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return 'image/jpeg'
}

/** File extension for an output format. */
export function extensionOf(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/**
 * Clamp a crop window into an image.
 * @param region - requested window in source pixels.
 * @param width - image width in source pixels.
 * @param height - image height in source pixels.
 * @returns the intersected window, or null when it is empty.
 */
export function clampRegion(region: Region, width: number, height: number): Region | null {
  if (region.x >= width || region.y >= height) return null
  if (region.x + region.width <= 0 || region.y + region.height <= 0) return null
  const x = Math.min(Math.max(0, Math.round(region.x)), Math.max(0, width - 1))
  const y = Math.min(Math.max(0, Math.round(region.y)), Math.max(0, height - 1))
  const w = Math.min(Math.max(1, Math.round(region.width)), width - x)
  const h = Math.min(Math.max(1, Math.round(region.height)), height - y)
  if (w < 1 || h < 1) return null
  return { x, y, width: w, height: h }
}

function encode(pipe: import('sharp').Sharp, format: ImageFormat, quality: number): import('sharp').Sharp {
  if (format === 'png') return pipe.png({ compressionLevel: 9 })
  if (format === 'webp') return pipe.webp({ quality })
  return pipe.jpeg({ quality, mozjpeg: true })
}

/**
 * Crop, magnify, cap, and encode one screenshot for the model.
 *
 * The returned {@link PreparedImage} carries `pixelsPerSource`, so callers
 * convert original screenshot coordinates into delivered-image coordinates
 * with `(value - origin) * pixelsPerSource`.
 *
 * @param data - the raw screenshot bytes from `screencap -p`.
 * @param options - crop, cap, and encoding options.
 * @returns the delivered bytes and their mapping to source pixels.
 */
export async function prepareImage(data: Uint8Array, options: PrepareOptions): Promise<PreparedImage> {
  const sharp = (await import('sharp')).default
  const source = sharp(data, { failOn: 'error', limitInputPixels: false })
  let meta
  try {
    meta = await source.metadata()
  } catch {
    throw new Error('screencap returned an image with no dimensions')
  }
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0
  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new Error('screencap returned an image with no dimensions')
  }

  let pipe = source
  let originX = 0
  let originY = 0
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  if (options.region !== undefined) {
    const clamped = clampRegion(options.region, sourceWidth, sourceHeight)
    if (clamped === null) {
      throw new Error(`region (${options.region.x},${options.region.y} ${options.region.width}x${options.region.height}) is outside the ${sourceWidth}x${sourceHeight} screenshot`)
    }
    pipe = pipe.extract({ left: clamped.x, top: clamped.y, width: clamped.width, height: clamped.height })
    originX = clamped.x
    originY = clamped.y
    cropWidth = clamped.width
    cropHeight = clamped.height
  }

  const requested = options.magnify ?? (options.region !== undefined ? 'auto' : 1)
  const wanted = requested === 'auto'
    ? Math.min(4, Math.max(1, options.maxDimension / Math.max(cropWidth, cropHeight)))
    : Math.max(1, Math.min(8, requested))
  // The size cap can shrink an ambitious request; report what was actually applied.
  const capScale = Math.min(1, options.maxDimension / Math.max(cropWidth * wanted, cropHeight * wanted))
  const appliedMagnify = wanted * capScale

  const targetWidth = Math.max(1, Math.round(cropWidth * appliedMagnify))
  const targetHeight = Math.max(1, Math.round(cropHeight * appliedMagnify))
  if (targetWidth !== cropWidth || targetHeight !== cropHeight) {
    pipe = pipe.resize({ width: targetWidth, height: targetHeight, fit: 'fill', kernel: 'lanczos3' })
  }

  const result = await encode(pipe, options.format, options.quality).toBuffer({ resolveWithObject: true })
  const width = result.info.width
  const height = result.info.height
  return {
    data: new Uint8Array(result.data),
    width,
    height,
    format: options.format,
    mediaType: mediaTypeOf(options.format),
    pixelsPerSource: width / cropWidth,
    originX,
    originY,
    // Magnify describes a region crop; a full-frame delivery is never "magnified".
    magnify: options.region === undefined ? 1 : Number(appliedMagnify.toFixed(3)),
    sourceWidth,
    sourceHeight,
  }
}

/**
 * Compute the uniform scale factor that fits a device resolution within
 * `maxDimension`; used to describe the delivered image size in tool output.
 *
 * @param deviceWidth - device width in pixels.
 * @param deviceHeight - device height in pixels.
 * @param maxDimension - longest-side cap.
 * @returns a value in (0, 1].
 */
export function computeScale(deviceWidth: number, deviceHeight: number, maxDimension: number): number {
  if (deviceWidth <= 0 || deviceHeight <= 0) return 1
  return Math.min(1, maxDimension / Math.max(deviceWidth, deviceHeight))
}

/** Fit an image within `maxDimension` without changing its encoding. */
export interface FittedImage {
  data: Uint8Array
  width: number
  height: number
  scaleX: number
  scaleY: number
}

/**
 * Downscale a PNG so its longest side fits within `maxDimension`, preserving
 * aspect ratio, and return the original bytes when already within the limit.
 *
 * @param data - the raw PNG bytes.
 * @param maxDimension - longest-side cap.
 * @returns the fitted bytes and their scale relative to the input.
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
