function asPositiveNumber(n) {
  const x = Number(n)
  return Number.isFinite(x) && x > 0 ? x : 0
}

/**
 * Calculates a safe scale factor to fit a slide into a container without cropping.
 * Returns 0 when container/slide dimensions are invalid.
 */
export function calcSlideScale({
  containerWidth,
  containerHeight,
  slideWidth,
  slideHeight,
}) {
  const cw = asPositiveNumber(containerWidth)
  const ch = asPositiveNumber(containerHeight)
  const sw = asPositiveNumber(slideWidth)
  const sh = asPositiveNumber(slideHeight)

  if (!cw || !ch || !sw || !sh) return 0

  return Math.min(cw / sw, ch / sh)
}

