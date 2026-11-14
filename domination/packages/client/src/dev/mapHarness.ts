/**
 * A bare test page for the map renderer (part of the scaffold):
 *
 *   npm run dev, then open http://localhost:5173/dev-map.html
 *
 * It shows the sample view (sampleView() from the shared package) through
 * exactly the calls the real game screen will make (render/api.ts), with the
 * simplest possible input: drag to pan, wheel to zoom, click to select,
 * move the mouse to hover. No store, no server, no panels.
 *
 * Who it is for:
 *  - WP5 looks at the real renderer here before the app shell (WP4) exists.
 *    While createMapRenderer is still a stub, the scaffold's flat-colour
 *    stand-in is shown instead; add ?placeholder to the address to see the
 *    stand-in on purpose (handy for comparing hit testing).
 *  - WP4 can read this file as a worked example of the seam: the canvas is
 *    added to the page BEFORE the renderer is created, setView comes before
 *    centerOn, dragging 10 px to the right is panBy(10, 0), wheel up is
 *    zoomBy(+1, pointer).
 *
 * The page is only served by the development server; `npm run build` does
 * not include it.
 */

import { neighbors } from '@domination/shared';
import type { PlayerView, TileIndex } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import '../styles.css';
import { EMPTY_OVERLAY } from '../render/api';
import type { MapOverlay, MapRenderer } from '../render/api';
import { createPlaceholderRenderer, createRendererOrPlaceholder } from '../render/placeholderRenderer';

declare global {
  interface Window {
    /** For poking around in the browser console on this page. */
    __mapHarness?: { renderer: MapRenderer; view: PlayerView };
  }
}

const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
document.body.append(canvas); // first into the page, then the renderer (api.ts, rule 1)

const status = document.createElement('div');
status.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:4px 8px;background:#22223a;color:#f8f0d8;font:14px monospace';
document.body.append(status);

const wantsPlaceholder = new URLSearchParams(location.search).has('placeholder');
const renderer = wantsPlaceholder ? createPlaceholderRenderer(canvas) : createRendererOrPlaceholder(canvas);

const view = sampleView();
renderer.setView(view);
const home = view.cities.find((city) => city.owner === view.you) ?? view.cities[0];
if (home !== undefined) renderer.centerOn(home.tile);
window.__mapHarness = { renderer, view };

let overlay: MapOverlay = EMPTY_OVERLAY;

function setOverlay(changes: Partial<MapOverlay>): void {
  overlay = { ...overlay, ...changes };
  renderer.setOverlay(overlay);
}

/** A click: select the player's own unit or city on the tile and fill every part of the overlay. */
function select(tile: TileIndex): void {
  const unit = view.units.find((candidate) => candidate.tile === tile && candidate.owner === view.you);
  const city = view.cities.find((candidate) => candidate.tile === tile && candidate.owner === view.you);
  if (unit !== undefined) {
    // Not the real movement rules (those are WP2's): simply the explored tiles next to the unit.
    const reachable = neighbors(tile, view).filter((neighbor) => view.tiles[neighbor] !== null);
    setOverlay({ selectedTile: tile, selectedUnitId: unit.id, reachable, path: [], workedTiles: [] });
  } else if (city !== undefined) {
    setOverlay({ selectedTile: tile, selectedUnitId: null, reachable: [], path: [], workedTiles: city.own?.worked ?? [] });
  } else {
    setOverlay({ selectedTile: null, selectedUnitId: null, reachable: [], path: [], workedTiles: [] });
  }
}

function describe(tile: TileIndex | null): string {
  if (tile === null) return 'off the map';
  const seen = view.tiles[tile];
  const x = tile % view.width;
  const y = Math.floor(tile / view.width);
  if (seen === null) return `tile ${tile} (${x}, ${y}): never seen`;
  return `tile ${tile} (${x}, ${y}): ${seen.feature ?? seen.terrain}${seen.visible ? '' : ', fogged'}`;
}

// ---- Input: the smallest version of what input/mapInput.ts will do ----

const DRAG_THRESHOLD = 4;
let pressed: { x: number; y: number; dragging: boolean } | null = null;

canvas.addEventListener('pointerdown', (event) => {
  pressed = { x: event.clientX, y: event.clientY, dragging: false };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (pressed === null) {
    // Hover: outline the tile and preview a "path" of one step if it is reachable.
    const tile = renderer.tileAt({ x: event.clientX, y: event.clientY });
    const path = tile !== null && overlay.reachable.includes(tile) ? [tile] : [];
    setOverlay({ hoverTile: tile, path });
    status.textContent = describe(tile);
    return;
  }
  const dx = event.clientX - pressed.x;
  const dy = event.clientY - pressed.y;
  if (!pressed.dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
  pressed.dragging = true;
  renderer.panBy(dx, dy); // the map follows the pointer
  pressed.x = event.clientX;
  pressed.y = event.clientY;
});

canvas.addEventListener('pointerup', (event) => {
  if (pressed !== null && !pressed.dragging) {
    const tile = renderer.tileAt({ x: event.clientX, y: event.clientY });
    if (tile !== null) select(tile);
  }
  pressed = null;
});

canvas.addEventListener('pointerleave', () => {
  if (pressed === null) setOverlay({ hoverTile: null, path: [] });
});

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    renderer.zoomBy(event.deltaY < 0 ? 1 : -1, { x: event.clientX, y: event.clientY }); // wheel up zooms in
  },
  { passive: false },
);

status.textContent = 'drag to pan, wheel to zoom, click one of your units or your city';
