/**
 * City name banners (work package WP5).
 *
 * A banner is a plate in the owner's primary colour with a dark frame; on
 * it, in the owner's secondary colour, the city's name in upper case and
 * the population. A dark line splits the plate into a name cell and a
 * population cell, which keeps "ROME 2", a city's name, apart from "ROME"
 * with 2 citizens. The banner hangs centred above the city, its lower edge
 * on the flag.
 *
 * The plate is measured in FONT pixels and drawn at a whole number of device
 * pixels per font pixel, so the letters are crisp at every zoom. The frame
 * around it is one ART pixel thick, like every other outline on the map.
 * The layout is pure (and tested); only drawBanner needs a canvas.
 */

import { FONT_HEIGHT, drawText, measureText } from '../sprites/font';
import type { OwnerColors } from '../sprites/format';
import { foggedColor } from '../sprites/looks';
import { PALETTE } from '../sprites/palette';

/** Empty font pixels between the edge of a cell and its text. */
const PADDING_X = 3;
const PADDING_Y = 1;
/** Width in font pixels of the dark line between the name cell and the population cell. */
const DIVIDER = 1;

/**
 * Device pixels per font pixel at a zoom: text grows in whole steps, half
 * as fast as the map, and never below 1. Halves are rounded UP (zoom 3
 * gives 2): at the zoom the game starts with on an ordinary display the
 * letters are then 14 pixels tall, as large against the city as in the
 * reference picture, where rounding down would leave them 7 pixels tall.
 */
export function bannerScale(zoom: number): number {
  return Math.max(1, Math.ceil(zoom / 2));
}

/** Thickness of a banner's dark frame in device pixels at a zoom: one art pixel. */
export function bannerFrame(zoom: number): number {
  return zoom;
}

/** Where everything is on a banner's plate, in font pixels from the plate's top-left corner (the frame is not included). */
export interface BannerLayout {
  /** Size of the plate. */
  width: number;
  height: number;
  /** The name as drawn (upper case) and where its first letter starts. */
  name: string;
  nameX: number;
  /** The dark line between the two cells: from the top of the plate to the bottom. */
  dividerX: number;
  /** The population as drawn and where its first digit starts. */
  population: string;
  populationX: number;
  /** Top of the letters. */
  textY: number;
}

export function bannerLayout(cityName: string, population: number): BannerLayout {
  const name = cityName.toUpperCase();
  const populationText = String(population);
  const nameX = PADDING_X;
  const dividerX = nameX + measureText(name) + PADDING_X;
  const populationX = dividerX + DIVIDER + PADDING_X;
  return {
    width: populationX + measureText(populationText) + PADDING_X,
    height: PADDING_Y + FONT_HEIGHT + PADDING_Y,
    name,
    nameX,
    dividerX,
    population: populationText,
    populationX,
    textY: PADDING_Y,
  };
}

/** Size in device pixels of a whole banner, frame included. */
export function bannerSize(layout: BannerLayout, scale: number, frame: number): { width: number; height: number } {
  return { width: layout.width * scale + 2 * frame, height: layout.height * scale + 2 * frame };
}

/**
 * Draws a banner with its top-left corner at (x, y) in device pixels: the
 * plate at `scale` device pixels per font pixel, inside a frame `frame`
 * device pixels thick. `fogged` gives the plate and the text the fog look
 * (the banner of a remembered city).
 */
export function drawBanner(
  context: CanvasRenderingContext2D,
  layout: BannerLayout,
  colors: OwnerColors,
  fogged: boolean,
  x: number,
  y: number,
  scale: number,
  frame: number,
): void {
  const plate = fogged ? foggedColor(colors.primary) : colors.primary;
  const ink = fogged ? foggedColor(colors.secondary) : colors.secondary;
  const size = bannerSize(layout, scale, frame);
  const plateX = x + frame;
  const plateY = y + frame;

  context.fillStyle = PALETTE.outline;
  context.fillRect(x, y, size.width, size.height);
  context.fillStyle = plate;
  context.fillRect(plateX, plateY, layout.width * scale, layout.height * scale);

  const textY = plateY + layout.textY * scale;
  drawText(context, layout.name, plateX + layout.nameX * scale, textY, scale, ink);
  drawText(context, layout.population, plateX + layout.populationX * scale, textY, scale, ink);
  context.fillStyle = PALETTE.outline;
  context.fillRect(plateX + layout.dividerX * scale, plateY, DIVIDER * scale, layout.height * scale);
}
