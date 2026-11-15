/**
 * The big-map test page (work package WP5), a development page:
 *
 *   npm run dev, then open http://localhost:5173/src/dev/big-map.html
 *
 * It shows a made-up game on the largest map size (syntheticView.ts) through
 * the real renderer, with the same simple input as the map test page (drag
 * to pan, wheel to zoom, click an own unit or city: a city shows the tiles
 * it works, a unit where it could go, a Worker at work nothing), and it
 * measures how long the renderer takes to draw a frame. The read-out in the
 * corner shows the last frame and the slowest of the last 120. Press P for
 * a pan test: the map is dragged about for a few seconds by itself and the
 * read-out then shows the average and the slowest frame and the frames per
 * second.
 *
 * In the address:
 *   ?size=small|medium|large   map size (default large)
 *   ?fog=none|some             everything in sight (default: the most to draw), or fog of war
 *   ?nocities                  leave the cities out (no banners: then every art pixel on screen is
 *                              one clean square, which a script can check)
 *   ?flush                     after every frame, read one pixel back from the canvas. That
 *                              makes the browser finish all painting before the clock stops,
 *                              so the time includes the painting itself and not only the
 *                              list of drawing commands. (It slows the page down a little.)
 *
 * The page is only served by the development server; `npm run build` does
 * not include it.
 */

import { MAP_SIZES, tilesInRange } from '@domination/shared';
import type { MapSizeId, PlayerView, TileIndex } from '@domination/shared';
import '../styles.css';
import { EMPTY_OVERLAY } from '../render/api';
import type { MapOverlay, MapRenderer } from '../render/api';
import { createMapRenderer } from '../render/renderer';
import { syntheticView } from './syntheticView';

declare global {
  interface Window {
    /** For poking around in the browser console, and for scripted measurements. */
    __bigMap?: {
      renderer: MapRenderer;
      view: PlayerView;
      /** Milliseconds each frame took, oldest first (emptied by resetFrameTimes). */
      frameTimes: number[];
      resetFrameTimes(): void;
      setOverlay(changes: Partial<MapOverlay>): void;
      runPanTest(frames: number): Promise<PanTestResult>;
    };
  }
}

/** What a pan test measured. */
export interface PanTestResult {
  frames: number;
  /** Time the renderer spent drawing a frame, in milliseconds. */
  averageMs: number;
  slowestMs: number;
  /** Frames really shown per second while panning (the display's refresh rate at best). */
  framesPerSecond: number;
}

const query = new URLSearchParams(location.search);
const sizeId = (query.get('size') ?? 'large') as MapSizeId;
const mapSize = MAP_SIZES[sizeId] ?? MAP_SIZES.large;
const flush = query.has('flush');

const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
document.body.append(canvas); // first into the page, then the renderer (api.ts, rule 1)

const status = document.createElement('div');
status.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:4px 8px;background:#22223a;color:#f8f0d8;font:14px monospace';
document.body.append(status);

// ---- The stopwatch: time every frame the renderer draws -------------------
// The renderer draws inside requestAnimationFrame, so wrapping that function
// (before the renderer exists) times exactly its drawing and nothing else.
const frameTimes: number[] = [];
const realRequestFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) =>
  realRequestFrame((time) => {
    const start = performance.now();
    callback(time);
    if (flush) canvas.getContext('2d')?.getImageData(0, 0, 1, 1);
    frameTimes.push(performance.now() - start);
    if (frameTimes.length > 2000) frameTimes.splice(0, 1000);
    const recent = frameTimes.slice(-120);
    status.textContent =
      `${mapSize.width} x ${mapSize.height} tiles | last frame ${recent[recent.length - 1].toFixed(2)} ms | ` +
      `slowest of the last ${recent.length}: ${Math.max(...recent).toFixed(2)} ms${flush ? ' (painting included)' : ''}`;
  });

const renderer = createMapRenderer(canvas);
const made = syntheticView({ width: mapSize.width, height: mapSize.height, fog: query.get('fog') === 'some' ? 'some' : 'none' });
const view: PlayerView = query.has('nocities') ? { ...made, cities: [] } : made;
renderer.setView(view);
const home = view.cities.find((city) => city.owner === view.you) ?? view.cities[0];
if (home !== undefined) renderer.centerOn(home.tile);

let overlay: MapOverlay = EMPTY_OVERLAY;
function setOverlay(changes: Partial<MapOverlay>): void {
  overlay = { ...overlay, ...changes };
  renderer.setOverlay(overlay);
}

/**
 * Drags the map about by itself for the given number of frames, a new
 * camera position every frame (the worst case for the renderer), and
 * reports how long the frames took.
 */
function runPanTest(frames: number): Promise<PanTestResult> {
  return new Promise((resolve) => {
    frameTimes.length = 0;
    const startedAt = performance.now();
    let frame = 0;
    const step = (): void => {
      // A zigzag on fractions of a pixel, so no two frames are alike.
      renderer.panBy(frame % 120 < 60 ? -6.3 : 6.3, frame % 80 < 40 ? -3.7 : 3.7);
      frame += 1;
      if (frame < frames) {
        realRequestFrame(step); // the unwrapped function: the steps themselves are not timed
        return;
      }
      realRequestFrame(() => {
        const seconds = (performance.now() - startedAt) / 1000;
        const result: PanTestResult = {
          frames: frameTimes.length,
          averageMs: frameTimes.reduce((sum, time) => sum + time, 0) / Math.max(1, frameTimes.length),
          slowestMs: Math.max(0, ...frameTimes),
          framesPerSecond: frameTimes.length / seconds,
        };
        status.textContent =
          `pan test, ${result.frames} frames: average ${result.averageMs.toFixed(2)} ms, slowest ${result.slowestMs.toFixed(2)} ms, ` +
          `${result.framesPerSecond.toFixed(0)} frames per second${flush ? ' (painting included)' : ''}`;
        resolve(result);
      });
    };
    realRequestFrame(step);
  });
}
window.addEventListener('keydown', (event) => {
  if (event.key === 'p' || event.key === 'P') void runPanTest(240);
});

window.__bigMap = { renderer, view, frameTimes, resetFrameTimes: () => { frameTimes.length = 0; }, setOverlay, runPanTest };

/** A click: select the player's own unit or city on the tile and fill the overlay with something plausible. */
function select(tile: TileIndex): void {
  const unit = view.units.find((candidate) => candidate.tile === tile && candidate.owner === view.you);
  const city = view.cities.find((candidate) => candidate.tile === tile && candidate.owner === view.you);
  if (unit !== undefined) {
    // Not the real movement rules: simply the explored land within two steps. A unit at work goes nowhere.
    const atWork = unit.own !== null && unit.own.job !== null;
    const reachable = atWork ? [] : tilesInRange(tile, 2, view).filter((near) => {
      const seen = view.tiles[near];
      return near !== tile && seen !== null && seen.terrain !== 'ocean' && seen.terrain !== 'coast' && seen.feature !== 'mountains';
    });
    setOverlay({ selectedTile: tile, selectedUnitId: unit.id, reachable, path: [], workedTiles: [] });
  } else if (city !== undefined) {
    setOverlay({ selectedTile: tile, selectedUnitId: null, reachable: [], path: [], workedTiles: city.own?.worked ?? [] });
  } else {
    setOverlay({ selectedTile: null, selectedUnitId: null, reachable: [], path: [], workedTiles: [] });
  }
}

// ---- Input: the same few lines as the map test page -----------------------
const DRAG_THRESHOLD = 4;
let pressed: { x: number; y: number; dragging: boolean } | null = null;

canvas.addEventListener('pointerdown', (event) => {
  pressed = { x: event.clientX, y: event.clientY, dragging: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (pressed === null) {
    const tile = renderer.tileAt({ x: event.clientX, y: event.clientY });
    const path = tile !== null && overlay.reachable.includes(tile) ? [tile] : [];
    setOverlay({ hoverTile: tile, path });
    return;
  }
  const dx = event.clientX - pressed.x;
  const dy = event.clientY - pressed.y;
  if (!pressed.dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
  pressed.dragging = true;
  renderer.panBy(dx, dy);
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
    renderer.zoomBy(event.deltaY < 0 ? 1 : -1, { x: event.clientX, y: event.clientY });
  },
  { passive: false },
);
