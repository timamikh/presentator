import { describe, expect, it } from 'vitest'
import { calcSlideScale } from './slideScale'

describe('calcSlideScale', () => {
  it('returns min(widthScale, heightScale) to avoid cropping', () => {
    // container is "too short" for width-based scale, so height must limit
    const scale = calcSlideScale({
      containerWidth: 960,
      containerHeight: 300,
      slideWidth: 1920,
      slideHeight: 1080,
    })
    expect(scale).toBeCloseTo(300 / 1080, 8)
  })

  it('uses width when width is the limiting dimension', () => {
    const scale = calcSlideScale({
      containerWidth: 960,
      containerHeight: 1000,
      slideWidth: 1920,
      slideHeight: 1080,
    })
    expect(scale).toBeCloseTo(960 / 1920, 8)
  })

  it('returns 0 for invalid inputs', () => {
    expect(
      calcSlideScale({
        containerWidth: 0,
        containerHeight: 100,
        slideWidth: 1920,
        slideHeight: 1080,
      }),
    ).toBe(0)

    expect(
      calcSlideScale({
        containerWidth: 100,
        containerHeight: 100,
        slideWidth: 0,
        slideHeight: 1080,
      }),
    ).toBe(0)

    expect(
      calcSlideScale({
        containerWidth: 'nope',
        containerHeight: 100,
        slideWidth: 1920,
        slideHeight: 1080,
      }),
    ).toBe(0)
  })
})

