/**
 * Drawing one frame (work package WP5): everything the player sees on the
 * map canvas, back to front. All positions here are whole DEVICE pixels;
 * every picture is enlarged by a whole number (the zoom), which is what
 * keeps the pixels crisp.
 */

import { isValidTile, tileCoord } from '@domination/shared';
import type { CityView, CivId, PlayerId, PlayerView, TileIndex, UnitId } from '@domination/shared';
import { PALETTE } from '../sprites/palette';
import type { Sprite, SpriteId, SpriteSheet } from '../sprites/spriteSheet';
import type { MapOverlay } from './api';
import type { BannerCache } from './bannerCache';
import { visibleTileRange } from './camera';
import type { Camera, Viewport } from './camera';
import { TILE_WIDTH, tileOrigin } from './geometry';
import { cityIsIdle, pathMarks, workingSignOffset } from './scene';
import type { UnitDrawing } from './scene';
import { LAYER_PADDING } from './terrainLayer';

/** The lower edge of a banner sits this many art pixels below the top of the city's tile box: on the flag. */
const BANNER_BOTTOM = 2;

/** A banner never reaches further sideways than this many tiles from its city (the longest name, zoomed out). */
export const BANNER_REACH = 4;

/** Everything one frame is drawn from. */
export interface FrameInput {
  viewport: Viewport;
  /** The camera, already on whole device pixels (camera.ts `snapCamera`). */
  camera: Camera;
  view: PlayerView | null;
  overlay: MapOverlay;
  /** The finished picture of ground, borders, features and improvements (terrainLayer.ts). */
  terrain: HTMLCanvasElement;
  sheet: SpriteSheet;
  banners: BannerCache;
  civs: Map<PlayerId, CivId>;
  /** Cities and units in drawing order (scene.ts). */
  cities: CityView[];
  units: UnitDrawing[];
  /** Units in mid-slide: how far each is from its real position, in art pixels (slide.ts). */
  slideOffsets: Map<UnitId, { dx: number; dy: number }>;
}

export function drawFrame(context: CanvasRenderingContext2D, frame: FrameInput): void {
  const { viewport, camera, view, overlay, sheet } = frame;
  const zoom = camera.zoom;

  // Resizing a canvas switches smoothing back on, so say it every frame.
  context.imageSmoothingEnabled = false;

  // 1. The unknown: never-seen tiles are simply not drawn over it.
  context.fillStyle = PALETTE.outline;
  context.fillRect(0, 0, viewport.width, viewport.height);
  if (view === null) return;

  // Device pixel of the map's art pixel (0, 0).
  const originX = -Math.round(camera.x * zoom);
  const originY = -Math.round(camera.y * zoom);

  /** Draws a sprite for the tile box whose top-left art pixel is (px, py). */
  const drawSprite = (sprite: Sprite, px: number, py: number): void => {
    context.drawImage(
      sprite.image,
      sprite.sx, sprite.sy, sprite.width, sprite.height,
      Math.round((px + sprite.offsetX) * zoom) + originX,
      Math.round((py + sprite.offsetY) * zoom) + originY,
      sprite.width * zoom,
      sprite.height * zoom,
    );
  };

  // Tiles outside this rectangle cannot be seen and are skipped.
  const range = visibleTileRange(camera, viewport, view);
  const onScreen = (tile: TileIndex): boolean => {
    if (!isValidTile(tile, view)) return false;
    const coord = tileCoord(tile, view);
    return coord.x >= range.x0 && coord.x <= range.x1 && coord.y >= range.y0 && coord.y <= range.y1;
  };
  const drawOnTile = (id: SpriteId, tile: TileIndex): void => {
    if (!onScreen(tile)) return;
    const origin = tileOrigin(tileCoord(tile, view));
    drawSprite(sheet.get(id), origin.px, origin.py);
  };

  // 2-4. Ground, borders, features and improvements: the part of the finished picture that is on screen.
  drawTerrain(context, frame.terrain, viewport, zoom, originX, originY);

  // 5. Highlights from the overlay.
  for (const tile of overlay.reachable) drawOnTile('marker.reachable', tile);
  for (const mark of pathMarks(view, overlay.selectedTile, overlay.path)) {
    drawSprite(sheet.get(mark.kind === 'end' ? 'marker.pathEnd' : 'marker.pathStep'), mark.px, mark.py);
  }
  for (const tile of overlay.workedTiles) drawOnTile('marker.worked', tile);
  if (overlay.selectedTile !== null) drawOnTile('marker.selection', overlay.selectedTile);
  if (overlay.hoverTile !== null && overlay.hoverTile !== overlay.selectedTile) drawOnTile('marker.hover', overlay.hoverTile);

  // 6. Cities, then units, then the "builds nothing" signs. Both signs are
  // drawn from the view alone: the overlay knows nothing about them.
  for (const city of frame.cities) {
    if (!onScreen(city.tile)) continue;
    const origin = tileOrigin(tileCoord(city.tile, view));
    drawSprite(sheet.get('city', frame.civs.get(city.owner), { look: city.visible ? 'normal' : 'fogged' }), origin.px, origin.py);
  }
  for (const drawing of frame.units) {
    const unit = drawing.unit;
    if (!isValidTile(unit.tile, view)) continue;
    const slide = frame.slideOffsets.get(unit.id);
    // A sliding unit may still be on screen although its tile is not: draw it and let the canvas clip.
    if (slide === undefined && !onScreen(unit.tile)) continue;
    const origin = tileOrigin(tileCoord(unit.tile, view));
    drawSprite(
      sheet.get(`unit.${unit.type}`, frame.civs.get(unit.owner), { look: drawing.look, rim: drawing.rim }),
      origin.px + drawing.dx + (slide?.dx ?? 0),
      origin.py + drawing.dy + (slide?.dy ?? 0),
    );
    if (drawing.working) {
      // The "at work" sign, right after its unit, so a unit in front of this
      // one covers both. It is drawn at the unit's real place: a unit at
      // work stays on its tile, so it never slides.
      const sign = workingSignOffset(drawing);
      drawSprite(sheet.get('marker.working'), origin.px + sign.dx, origin.py + sign.dy);
    }
  }
  // After the units, so that a unit standing in the city never hides the
  // sign; before the banners, which lie on top of everything.
  for (const city of frame.cities) {
    if (cityIsIdle(city)) drawOnTile('marker.idle', city.tile);
  }

  // 7. City banners, on top of everything. Zoomed out, a banner is much
  // wider than its tile, so a city is only skipped when it is well off screen.
  for (const city of frame.cities) {
    if (!isValidTile(city.tile, view)) continue;
    const coord = tileCoord(city.tile, view);
    const farOff =
      coord.x < range.x0 - BANNER_REACH || coord.x > range.x1 + BANNER_REACH || coord.y < range.y0 - 1 || coord.y > range.y1 + 1;
    if (farOff) continue;
    const origin = tileOrigin(coord);
    const banner = frame.banners.get(city.name, city.population, frame.civs.get(city.owner), !city.visible, zoom);
    const centerX = Math.round((origin.px + TILE_WIDTH / 2) * zoom) + originX;
    const bottomY = (origin.py + BANNER_BOTTOM) * zoom + originY;
    context.drawImage(banner, centerX - Math.round(banner.width / 2), bottomY - banner.height);
  }
}

/**
 * Copies the visible part of the terrain picture onto the canvas, enlarged
 * by the zoom. The part is cut out on whole art pixels and placed on whole
 * device pixels, so every art pixel becomes an exact zoom x zoom square.
 */
function drawTerrain(
  context: CanvasRenderingContext2D,
  terrain: HTMLCanvasElement,
  viewport: Viewport,
  zoom: number,
  originX: number,
  originY: number,
): void {
  // Layer pixel n shows art pixel n - LAYER_PADDING.
  const limit = (value: number, most: number): number => Math.min(Math.max(value, 0), most);
  const left = limit(Math.floor(-originX / zoom) + LAYER_PADDING, terrain.width);
  const top = limit(Math.floor(-originY / zoom) + LAYER_PADDING, terrain.height);
  const right = limit(Math.ceil((viewport.width - originX) / zoom) + LAYER_PADDING, terrain.width);
  const bottom = limit(Math.ceil((viewport.height - originY) / zoom) + LAYER_PADDING, terrain.height);
  if (right <= left || bottom <= top) return;
  context.drawImage(
    terrain,
    left, top, right - left, bottom - top,
    (left - LAYER_PADDING) * zoom + originX, (top - LAYER_PADDING) * zoom + originY,
    (right - left) * zoom, (bottom - top) * zoom,
  );
}
