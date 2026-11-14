/**
 * How many pixels the canvas needs (work package WP5). Pure.
 *
 * For crisp pixels the canvas's backing store must have exactly one pixel
 * per DEVICE pixel of its box on screen. The box is measured in CSS pixels;
 * on a display with a fractional ratio (1.25, 1.5) "CSS size times ratio"
 * is often not a whole number, and rounding it can be one pixel off from
 * what the browser really uses, which blurs the whole map slightly.
 *
 * Browsers can report the true size in device pixels (ResizeObserver,
 * "device-pixel-content-box"). That report is used when it agrees with the
 * CSS size to within a pixel, which is all it is needed for. It is NOT
 * trusted further than that: under device emulation (the browser's
 * developer tools, automated tests) it ignores the emulated ratio and would
 * leave the canvas at a fraction of its resolution.
 */

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * The backing-store size for a canvas box.
 *
 * @param cssSize   the box in CSS pixels (getBoundingClientRect)
 * @param ratio     device pixels per CSS pixel (window.devicePixelRatio)
 * @param reported  the size in device pixels as the browser reports it, if it does
 */
export function backingStoreSize(cssSize: PixelSize, ratio: number, reported?: PixelSize): PixelSize {
  const pick = (css: number, exact: number | undefined): number => {
    const wanted = css * ratio;
    if (exact !== undefined && Math.abs(exact - wanted) < 1) return Math.round(exact);
    return Math.round(wanted);
  };
  return { width: pick(cssSize.width, reported?.width), height: pick(cssSize.height, reported?.height) };
}
