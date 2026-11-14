/**
 * A STAND-IN map renderer (part of the scaffold, not of a work package).
 *
 * The real renderer (renderer.ts, work package WP5) draws the approved pixel
 * art. Until it exists, this file gives the rest of the client something
 * that honours the same contract (api.ts): flat-coloured hexagons, plain
 * squares for cities and units, and a camera with real panning, zooming,
 * centring and pixel-exact hit testing (all built on geometry.ts, which is
 * finished). So the app shell (WP4) can build and try map input, selection,
 * the debug hook and the panels in a browser without waiting for WP5.
 *
 * It is deliberately plain: no sprites, no device-pixel sharpness tricks, no
 * animation. Do not polish it. After the merge the integrator may delete it,
 * or keep it as a fallback for debugging.
 */

import { CIVS, inBounds, isValidTile, tileCoord, tileIndex } from '@domination/shared';
import type { CivId, PlayerId, PlayerView, TileIndex } from '@domination/shared';
import { isNotImplementedError } from '@domination/shared/testing';
import { PALETTE } from '../sprites/palette';
import { EMPTY_OVERLAY } from './api';
import type { MapOverlay, MapRenderer, ScreenPoint } from './api';
import { HEX_POINT_ROWS, ROW_PITCH, TILE_HEIGHT, hexRowSpan, mapPixelSize, pixelToTile, tileCenter, tileOrigin } from './geometry';
import { createMapRenderer } from './renderer';

/** CSS pixels per art pixel: the smallest, the largest and the starting zoom. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const START_ZOOM = 3;

const GROUND_COLORS = {
  ocean: PALETTE.oceanBase,
  coast: PALETTE.coastBase,
  grassland: PALETTE.grassBase,
  plains: PALETTE.plainsBase,
  desert: PALETTE.desertBase,
} as const;

const FEATURE_COLORS = {
  forest: PALETTE.pineShade,
  hills: PALETTE.hillShade,
  mountains: PALETTE.rockShade,
} as const;

/**
 * What WP4's game screen calls: the real renderer if WP5 has written it,
 * otherwise this stand-in. Any error other than "not implemented" is a real
 * bug in the renderer and is passed on.
 */
export function createRendererOrPlaceholder(canvas: HTMLCanvasElement): MapRenderer {
  try {
    return createMapRenderer(canvas);
  } catch (error) {
    if (!isNotImplementedError(error)) throw error;
    return createPlaceholderRenderer(canvas);
  }
}

/** The stand-in renderer itself. Same contract as createMapRenderer (see api.ts). */
export function createPlaceholderRenderer(canvas: HTMLCanvasElement): MapRenderer {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw on a canvas (no 2D context).');
  const ctx = context;

  let view: PlayerView | null = null;
  let overlay: MapOverlay = EMPTY_OVERLAY;

  // The camera: the art-pixel position shown at the canvas's top-left corner
  // (may be fractional), and how many CSS pixels one art pixel covers.
  let cameraX = 0;
  let cameraY = 0;
  let zoom = START_ZOOM;

  // The canvas box on screen, in CSS pixels (see `measure`).
  let boxLeft = 0;
  let boxTop = 0;
  let boxWidth = 0;
  let boxHeight = 0;

  let frameRequest: number | null = null;
  let destroyed = false;

  /** Reads the canvas's position and size on screen, and fits the backing store to it. */
  function measure(): void {
    const box = canvas.getBoundingClientRect();
    boxLeft = box.left;
    boxTop = box.top;
    boxWidth = box.width;
    boxHeight = box.height;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(boxWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(boxHeight * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
  }

  /** Keeps the camera on the map: no scrolling past the edge; a map smaller than the canvas is centred. */
  function clampCamera(): void {
    if (view === null) return;
    const map = mapPixelSize(view);
    const shownWidth = boxWidth / zoom;
    const shownHeight = boxHeight / zoom;
    cameraX = map.width <= shownWidth ? (map.width - shownWidth) / 2 : Math.min(Math.max(cameraX, 0), map.width - shownWidth);
    cameraY = map.height <= shownHeight ? (map.height - shownHeight) / 2 : Math.min(Math.max(cameraY, 0), map.height - shownHeight);
  }

  function requestDraw(): void {
    if (destroyed || frameRequest !== null) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      draw();
    });
  }

  /** Fills the pixel hexagon of the tile whose sprite box starts at (px, py), in the current fill colour. */
  function fillHex(px: number, py: number): void {
    for (let y = 0; y < HEX_POINT_ROWS; y++) {
      const [first, last] = hexRowSpan(y);
      ctx.fillRect(px + first, py + y, last - first + 1, 1);
    }
    const [bodyFirst, bodyLast] = hexRowSpan(HEX_POINT_ROWS);
    ctx.fillRect(px + bodyFirst, py + HEX_POINT_ROWS, bodyLast - bodyFirst + 1, ROW_PITCH - HEX_POINT_ROWS);
    for (let y = ROW_PITCH; y < TILE_HEIGHT; y++) {
      const [first, last] = hexRowSpan(y);
      ctx.fillRect(px + first, py + y, last - first + 1, 1);
    }
  }

  function civOf(current: PlayerView, playerId: PlayerId): CivId | null {
    return current.players.find((player) => player.id === playerId)?.civ ?? null;
  }

  function draw(): void {
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.outline;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (view === null) return;
    const current = view;

    // From here on all coordinates are art pixels.
    const scale = zoom * ratio;
    ctx.setTransform(scale, 0, 0, scale, -Math.round(cameraX * scale), -Math.round(cameraY * scale));

    // Ground, territory tint, feature mark and fog, tile by tile.
    current.tiles.forEach((tile, index) => {
      if (tile === null) return; // never seen: stays dark
      const origin = tileOrigin(tileCoord(index, current));
      ctx.fillStyle = GROUND_COLORS[tile.terrain];
      fillHex(origin.px, origin.py);
      const ownerCiv = tile.owner === null ? null : civOf(current, tile.owner);
      if (ownerCiv !== null) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = CIVS[ownerCiv].primary;
        fillHex(origin.px, origin.py);
        ctx.globalAlpha = 1;
      }
      if (tile.feature !== null) {
        ctx.fillStyle = FEATURE_COLORS[tile.feature];
        ctx.fillRect(origin.px + 8, origin.py + 9, 10, 8);
      }
      if (!tile.visible) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = PALETTE.outline;
        fillHex(origin.px, origin.py);
        ctx.globalAlpha = 1;
      }
    });

    // Highlights.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    for (const tile of overlay.reachable) {
      const origin = tileOrigin(tileCoord(tile, current));
      fillHex(origin.px, origin.py);
    }
    ctx.globalAlpha = 1;
    for (const tile of overlay.path) {
      const center = tileCenter(tileCoord(tile, current));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(center.px - 2, center.py - 2, 4, 4);
    }
    for (const tile of overlay.workedTiles) {
      const center = tileCenter(tileCoord(tile, current));
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(center.px - 2, center.py + 5, 4, 4);
    }
    if (overlay.hoverTile !== null) outlineTile(current, overlay.hoverTile, 1);
    if (overlay.selectedTile !== null) outlineTile(current, overlay.selectedTile, 2);

    // Cities, then units.
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    for (const city of current.cities) {
      const center = tileCenter(tileCoord(city.tile, current));
      const civ = civOf(current, city.owner);
      ctx.globalAlpha = city.visible ? 1 : 0.55;
      box(center.px - 7, center.py - 6, 14, 12, civ === null ? '#ffffff' : CIVS[civ].primary);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${city.name.toUpperCase()} ${city.population}`, center.px, center.py - 8);
      ctx.globalAlpha = 1;
    }
    for (const unit of current.units) {
      const center = tileCenter(tileCoord(unit.tile, current));
      const civ = civOf(current, unit.owner);
      // The selected unit is drawn last so it ends up in front.
      if (unit.id === overlay.selectedUnitId) continue;
      drawUnit(center.px, center.py, unit.type === 'settler', civ, unit.own?.movesLeft === 0);
    }
    const selected = current.units.find((unit) => unit.id === overlay.selectedUnitId);
    if (selected !== undefined) {
      const center = tileCenter(tileCoord(selected.tile, current));
      drawUnit(center.px, center.py, selected.type === 'settler', civOf(current, selected.owner), selected.own?.movesLeft === 0);
    }
  }

  function box(x: number, y: number, width: number, height: number, color: string): void {
    ctx.fillStyle = PALETTE.outline;
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  /** A unit is a small upright box; settlers (civilians) stand to the left, soldiers to the right. */
  function drawUnit(centerX: number, centerY: number, civilian: boolean, civ: CivId | null, spent: boolean): void {
    ctx.globalAlpha = spent ? 0.5 : 1;
    box(centerX + (civilian ? -8 : 2), centerY - 3, 6, 9, civ === null ? '#ffffff' : CIVS[civ].primary);
    ctx.globalAlpha = 1;
  }

  function outlineTile(current: PlayerView, tile: TileIndex, lineWidth: number): void {
    const origin = tileOrigin(tileCoord(tile, current));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(origin.px + 2, origin.py + 5, 22, 18);
  }

  // ---- The camera, as api.ts describes it --------------------------------

  function toArt(point: ScreenPoint): { px: number; py: number } {
    return { px: cameraX + (point.x - boxLeft) / zoom, py: cameraY + (point.y - boxTop) / zoom };
  }

  const observer = new ResizeObserver(() => {
    measure();
    clampCamera();
    requestDraw();
  });
  observer.observe(canvas);
  measure(); // api.ts, rule 1: measure right now, not when the observer gets round to it

  return {
    setView(next) {
      if (next === view) return;
      view = next;
      clampCamera();
      requestDraw();
    },

    setOverlay(next) {
      overlay = next;
      requestDraw();
    },

    panBy(dx, dy) {
      if (view === null) return;
      cameraX -= dx / zoom;
      cameraY -= dy / zoom;
      clampCamera();
      requestDraw();
    },

    zoomBy(steps, anchor) {
      if (view === null) return;
      measure();
      const fixed = anchor ?? { x: boxLeft + boxWidth / 2, y: boxTop + boxHeight / 2 };
      const artUnderAnchor = toArt(fixed);
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + Math.round(steps)));
      cameraX = artUnderAnchor.px - (fixed.x - boxLeft) / zoom;
      cameraY = artUnderAnchor.py - (fixed.y - boxTop) / zoom;
      clampCamera();
      requestDraw();
    },

    centerOn(tile) {
      if (view === null || !isValidTile(tile, view)) return;
      measure();
      const center = tileCenter(tileCoord(tile, view));
      cameraX = center.px - boxWidth / zoom / 2;
      cameraY = center.py - boxHeight / zoom / 2;
      clampCamera();
      requestDraw();
    },

    tileAt(point) {
      if (view === null) return null;
      measure();
      const inside =
        point.x >= boxLeft && point.x < boxLeft + boxWidth && point.y >= boxTop && point.y < boxTop + boxHeight;
      if (!inside) return null;
      const art = toArt(point);
      const coord = pixelToTile(art.px, art.py);
      return inBounds(coord, view) ? tileIndex(coord, view) : null;
    },

    tileToScreen(tile) {
      if (view === null) throw new Error('tileToScreen: there is no view yet');
      if (!isValidTile(tile, view)) throw new Error(`tileToScreen: ${tile} is not a tile of this map`);
      measure();
      const center = tileCenter(tileCoord(tile, view));
      return { x: boxLeft + (center.px - cameraX) * zoom, y: boxTop + (center.py - cameraY) * zoom };
    },

    destroy() {
      destroyed = true;
      observer.disconnect();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null;
    },
  };
}
