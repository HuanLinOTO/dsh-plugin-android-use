import { describe, it, expect } from 'vitest'
import { chooseGridStep, composeOverlay } from '../src/annotate.js'
import sharp from 'sharp'

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('chooseGridStep', () => {
  it('keeps grid lines at least about 96 output pixels apart', () => {
    const pixelsPerSource = 573 / 1080
    const step = chooseGridStep(573, 1280, pixelsPerSource)
    expect(step * pixelsPerSource).toBeGreaterThanOrEqual(96)
  })

  it('never draws more than eight lines on the longest axis', () => {
    const pixelsPerSource = 573 / 1080
    const step = chooseGridStep(573, 1280, pixelsPerSource)
    expect(2414 / step).toBeLessThanOrEqual(8)
  })

  it('coarsens the step for a hard-downscaled delivery', () => {
    expect(chooseGridStep(179, 400, 400 / 2414)).toBe(1000)
  })
})

describe('composeOverlay', () => {
  it('keeps the delivered dimensions', async () => {
    const png = await makePng(400, 800)
    const result = await composeOverlay(png, {
      format: 'png',
      quality: 80,
      grid: { step: 100, originX: 0, originY: 0, pixelsPerSource: 1 },
    })
    expect(result.width).toBe(400)
    expect(result.height).toBe(800)
  })

  it('draws grid lines over the frame', async () => {
    const png = await makePng(400, 800)
    const plain = await composeOverlay(png, { format: 'png', quality: 80 })
    const gridded = await composeOverlay(png, {
      format: 'png',
      quality: 80,
      grid: { step: 100, originX: 0, originY: 0, pixelsPerSource: 1 },
    })
    const plainStats = await sharp(plain.data).stats()
    const gridStats = await sharp(gridded.data).stats()
    // Cyan grid lines raise the green channel over a red background.
    expect(gridStats.channels[1]!.mean).toBeGreaterThan(plainStats.channels[1]!.mean)
    expect(gridded.data.byteLength).not.toBe(plain.data.byteLength)
  })

  it('maps a tap marker from source pixels into delivered pixels', async () => {
    const png = await makePng(400, 800)
    const marker = await composeOverlay(png, {
      format: 'png',
      quality: 80,
      grid: { step: 100, originX: 100, originY: 200, pixelsPerSource: 0.5 },
      tap: { x: 200, y: 400 },
      note: 'tap (200, 400)',
    })
    const blocks = await sharp(marker.data).stats()
    expect(blocks.channels[0]!.mean).toBeGreaterThan(0)
    expect(marker.width).toBe(400)
  })

  it('accepts a tap that lies outside the crop without throwing', async () => {
    const png = await makePng(200, 200)
    const result = await composeOverlay(png, {
      format: 'png',
      quality: 80,
      grid: { step: 100, originX: 500, originY: 500, pixelsPerSource: 1 },
      tap: { x: 10, y: 10 },
    })
    expect(result.width).toBe(200)
  })

  it('encodes jpeg when asked', async () => {
    const png = await makePng(200, 200)
    const result = await composeOverlay(png, { format: 'jpeg', quality: 70 })
    const meta = await sharp(result.data).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('throws on an image with no dimensions', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02])
    await expect(composeOverlay(bad, { format: 'png', quality: 80 })).rejects.toThrow(/no dimensions/)
  })
})
