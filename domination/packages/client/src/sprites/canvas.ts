/**
 * The one step from pixel bytes to something the browser can draw
 * (work package WP5). Everything before this step is pure and tested in
 * Node; this needs a browser.
 */

import type { RasterImage } from './format';

/** The 2D drawing context of a canvas. Throws where the browser has none (it always has, in practice). */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw on a canvas (no 2D context).');
  return context;
}

/** A new offscreen canvas showing exactly the given picture. */
export function imageToCanvas(image: RasterImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = context2d(canvas);
  const data = context.createImageData(image.width, image.height);
  data.data.set(image.pixels);
  context.putImageData(data, 0, 0);
  return canvas;
}
