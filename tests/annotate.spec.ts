import { describe, it, expect } from 'vitest'
import { annotateTap, annotateSwipe } from '../src/annotate.js'
import sharp from 'sharp'

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 128, b: 0 } },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('annotateTap', () => {
  it('produces a valid PNG with the same dimensions', async () => {
    const png = await makePng(800, 600)
    const result = await annotateTap(png, 400, 300)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    const meta = await sharp(result.data).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(600)
  })

  it('produces different bytes than the input (overlay was applied)', async () => {
    const png = await makePng(400, 400)
    const result = await annotateTap(png, 200, 200)
    expect(result.data.byteLength).toBeGreaterThan(0)
    // The annotated image has SVG overlay composited, so bytes differ
    const inputHash = await sharp(png).stats()
    const outputHash = await sharp(result.data).stats()
    // The overlay adds red pixels, so the red channel statistics should differ
    expect(outputHash.channels[0].mean).toBeGreaterThan(inputHash.channels[0].mean)
  })

  it('throws on an image with no dimensions', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02])
    await expect(annotateTap(bad, 10, 10)).rejects.toThrow(/no dimensions/)
  })

  it('works with edge coordinates (0, 0)', async () => {
    const png = await makePng(200, 200)
    const result = await annotateTap(png, 0, 0)
    expect(result.width).toBe(200)
    expect(result.height).toBe(200)
  })

  it('works with edge coordinates (max, max)', async () => {
    const png = await makePng(200, 200)
    const result = await annotateTap(png, 200, 200)
    expect(result.width).toBe(200)
  })

  it('scales marker relative to image size', async () => {
    const small = await makePng(200, 200)
    const large = await makePng(2000, 2000)
    const smallResult = await annotateTap(small, 100, 100)
    const largeResult = await annotateTap(large, 1000, 1000)
    // Larger image should produce larger output (more SVG data)
    expect(largeResult.data.byteLength).toBeGreaterThan(smallResult.data.byteLength)
  })
})

describe('annotateSwipe', () => {
  it('produces a valid PNG with the same dimensions', async () => {
    const png = await makePng(800, 600)
    const result = await annotateSwipe(png, 100, 100, 700, 500)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    const meta = await sharp(result.data).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(600)
  })

  it('produces different bytes than the input', async () => {
    const png = await makePng(400, 400)
    const result = await annotateSwipe(png, 50, 50, 350, 350)
    const inputStats = await sharp(png).stats()
    const outputStats = await sharp(result.data).stats()
    expect(outputStats.channels[0].mean).toBeGreaterThan(inputStats.channels[0].mean)
  })

  it('throws on an image with no dimensions', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02])
    await expect(annotateSwipe(bad, 0, 0, 10, 10)).rejects.toThrow(/no dimensions/)
  })
})
