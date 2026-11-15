/**
 * The map renderer (work package WP5): draws a PlayerView on a canvas.
 *
 * The only things the rest of the client uses from src/render/ and
 * src/sprites/ are `createMapRenderer` and the types in api.ts.
 *
 * To look at the renderer on its own, run the dev server and open
 * /dev-map.html (src/dev/mapHarness.ts): the sample view with drag, wheel
 * and click wired to the seam in api.ts.
 */

import { inBounds, isValidTile, tileCoord, tileIndex } from '@domination/shared';
import type { CityView, CivId, PlayerId, PlayerView } from '@domination/shared';
import { context2d } from '../sprites/canvas';
import { createTextSpriteSheet } from '../sprites/spriteSheet';
import { EMPTY_OVERLAY } from './api';
import type { MapOverlay, MapRenderer, ScreenPoint, ScreenRect } from './api';
import { backingStoreSize } from './backingStore';
import type { PixelSize } from './backingStore';
import { createBannerCache } from './bannerCache';
import { artToDevice, clampCamera, deviceToArt, snapCamera, startZoom, zoomCamera, zoomRange, zoomStep } from './camera';
import type { Camera, Viewport } from './camera';
import { drawFrame } from './frame';
import { TILE_HEIGHT, TILE_WIDTH, pixelToTile, tileCenter, tileOrigin } from './geometry';
import { civsByPlayer } from './owners';
import { citiesInDrawingOrder, unitDrawings } from './scene';
import type { UnitDrawing } from './scene';
import { slideOffset, startSlides } from './slide';
import type { Slide } from './slide';
import { createTerrainLayer } from './terrainLayer';

/**
 * Creates the renderer for one canvas element. The canvas is sized by CSS
 * (WP4 makes it fill the game screen) and is ALREADY IN THE DOCUMENT when
 * this is called. It is measured right here, synchronously
 * (canvas.getBoundingClientRect()), and again at the start of every call
 * that depends on its size or position (`measure` below); the renderer never
 * needs to be told about a resize. A ResizeObserver watches it as well, but
 * it alone would not do: it reports a new size only while the browser makes
 * the next frame, and WP4 calls setView and centerOn straight after creating
 * the renderer, and the end-to-end test asks where a tile is straight after
 * resizing the window.
 * See the two "not ready yet" rules at the top of api.ts.
 *
 * PIXELS
 *  - Canvas 2D, `imageSmoothingEnabled = false` everywhere.
 *  - The backing store matches the device pixels of the canvas box.
 *  - Zoom is a whole number of DEVICE pixels per art pixel (so sprites are
 *    integer-scaled and crisp on any display); the first zoom shows roughly
 *    3 CSS pixels per art pixel; range about 1x to 6x CSS scale; one zoom
 *    step is about 1 CSS pixel per art pixel (camera.ts `zoomStep`).
 *  - The camera position is snapped to whole device pixels when drawing.
 *
 * WHEN TO DRAW
 *  - Redraw only when something changed (view, overlay, camera, size) or an
 *    animation is running: keep a dirty flag and draw at most once per
 *    animation frame. Never run an idle loop.
 *  - One exception to "at the next animation frame": when the browser
 *    reports a new size (ResizeObserver) it paints right afterwards, and a
 *    resized canvas is empty. The frame is drawn in that moment, so the map
 *    never blinks while a window is being resized.
 *  - Draw only what is on screen. Ground, borders, features and
 *    improvements (steps 2-4 below) are painted once per view onto an
 *    offscreen picture (terrainLayer.ts), and a frame copies only the
 *    visible part of it; highlights, cities, units and signs on tiles
 *    outside the screen are skipped (camera.ts `visibleTileRange`).
 *
 * THE FOG LOOK. A tile that is explored but not `visible` is "fogged":
 * everything drawn for it is blended 45% towards '#22223a'. Sprites may
 * stick out of their hexagon (tall mountains, city roofs), so the fog cannot
 * be one hexagon laid over the tile afterwards: the part sticking out would
 * stay bright. Every sprite has a fogged twin instead (rasterised a second
 * time with the blend applied, sprites/looks.ts), and the twin is drawn for
 * things on fogged tiles.
 *
 * WHAT IS DRAWN, back to front (hex shapes always from geometry.ts):
 *  1. Background '#22223a'. Never-seen tiles (null) are simply not drawn.
 *  2. Ground of every explored tile: the terrain's ground sprite (fogged
 *     twin on fogged tiles), with the hex grid only faintly hinted (as in
 *     the reference picture). A terrain has a few variants, picked by tile
 *     index; under a feature the ground is bare, as in the reference, and
 *     under an improvement too (no tuft pokes out between a farm's fields).
 *  3. Territory borders (borders.ts): along each edge of an owned tile whose
 *     neighbor has a different owner, a strip INSIDE the tile: 2 px of the
 *     owner's primary colour at the edge and 1 px of the secondary colour
 *     inside it. No colour wash over the tile. "A different owner" includes:
 *     no owner, a never-seen neighbor (null), and NO neighbor at all (the
 *     edge of the map), so every territory is closed all the way round. On
 *     fogged tiles the strip gets the fog look too.
 *  4. Features (forest, hills, mountains) and improvements (farm, mine),
 *     row by row from the top, so that tall things overlap the row behind
 *     them (fogged twin on fogged tiles). On one tile the feature comes
 *     first and the improvement on top of it: a mine stands on its hills.
 *     Hills and mountains come in a version for the ground they stand on,
 *     and so does a farm (its crop differs). An improvement on a fogged
 *     tile is the one the player last saw there (TileView.improvement).
 *  5. Highlights from the overlay (sprites/art/markers.ts), in this order:
 *     reachable tiles (a white ring and a light wash: unmistakable on every
 *     ground), the path preview (a dotted line from the selected tile, with
 *     a ring on the tile where the unit will stop), worked tiles (a small
 *     gold token in the middle of each tile of overlay.workedTiles), the
 *     selection ring, the hover outline.
 *  6. Cities, then units, row by row from the top, in their owner's colours
 *     (scene.ts). A remembered city (CityView.visible false) stands on a
 *     fogged tile and is drawn with its fogged twin. On a tile with two
 *     units the civilian stands offset behind the military unit, unless
 *     overlay.selectedUnitId says otherwise; on a city tile units stand
 *     beside the hall. Own units that will not move this turn are drawn
 *     dimmed: those with no moves left and those at work. Two small signs
 *     are drawn from the view alone (the overlay knows nothing of them):
 *     - "at work", a white square with a dark hammer, left of an own unit
 *       that has a job (UnitView.own.job), right after the unit itself and
 *       always inside the unit's own tile (scene.ts `workingSignOffset`);
 *     - "builds nothing", a gold sign with a dark exclamation mark, at the
 *       upper left of the hall of an own city whose build queue is empty
 *       (scene.ts `cityIsIdle`), right under the name banner; after all
 *       units, so that a unit standing in the city never hides it.
 *     Neither is ever drawn for another player's unit or city: their jobs
 *     and queues are not in the view.
 *  7. City banners in the pixel font (banner.ts): the name (upper case) and
 *     the population, written in the owner's SECONDARY colour
 *     (CIVS[civ].secondary) on a plate of the owner's PRIMARY colour with a
 *     '#22223a' frame (as data/civs.ts says; all six pairs read well this
 *     way round). A dark line separates name and population. The banner of a
 *     remembered city gets the fog look. Text is drawn at a whole-number
 *     scale: max(1, ceil(zoom / 2)) device pixels per font pixel. (The
 *     scaffold said floor; see `bannerScale` in banner.ts for why it is
 *     rounded up.) The frame is one art pixel thick.
 *
 * ANIMATION is purely cosmetic: a short slide when a unit that existed in
 * the previous view has a new tile in the next one (slide.ts). Nothing
 * depends on it, and hit testing always uses the real positions. It is
 * left out for players who asked their system for reduced motion.
 *
 * @param canvas  the canvas to draw on (WP4 creates it, gives it
 *                `touch-action: none` so touch gestures reach the app, and
 *                appends it to the page before calling this)
 */
export function createMapRenderer(canvas: HTMLCanvasElement): MapRenderer {
  const context = context2d(canvas);
  const sheet = createTextSpriteSheet();
  const terrain = createTerrainLayer(sheet);
  const banners = createBannerCache();

  let view: PlayerView | null = null;
  let overlay: MapOverlay = EMPTY_OVERLAY;

  // ---- Where the canvas is and how big, measured, never assumed ----------
  /** The canvas box on screen in CSS pixels (`locate`). */
  let box = { left: 0, top: 0, width: 0, height: 0 };
  /** The backing store in device pixels (`fit`). */
  let viewport: Viewport = { width: 0, height: 0 };
  /** The size of the canvas box (CSS pixels) that the backing store was last fitted to (`fit`). */
  let fittedBox = { width: 0, height: 0 };
  let pixelRatio = window.devicePixelRatio || 1;
  let camera: Camera = { x: 0, y: 0, zoom: startZoom(pixelRatio) };

  // ---- Things worked out from the view, kept until it changes ------------
  let civs = new Map<PlayerId, CivId>();
  let cities: CityView[] = [];
  let units: UnitDrawing[] = [];
  /** True when `units` must be worked out again (new view, or another unit selected). */
  let unitsStale = false;
  /** True when the terrain picture must be brought up to date before the next frame (new view). */
  let terrainStale = false;
  let slides: Slide[] = [];

  let frameRequest: number | null = null;
  let destroyed = false;

  // ---- Telling the app shell when tiles have moved on screen -------------
  /** Who wants to be told (onCameraChange). Replaced, never edited, so a listener may remove itself while being called. */
  let cameraListeners: (() => void)[] = [];
  /** Where tiles were on screen when the listeners were last told (`placement`), as one string. */
  let reportedPlacement = '';

  /** Reads where the canvas is on screen. Cheap. */
  function locate(): void {
    const rect = canvas.getBoundingClientRect();
    box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  /**
   * Brings `box`, `viewport` and the camera up to date with the canvas as it
   * is on screen NOW. Every call from outside that depends on the size or
   * the position of the canvas starts with this.
   *
   * Waiting for the ResizeObserver is not enough: the browser tells it about
   * a new size only while it makes the next frame. A call that came in
   * before that (the window was resized, and the very next thing is "where
   * is this tile?") used to be answered for the canvas as it was, and a
   * click on that spot landed on another tile.
   */
  function measure(): void {
    locate();
    const ratio = window.devicePixelRatio || 1;
    if (box.width !== fittedBox.width || box.height !== fittedBox.height || ratio !== pixelRatio) fit();
  }

  /** Device pixels per CSS pixel on this canvas, as measured (close to devicePixelRatio). */
  function pixelsPerCss(): number {
    return box.width > 0 ? viewport.width / box.width : pixelRatio;
  }

  /**
   * Fits the backing store to the canvas box as `locate` last read it: one
   * canvas pixel per device pixel. `reported` is the size in device pixels
   * when the browser reports it (ResizeObserver); see backingStore.ts for
   * how far it is trusted.
   */
  function fit(reported?: PixelSize): void {
    fittedBox = { width: box.width, height: box.height };
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = backingStoreSize(box, ratio, reported);
    const changed = viewport.width !== width || viewport.height !== height || ratio !== pixelRatio;
    if (!changed) return;
    // Setting a canvas's size wipes it, even to the size it has: only do it for a real change.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    viewport = { width, height };

    if (ratio !== pixelRatio) {
      // Another display, or the browser's own zoom: keep the map the same
      // size on screen, on the new display's whole-pixel zoom steps.
      const range = zoomRange(ratio);
      const zoom = Math.round((camera.zoom * ratio) / pixelRatio);
      camera = { ...camera, zoom: Math.min(range.max, Math.max(range.min, zoom)) };
      pixelRatio = ratio;
    }
    keepCameraOnMap();
    requestDraw();
  }

  function keepCameraOnMap(): void {
    // A canvas of no size (hidden for a moment) tells nothing; leave the camera alone.
    if (view === null || viewport.width === 0 || viewport.height === 0) return;
    camera = clampCamera(camera, viewport, view);
  }

  /** A screen point (CSS pixels of the browser window) in device pixels of the canvas. */
  function toDevice(point: ScreenPoint): { x: number; y: number } {
    const scale = pixelsPerCss();
    return { x: (point.x - box.left) * scale, y: (point.y - box.top) * scale };
  }

  /**
   * Everything that decides where a tile is on screen, as one string: the
   * canvas box, the camera as drawn, the pixel scale and the size of the
   * map (0 x 0 without a view). Two equal strings mean no tile has moved.
   */
  function placement(): string {
    const drawn = snapCamera(camera);
    return [
      box.left, box.top, box.width, box.height,
      drawn.x, drawn.y, drawn.zoom,
      pixelsPerCss(),
      view === null ? 0 : view.width, view === null ? 0 : view.height,
    ].join(',');
  }

  /**
   * Tells the listeners of onCameraChange if tiles are somewhere else on
   * screen than when they were last told, and only then. The last thing in
   * every call that can move the camera (setView, panBy, zoomBy, centerOn)
   * and in the size report of the browser. The questions (tileAt,
   * tileToScreen, tileScreenRect) never call it: a question must not fire
   * call-backs. If one of them notices a new canvas size, the browser's
   * report in the same frame tells the listeners.
   */
  function reportCamera(): void {
    const now = placement();
    if (now === reportedPlacement) return;
    reportedPlacement = now;
    for (const listener of cameraListeners.slice()) listener();
  }

  // ---- Drawing: at most once per animation frame, and only when asked ----

  function requestDraw(): void {
    if (destroyed || frameRequest !== null) return;
    frameRequest = requestAnimationFrame(drawRequestedFrame);
  }

  /** Draws the frame that `requestDraw` asked for. */
  function drawRequestedFrame(now: number): void {
    frameRequest = null;
    draw(now);
    if (slides.length > 0) requestDraw(); // an animation is running: keep going until it is over
  }

  /** If a frame has been asked for, draws it now instead of at the next animation frame. */
  function drawWithoutWaiting(): void {
    if (frameRequest === null) return;
    cancelAnimationFrame(frameRequest);
    drawRequestedFrame(performance.now());
  }

  function draw(now: number): void {
    if (viewport.width === 0 || viewport.height === 0) return;

    if (view !== null && terrainStale) {
      terrain.update(view, civs); // paints only what differs from the last view
      terrainStale = false;
    }
    if (view !== null && unitsStale) {
      units = unitDrawings(view, overlay.selectedUnitId);
      unitsStale = false;
    }

    const slideOffsets = new Map<string, { dx: number; dy: number }>();
    slides = slides.filter((slide) => {
      const offset = slideOffset(slide, now);
      if (offset !== null) slideOffsets.set(slide.unitId, offset);
      return offset !== null;
    });

    drawFrame(context, {
      viewport,
      camera: snapCamera(camera),
      view,
      overlay,
      terrain: terrain.canvas,
      sheet,
      banners,
      civs,
      cities,
      units,
      slideOffsets,
    });
  }

  // ---- Start: measure now (api.ts, rule 1), then watch for size changes --

  // The ResizeObserver is there for two things `measure` cannot do: the
  // exact size in device pixels, and a redraw when the size changes while
  // nobody is calling the renderer (the player drags the window wider).
  const observer = new ResizeObserver((entries) => {
    const exact = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0];
    locate();
    fit(exact === undefined ? undefined : { width: exact.inlineSize, height: exact.blockSize });
    // The browser paints right after this, and a canvas that has just been
    // given a new size is empty. Draw it now: at the next animation frame
    // the map would already have been missing from the screen for a frame.
    drawWithoutWaiting();
    reportCamera();
  });
  try {
    // The size in real device pixels, where the browser can report it: the
    // only way to get a backing store that is never a fraction of a pixel off.
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }
  measure();
  // Where things are at the start: only a change from here on is reported.
  reportedPlacement = placement();

  return {
    setView(next) {
      if (next === view) return;
      const previous = view;
      view = next;
      if (next === null) {
        civs = new Map();
        cities = [];
        units = [];
        slides = [];
      } else {
        civs = civsByPlayer(next);
        cities = citiesInDrawingOrder(next);
        unitsStale = true;
        terrainStale = true;
        slides = previous === null || prefersReducedMotion() ? [] : startSlides(previous, next, performance.now());
        const sameMap = previous !== null && previous.width === next.width && previous.height === next.height;
        if (!sameMap) keepCameraOnMap();
      }
      requestDraw();
      reportCamera();
    },

    setOverlay(next) {
      if (next === overlay) return;
      if (next.selectedUnitId !== overlay.selectedUnitId) unitsStale = true;
      overlay = next;
      requestDraw();
    },

    panBy(dx, dy) {
      if (view === null) return;
      measure();
      const scale = pixelsPerCss() / camera.zoom; // art pixels per CSS pixel
      camera = { ...camera, x: camera.x - dx * scale, y: camera.y - dy * scale };
      keepCameraOnMap();
      requestDraw();
      reportCamera();
    },

    zoomBy(steps, anchor) {
      if (view === null) return;
      measure();
      const fixed = anchor === undefined ? { x: viewport.width / 2, y: viewport.height / 2 } : toDevice(anchor);
      // Start from the camera as drawn, so the pixel under the pointer is the one that stays.
      const deviceSteps = Math.round(steps) * zoomStep(pixelRatio);
      camera = zoomCamera(snapCamera(camera), deviceSteps, fixed, zoomRange(pixelRatio), viewport, view);
      requestDraw();
      reportCamera();
    },

    centerOn(tile) {
      if (view === null || !isValidTile(tile, view)) return;
      measure();
      const center = tileCenter(tileCoord(tile, view));
      camera = {
        ...camera,
        x: center.px - viewport.width / camera.zoom / 2,
        y: center.py - viewport.height / camera.zoom / 2,
      };
      keepCameraOnMap();
      requestDraw();
      reportCamera();
    },

    tileAt(point) {
      if (view === null) return null;
      measure();
      const inside =
        point.x >= box.left && point.x < box.left + box.width && point.y >= box.top && point.y < box.top + box.height;
      if (!inside) return null;
      const art = deviceToArt(snapCamera(camera), toDevice(point));
      const coord = pixelToTile(art.px, art.py);
      return inBounds(coord, view) ? tileIndex(coord, view) : null;
    },

    tileToScreen(tile) {
      if (view === null) throw new Error('tileToScreen: there is no view yet');
      if (!isValidTile(tile, view)) throw new Error(`tileToScreen: ${tile} is not a tile of this map`);
      measure();
      const device = artToDevice(snapCamera(camera), tileCenter(tileCoord(tile, view)));
      const scale = pixelsPerCss();
      return { x: box.left + device.x / scale, y: box.top + device.y / scale };
    },

    tileScreenRect(tile): ScreenRect {
      if (view === null) throw new Error('tileScreenRect: there is no view yet');
      if (!isValidTile(tile, view)) throw new Error(`tileScreenRect: ${tile} is not a tile of this map`);
      measure();
      const topLeft = artToDevice(snapCamera(camera), tileOrigin(tileCoord(tile, view)));
      const scale = pixelsPerCss();
      const left = box.left + topLeft.x / scale;
      const top = box.top + topLeft.y / scale;
      return {
        left,
        top,
        right: left + (TILE_WIDTH * camera.zoom) / scale,
        bottom: top + (TILE_HEIGHT * camera.zoom) / scale,
      };
    },

    onCameraChange(listener) {
      cameraListeners = [...cameraListeners, listener];
      return () => {
        cameraListeners = cameraListeners.filter((other) => other !== listener);
      };
    },

    destroy() {
      destroyed = true;
      cameraListeners = [];
      observer.disconnect();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null;
    },
  };
}

/** Has the player asked their system for less motion? Then units jump instead of sliding. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
