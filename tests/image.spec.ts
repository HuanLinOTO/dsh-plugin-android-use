import { describe, it, expect } from 'vitest'
import { fitToMaxDimension, computeScale, prepareImage, clampRegion } from '../src/image.js'
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

describe('prepareImage', () => {
  it('caps the longest side and reports the delivered size', async () => {
    const png = await makePng(1080, 2414)
    const result = await prepareImage(png, { maxDimension: 1280, format: 'jpeg', quality: 80 })
    expect(result.height).toBe(1280)
    expect(result.width).toBe(573)
    expect(result.mediaType).toBe('image/jpeg')
    expect(result.sourceWidth).toBe(1080)
    expect(result.sourceHeight).toBe(2414)
    expect(result.pixelsPerSource).toBeCloseTo(1280 / 2414, 3)
  })

  it('keeps the original pixels when already within the cap', async () => {
    const png = await makePng(400, 300)
    const result = await prepareImage(png, { maxDimension: 1280, format: 'png', quality: 80 })
    expect(result.width).toBe(400)
    expect(result.height).toBe(300)
    expect(result.magnify).toBe(1)
    expect(result.originX).toBe(0)
  })

  it('crops a region and magnifies it by the requested factor', async () => {
    const png = await makePng(1080, 2414)
    const result = await prepareImage(png, {
      maxDimension: 1280,
      format: 'jpeg',
      quality: 80,
      region: { x: 200, y: 800, width: 400, height: 300 },
      magnify: 2,
    })
    expect(result.originX).toBe(200)
    expect(result.originY).toBe(800)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(result.magnify).toBe(2)
  })

  it('auto-magnifies a crop up to the size cap', async () => {
    const png = await makePng(1080, 2414)
    const result = await prepareImage(png, {
      maxDimension: 1280,
      format: 'jpeg',
      quality: 80,
      region: { x: 0, y: 0, width: 200, height: 200 },
    })
    expect(result.width).toBe(800)
    expect(result.height).toBe(800)
    expect(result.magnify).toBe(4)
  })

  it('rejects a region outside the screenshot', async () => {
    const png = await makePng(1080, 2414)
    await expect(prepareImage(png, {
      maxDimension: 1280,
      format: 'jpeg',
      quality: 80,
      region: { x: 5000, y: 5000, width: 100, height: 100 },
    })).rejects.toThrow(/outside/)
  })

  it('throws on an image with no dimensions', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02])
    await expect(prepareImage(bad, { maxDimension: 1280, format: 'jpeg', quality: 80 })).rejects.toThrow(/no dimensions/)
  })
})

describe('clampRegion', () => {
  it('returns null when the window misses the image', () => {
    expect(clampRegion({ x: 5000, y: 5000, width: 10, height: 10 }, 1080, 2414)).toBeNull()
    expect(clampRegion({ x: -100, y: -100, width: 10, height: 10 }, 1080, 2414)).toBeNull()
  })

  it('clips a partially visible window', () => {
    expect(clampRegion({ x: 1000, y: 2300, width: 400, height: 400 }, 1080, 2414))
      .toEqual({ x: 1000, y: 2300, width: 80, height: 114 })
  })
})