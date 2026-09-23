/**
 * frame.ts — the screenshot pipeline shared by every frame-delivering tool.
 *
 * One call captures the device screen, crops/magnifies it, burns in the
 * coordinate grid and any action markers, retains a copy under the capture
 * directory, and publishes the frame to the attachment store. Coordinates
 * everywhere in this module are original screenshot pixels, which match
 * device pixels on a stock device.
 *
 * @module @huanlin/dsh-plugin-android-use/src/frame
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { chooseGridStep, composeOverlay, type Point, type SwipePath } from './annotate.js'
import { pruneCaptures, saveCapture } from './capture.js'
import { extensionOf, mediaTypeOf, prepareImage, type Region } from './image.js'
import type { ToolDeps } from './registry.js'

/** Delivered frame metadata, mirroring what a tool result reports. */
export interface Frame {
  serial: string
  /** Delivered image size in pixels (what the model sees). */
  width: number
  height: number
  bytes: number
  mediaType: string
  /** Full device screenshot size in pixels (the coordinate space). */
  deviceWidth: number
  deviceHeight: number
  /** Delivered pixels per screenshot pixel. */
  scale: number
  /** Attachment-store reference, or null when no store is mounted. */
  image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number } | null
  /** Retained copy on disk, or null when the write failed. */
  savedPath: string | null
  /** Screenshot pixel of delivered-image pixel 0. */
  originX: number
  originY: number
  /** Magnification applied inside a region crop (1 for a full frame). */
  magnify: number
  /** Grid step in screenshot pixels; null when the grid is disabled. */
  gridStep: number | null
  /** Context line burned into the frame, when one was supplied. */
  note: string | null
}

/** Inputs of {@link captureFrame}. */
export interface FrameOptions {
  serial: string
  /** Capture label used in the retained file name, e.g. shot or pre-tap. */
  kind: string
  /** Crop window in screenshot pixels. */
  region?: Region
  /** Explicit magnification, or auto to fill the size cap (clamped to x4). */
  magnify?: number | 'auto'
  /** Tap marker in screenshot pixels. */
  tap?: Point
  /** Swipe path in screenshot pixels. */
  swipe?: SwipePath
  /** Context line drawn on the bottom bar. */
  note?: string
  signal?: AbortSignal
}

/**
 * Capture, condition, annotate, retain, and publish one frame.
 *
 * @param ctx - plugin context, used for the optional attachment store.
 * @param deps - adb client and live config.
 * @param options - capture, crop, and annotation inputs.
 * @returns the frame metadata reported by the calling tool.
 */
export async function captureFrame(ctx: Context, deps: ToolDeps, options: FrameOptions): Promise<Frame> {
  const config = deps.getConfig()
  const raw = await deps.adb.execOutBinary(options.serial, 'screencap -p', options.signal)
  const prepared = await prepareImage(new Uint8Array(raw), {
    maxDimension: config.imageMaxDimension,
    format: config.imageFormat,
    quality: config.imageQuality,
    region: options.region,
    magnify: options.magnify,
  })

  const gridStep = config.showGrid ? chooseGridStep(prepared.width, prepared.height, prepared.pixelsPerSource) : null
  const composed = await composeOverlay(prepared.data, {
    format: config.imageFormat,
    quality: config.imageQuality,
    grid: gridStep === null
      ? undefined
      : {
        step: gridStep,
        originX: prepared.originX,
        originY: prepared.originY,
        pixelsPerSource: prepared.pixelsPerSource,
      },
    tap: options.tap,
    swipe: options.swipe,
    note: options.note,
  })

  const extension = extensionOf(config.imageFormat)
  const saved = await saveCapture(config.captureDir, options.kind, composed.data, extension)
  if (saved !== null) await pruneCaptures(config.captureDir, config.captureKeep)

  const attachments = ctx.get('attachments') as import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
  let image: Frame['image'] = null
  if (attachments !== undefined) {
    const ref = await attachments.saveImage({
      data: composed.data,
      mediaType: mediaTypeOf(config.imageFormat) as ImageAttachmentRef['mediaType'],
      name: `${options.kind}.${extension}`,
    })
    image = {
      attachmentId: ref.attachmentId as unknown as string,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
    }
  }

  const width = image?.width ?? composed.width
  const height = image?.height ?? composed.height
  return {
    serial: options.serial,
    width,
    height,
    bytes: image?.bytes ?? composed.data.byteLength,
    mediaType: image?.mediaType ?? mediaTypeOf(config.imageFormat),
    deviceWidth: prepared.sourceWidth,
    deviceHeight: prepared.sourceHeight,
    scale: width / prepared.sourceWidth,
    image,
    savedPath: saved?.path ?? null,
    originX: prepared.originX,
    originY: prepared.originY,
    magnify: prepared.magnify,
    gridStep,
    note: options.note ?? null,
  }
}
