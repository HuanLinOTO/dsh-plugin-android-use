import { describe, it, expect } from 'vitest'
import { fitToMaxDimension, computeScale } from '../src/image.js'
import sharp from 'sharp'

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 128, b: 0 } },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('fitToMaxDimension', () => {
  it('returns original bytes when within the limit', async () => {
    const png = await makePng(100, 50)
    const result = await fitToMaxDimension(png, 2000)
    expect(result.width).toBe(100)
    expect(result.height).toBe(50)
    expect(result.scaleX).toBe(1)
    expect(result.scaleY).toBe(1)
    expect(result.data).toBe(png)
  })

  it('returns original bytes when exactly at the limit', async () => {
    const png = await makePng(2000, 1000)
    const result = await fitToMaxDimension(png, 2000)
    expect(result.width).toBe(2000)
    expect(result.scaleX).toBe(1)
    expect(result.data).toBe(png)
  })

  it('downscales a tall image to fit, preserving aspect ratio', async () => {
    const png = await makePng(1080, 2414)
    const result = await fitToMaxDimension(png, 2000)
    expect(result.width).toBeLessThanOrEqual(2000)
    expect(result.height).toBeLessThanOrEqual(2000)
    expect(result.height).toBe(2000)
    expect(result.scaleX).toBeCloseTo(result.width / 1080, 3)
    expect(result.scaleY).toBeCloseTo(result.height / 2414, 3)
    expect(result.data).not.toBe(png)
  })

  it('downscales a wide image to fit, preserving aspect ratio', async () => {
    const png = await makePng(2772, 1240)
    const result = await fitToMaxDimension(png, 2000)
    expect(result.width).toBe(2000)
    expect(result.height).toBeLessThanOrEqual(2000)
    expect(result.scaleX).toBeLessThan(1)
    expect(result.scaleY).toBeLessThan(1)
  })

  it('throws on an image with no dimensions', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02])
    await expect(fitToMaxDimension(bad, 2000)).rejects.toThrow(/no dimensions/)
  })
})

describe('computeScale', () => {
  it('returns 1 when device fits within maxDimension', () => {
    expect(computeScale(1080, 2414, 9999)).toBe(1)
    expect(computeScale(2000, 1000, 2000)).toBe(1)
  })

  it('returns the correct scale when device exceeds maxDimension', () => {
    expect(computeScale(1080, 2414, 2000)).toBeCloseTo(2000 / 2414, 5)
  })

  it('returns 1 for zero dimensions', () => {
    expect(computeScale(0, 0, 2000)).toBe(1)
  })
})
