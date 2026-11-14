import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAP_SIZES, tileCoord, tileCount, tileIndex } from '@domination/shared';
import type { PlayerView, TileIndex, TileView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { EMPTY_OVERLAY } from '../src/render/api';
import type { MapRenderer } from '../src/render/api';
import { backingStoreSize } from '../src/render/backingStore';
import { CAMERA_MARGIN } from '../src/render/camera';
import { TILE_HEIGHT, TILE_WIDTH, tileOrigin } from '../src/render/geometry';
import { createMapRenderer } from '../src/render/renderer';
import { SLIDE_MS } from '../src/render/slide';
import { LAYER_PADDING } from '../src/render/terrainLayer';
import { PALETTE } from '../src/sprites/palette';
import { createTextSpriteSheet } from '../src/sprites/spriteSheet';
import type { Sprite, SpriteSheet } from '../src/sprites/spriteSheet';
import { installFakeBrowser } from './renderFakeCanvas';
import type { DrawCall, FakeBrowser, FakeCanvas } from './renderFakeCanvas';

/**
 * The renderer as the app shell uses it (WP5): the contract of
 * src/render/api.ts, tested against a stand-in browser that records what is
 * drawn (renderFakeCanvas.ts). What is tested here is what the renderer
 * DOES (camera, hit testing, when it draws, which sprite goes where); how
 * the result looks is checked by eye.
 */

const BOX = { left: 100, top: 50, width: 800, height: 600 };

/** A fully explored, fully visible map of grassland: nothing but the camera matters. */
function grassView(width: number, height: number): PlayerView {
  const tiles: (TileView | null)[] = [];
  for (let tile = 0; tile < width * height; tile++) tiles.push({ terrain: 'grassland', feature: null, owner: null, visible: true });
  return { you: 'p1', turn: 1, width, height, tiles, units: [], cities: [], players: [{ id: 'p1', name: 'Ada', civ: 'rome', endedTurn: false }] };
}
const LARGE = grassView(MAP_SIZES.large.width, MAP_SIZES.large.height);
const MIDDLE: TileIndex = tileIndex({ x: 28, y: 18 }, LARGE);

let browser: FakeBrowser;
let canvas: FakeCanvas;
let renderer: MapRenderer;

function start(devicePixelRatio = 1): void {
  browser = installFakeBrowser({ devicePixelRatio });
  canvas = browser.createCanvas(BOX);
  renderer = createMapRenderer(canvas.element);
}

afterEach(() => {
  browser.uninstall();
});

function insideBox(point: { x: number; y: number }): boolean {
  return point.x >= BOX.left && point.x < BOX.left + BOX.width && point.y >= BOX.top && point.y < BOX.top + BOX.height;
}

/** The drawImage calls on a canvas that copied this sprite (found by its place on the sprite sheet). */
function drawsOf(calls: DrawCall[], sprite: Sprite): number[][] {
  return calls
    .filter((call) => call.method === 'drawImage' && call.args.length === 9)
    .map((call) => call.args.slice(1) as number[])
    .filter(([sx, sy, width, height]) => sx === sprite.sx && sy === sprite.sy && width === sprite.width && height === sprite.height);
}

/** Runs the pending frame and returns only what that frame drew on the main canvas. */
function nextFrame(): DrawCall[] {
  const before = canvas.calls.length;
  browser.runFrames();
  return canvas.calls.slice(before);
}

describe('createMapRenderer: before there is a view (api.ts, rule 2)', () => {
  beforeEach(() => start());

  it('panBy, zoomBy and centerOn do nothing, tileAt returns null and tileToScreen throws', () => {
    expect(() => {
      renderer.panBy(10, 10);
      renderer.zoomBy(1);
      renderer.zoomBy(-1, { x: 300, y: 300 });
      renderer.centerOn(0);
      renderer.setOverlay(EMPTY_OVERLAY);
    }).not.toThrow();
    expect(renderer.tileAt({ x: 300, y: 300 })).toBeNull();
    expect(() => renderer.tileToScreen(0)).toThrow();

    // ... and they left no trace: the first view is shown as if they had never been called.
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const withCalls = renderer.tileToScreen(MIDDLE);
    const fresh = createMapRenderer(browser.createCanvas(BOX).element);
    fresh.setView(LARGE);
    fresh.centerOn(MIDDLE);
    expect(fresh.tileToScreen(MIDDLE)).toEqual(withCalls);
  });

  it('is the same again after setView(null)', () => {
    renderer.setView(LARGE);
    expect(renderer.tileAt({ x: 300, y: 300 })).not.toBeNull();
    renderer.setView(null);
    expect(renderer.tileAt({ x: 300, y: 300 })).toBeNull();
    expect(() => renderer.tileToScreen(0)).toThrow();
    expect(() => renderer.panBy(5, 5)).not.toThrow();
    // An empty map is drawn: just the dark background.
    const frame = nextFrame();
    expect(frame.filter((call) => call.method === 'drawImage')).toEqual([]);
    expect(frame.some((call) => call.method === 'fillRect' && call.fillStyle === PALETTE.outline)).toBe(true);
  });
});

describe('createMapRenderer: size (api.ts, rule 1)', () => {
  it('measures the canvas at once: setView followed by centerOn puts the tile in the middle of the real canvas', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const point = renderer.tileToScreen(MIDDLE);
    // Within half a device pixel (the camera is snapped to whole pixels).
    expect(Math.abs(point.x - (BOX.left + BOX.width / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(point.y - (BOX.top + BOX.height / 2))).toBeLessThanOrEqual(0.5);
    expect(renderer.tileAt(point)).toBe(MIDDLE);
  });

  it('gives the canvas one backing-store pixel per device pixel', () => {
    start(2);
    expect([canvas.element.width, canvas.element.height]).toEqual([1600, 1200]);
    browser.uninstall();
    start(1.5);
    expect([canvas.element.width, canvas.element.height]).toEqual([1200, 900]);
  });

  it('draws on a canvas that already has the size it needs (300 x 150, what every new canvas starts with)', () => {
    browser = installFakeBrowser({ devicePixelRatio: 1 });
    canvas = browser.createCanvas({ left: 0, top: 0, width: 300, height: 150 });
    renderer = createMapRenderer(canvas.element);
    renderer.setView(LARGE);
    const frame = nextFrame();
    expect(frame.some((call) => call.method === 'fillRect' && String(call.args) === '0,0,300,150')).toBe(true);
    expect(frame.some((call) => call.method === 'drawImage')).toBe(true);
  });

  it('does not draw again when the ResizeObserver reports the size the canvas already has', () => {
    start();
    browser.runFrames();
    const drawn = canvas.calls.length;
    browser.fireResize();
    browser.fireResize({ width: 800, height: 600 });
    expect(browser.pendingFrames()).toBe(0);
    expect(canvas.calls.length).toBe(drawn); // neither later nor there and then
  });

  it('follows the ResizeObserver: the exact device-pixel size if the browser reports it, otherwise CSS size times ratio', () => {
    start(1.5);
    // A box that is a fraction of a device pixel wide: 800.5 x 1.5 = 1200.75. Rounding says 1201; the browser knows it is 1200.
    canvas.setBox({ ...BOX, width: 800.5 });
    browser.fireResize({ width: 1200, height: 900 });
    expect([canvas.element.width, canvas.element.height]).toEqual([1200, 900]);

    // No report: CSS size times ratio, rounded.
    canvas.setBox({ left: 0, top: 0, width: 333, height: 222 });
    const drawnBefore = canvas.calls.length;
    browser.fireResize();
    expect([canvas.element.width, canvas.element.height]).toEqual([Math.round(333 * 1.5), Math.round(222 * 1.5)]);
    // A resized canvas is blank: it must be drawn again, and it was, there and then
    // (see "no frame with an empty canvas" below; this used to wait for the next animation frame).
    expect(canvas.calls.length).toBeGreaterThan(drawnBefore);
    expect(browser.pendingFrames()).toBe(0);

    // A report that cannot be right (device emulation reports the size as if the ratio were 1) is not believed.
    browser.fireResize({ width: 333, height: 222 });
    expect([canvas.element.width, canvas.element.height]).toEqual([Math.round(333 * 1.5), Math.round(222 * 1.5)]);
  });

  it('backingStoreSize: one pixel per device pixel, trusting the browser\'s report only within a pixel', () => {
    start();
    expect(backingStoreSize({ width: 800, height: 600 }, 1)).toEqual({ width: 800, height: 600 });
    expect(backingStoreSize({ width: 800, height: 600 }, 2)).toEqual({ width: 1600, height: 1200 });
    expect(backingStoreSize({ width: 1001, height: 701 }, 1.5)).toEqual({ width: 1502, height: 1052 });
    expect(backingStoreSize({ width: 1001, height: 701 }, 1.5, { width: 1501, height: 1051 })).toEqual({ width: 1501, height: 1051 });
    expect(backingStoreSize({ width: 1001, height: 701 }, 1.5, { width: 1001, height: 701 })).toEqual({ width: 1502, height: 1052 });
    // Each direction is judged on its own.
    expect(backingStoreSize({ width: 1001, height: 701 }, 1.5, { width: 1501, height: 3 })).toEqual({ width: 1501, height: 1052 });
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 0, height: 0 });
  });

  it('keeps the map the same size on screen when the device pixel ratio changes', () => {
    start(1);
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const spacing = (): number => renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x;
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 3, 6); // the game starts at 3 CSS pixels per art pixel

    browser.setDevicePixelRatio(2);
    browser.fireResize();
    expect(canvas.element.width).toBe(1600);
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 3, 6);
  });

  it('survives a canvas of no size (a hidden screen): no drawing, no error, and the camera is still there afterwards', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const before = renderer.tileToScreen(MIDDLE);
    browser.runFrames();

    canvas.setBox({ left: 0, top: 0, width: 0, height: 0 });
    browser.fireResize();
    expect(nextFrame()).toEqual([]);
    expect(renderer.tileAt({ x: 300, y: 300 })).toBeNull();
    expect(() => renderer.panBy(1, 1)).not.toThrow();

    canvas.setBox(BOX);
    browser.fireResize();
    const after = renderer.tileToScreen(MIDDLE);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  });
});

/**
 * A browser tells a ResizeObserver about a new size only while it is making
 * the next frame. Until then the renderer used to work with the old size:
 * asked "where is this tile?" right after the window had changed, it
 * answered for a canvas that was no longer there, and a click on that spot
 * hit another tile. (That is how the end-to-end test failed once in 35
 * runs, in the step that makes the window low.) Now every call that depends
 * on the size measures the canvas first.
 */
describe('createMapRenderer: a resize is taken in at once, not a frame later', () => {
  /** The map area of a phone held sideways (844 x 390 with the top bar taken off): the window of the end-to-end test's step 10. */
  const LOW = { left: 0, top: 44, width: 844, height: 346 };

  /** Where a few tiles are and which tiles are under a few points: enough to tell two cameras apart. */
  function answersOf(map: MapRenderer): unknown {
    const tiles = [MIDDLE, MIDDLE + 1, MIDDLE - 3, MIDDLE + LARGE.width, MIDDLE - 2 * LARGE.width];
    const points = [
      { x: LOW.left + 1, y: LOW.top + 1 },
      { x: LOW.left + LOW.width / 2, y: LOW.top + LOW.height / 2 },
      { x: LOW.left + LOW.width - 2, y: LOW.top + LOW.height - 2 },
      { x: LOW.left + 300.5, y: LOW.top + 77.25 },
    ];
    return { places: tiles.map((tile) => map.tileToScreen(tile)), hits: points.map((point) => map.tileAt(point)) };
  }

  it('centerOn straight after the window changed puts the tile in the middle of the NEW canvas, and it stays there', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    browser.runFrames();

    // The window changes, and the very next thing is a question to the renderer.
    canvas.setBox(LOW);
    renderer.centerOn(MIDDLE);
    const point = renderer.tileToScreen(MIDDLE);
    expect(Math.abs(point.x - (LOW.left + LOW.width / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(point.y - (LOW.top + LOW.height / 2))).toBeLessThanOrEqual(0.5);
    expect(renderer.tileAt(point)).toBe(MIDDLE);
    expect([canvas.element.width, canvas.element.height]).toEqual([LOW.width, LOW.height]);

    // A frame later the browser reports the new size. Nothing moves: a click on `point` still finds the tile.
    browser.runFrames();
    browser.fireResize({ width: LOW.width, height: LOW.height });
    expect(renderer.tileToScreen(MIDDLE)).toEqual(point);
    expect(renderer.tileAt(point)).toBe(MIDDLE);
  });

  it('a resize alone moves nothing: a tile keeps its distance from the top-left corner of the canvas', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE); // 400 to the right of and 300 below the corner of the 800 x 600 canvas
    canvas.setBox(LOW);
    const point = renderer.tileToScreen(MIDDLE);
    expect(Math.abs(point.x - (LOW.left + 400))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(point.y - (LOW.top + 300))).toBeLessThanOrEqual(0.5);
    expect(renderer.tileAt(point)).toBe(MIDDLE);
  });

  const firstCalls: [string, (map: MapRenderer) => void][] = [
    ['tileAt', (map) => void map.tileAt({ x: 200, y: 200 })],
    ['tileToScreen', (map) => void map.tileToScreen(MIDDLE)],
    ['centerOn', (map) => map.centerOn(MIDDLE + 5)],
    ['panBy', (map) => map.panBy(31, -12)],
    ['panBy as far as the map goes (it stops where the new size says)', (map) => map.panBy(1e6, 1e6)],
    ['zoomBy with no anchor (the middle of the canvas stays)', (map) => map.zoomBy(1)],
    ['zoomBy around a point', (map) => map.zoomBy(-1, { x: 610, y: 120 })],
  ];

  it.each(firstCalls)('whatever is called first after the resize answers for the new size: %s', (_name, firstCall) => {
    browser = installFakeBrowser({ devicePixelRatio: 1 });
    /** A renderer that has looked at the map for a while, in the usual 800 x 600 box. */
    const make = (): { map: MapRenderer; fake: FakeCanvas } => {
      const fake = browser.createCanvas(BOX);
      const map = createMapRenderer(fake.element);
      map.setView(LARGE);
      map.centerOn(MIDDLE);
      map.panBy(-13, 7);
      return { map, fake };
    };

    // `told` hears of the new size the slow way, from its ResizeObserver, before it is called.
    const told = make();
    told.fake.setBox(LOW);
    browser.fireResize();
    // `asked` is called before its ResizeObserver has said anything.
    const asked = make();
    asked.fake.setBox(LOW);

    firstCall(told.map);
    firstCall(asked.map);
    // The call itself measured the canvas (its pixels are the new size already) ...
    expect([asked.fake.element.width, asked.fake.element.height]).toEqual([LOW.width, LOW.height]);
    // ... so it worked with the same numbers as the renderer that had been told.
    expect(answersOf(asked.map)).toEqual(answersOf(told.map));

    // The late report changes nothing for either of them.
    const before = answersOf(asked.map);
    browser.fireResize();
    expect(answersOf(asked.map)).toEqual(before);
    expect(answersOf(told.map)).toEqual(before);
  });

  it('takes a new device pixel ratio in at once as well (the window was dragged to another display)', () => {
    start(1);
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const before = renderer.tileToScreen(MIDDLE);
    const spacing = (): number => renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x;

    browser.setDevicePixelRatio(2); // and no word from the ResizeObserver
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 3, 6); // the map keeps its size on screen
    expect([canvas.element.width, canvas.element.height]).toEqual([1600, 1200]); // on twice the pixels
    expect(Math.abs(renderer.tileToScreen(MIDDLE).x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(renderer.tileToScreen(MIDDLE).y - before.y)).toBeLessThanOrEqual(0.5);
  });

  it('keeps the exact size the browser reported: measuring again does not round it differently', () => {
    start(1.5);
    // 800.5 x 1.5 = 1200.75. Rounding says 1201; the browser knows it is 1200 (see "follows the ResizeObserver" above).
    canvas.setBox({ ...BOX, width: 800.5 });
    browser.fireResize({ width: 1200, height: 900 });
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    renderer.tileAt({ x: 300, y: 300 });
    renderer.panBy(5, 5);
    expect(canvas.element.width).toBe(1200);
  });

  // Giving a canvas a new size wipes it. The browser paints right after it
  // has told the ResizeObserver, so the map must be back by then: drawn in
  // that very moment, not at the next animation frame (one frame of nothing
  // but background at every step of a window being dragged wider).
  it('is drawn again in the same moment the browser reports a new size: no frame with an empty canvas', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    browser.runFrames();
    const drawnBefore = canvas.calls.length;

    canvas.setBox(LOW);
    browser.fireResize({ width: LOW.width, height: LOW.height });
    const drawn = canvas.calls.slice(drawnBefore);
    const fills = drawn.filter((call) => call.method === 'fillRect' && call.fillStyle === PALETTE.outline);
    expect(fills.map((call) => call.args)).toEqual([[0, 0, LOW.width, LOW.height]]); // one whole frame, at the new size
    expect(drawn.some((call) => call.method === 'drawImage')).toBe(true); // with the map on it
    expect(browser.pendingFrames()).toBe(0); // and it is not drawn a second time
    expect(browser.runFrames()).toBe(0);
  });

  it('a canvas that a call has just resized is drawn at the next frame, or when the browser reports the size, whichever comes first, and once', () => {
    start();
    renderer.setView(LARGE);
    browser.runFrames();

    // The next animation frame comes first.
    canvas.setBox(LOW);
    renderer.tileAt({ x: 200, y: 200 }); // resizes (and so wipes) the canvas
    expect(browser.pendingFrames()).toBe(1);
    const atNextFrame = nextFrame().filter((call) => call.method === 'fillRect' && call.fillStyle === PALETTE.outline);
    expect(atNextFrame.map((call) => call.args)).toEqual([[0, 0, LOW.width, LOW.height]]);
    browser.fireResize({ width: LOW.width, height: LOW.height });
    expect(browser.pendingFrames()).toBe(0);

    // The browser's report comes first (the call was made while the browser was already making a frame).
    canvas.setBox(BOX);
    renderer.tileAt({ x: 200, y: 200 });
    const drawnBefore = canvas.calls.length;
    browser.fireResize({ width: BOX.width, height: BOX.height });
    const atReport = canvas.calls.slice(drawnBefore).filter((call) => call.method === 'fillRect' && call.fillStyle === PALETTE.outline);
    expect(atReport.map((call) => call.args)).toEqual([[0, 0, BOX.width, BOX.height]]);
    expect(browser.pendingFrames()).toBe(0);
    expect(browser.runFrames()).toBe(0);
  });

  it('after destroy a report from the browser draws nothing', () => {
    start();
    renderer.setView(LARGE);
    browser.runFrames();
    renderer.panBy(3, 3); // a frame is waiting
    renderer.destroy();
    const drawn = canvas.calls.length;
    canvas.setBox(LOW);
    browser.fireResize();
    expect(canvas.calls.length).toBe(drawn);
    expect(browser.pendingFrames()).toBe(0);
  });
});

describe('createMapRenderer: camera and hit testing', () => {
  it.each([1, 1.5, 2])('tileAt(tileToScreen(tile)) is the tile for every tile on screen, device pixel ratio %s', (ratio) => {
    start(ratio);
    const view = sampleView();
    renderer.setView(view);
    // A few camera positions, some of them on fractions of a pixel.
    const moves: (() => void)[] = [
      () => renderer.centerOn(4 * 14 + 3),
      () => renderer.panBy(-37.3, 12.6),
      () => renderer.zoomBy(2, { x: 420.5, y: 333.25 }),
      () => renderer.panBy(101.1, -55.5),
      () => renderer.zoomBy(-4),
    ];
    for (const move of moves) {
      move();
      let onScreen = 0;
      for (let tile = 0; tile < tileCount(view); tile++) {
        const point = renderer.tileToScreen(tile);
        if (insideBox(point)) {
          onScreen += 1;
          expect(renderer.tileAt(point), `tile ${tile}`).toBe(tile);
        } else {
          expect(renderer.tileAt(point), `tile ${tile} (off the canvas)`).toBeNull();
        }
      }
      expect(onScreen).toBeGreaterThan(5);
    }
  });

  it('tileAt returns never-seen tiles too, and null outside the canvas or the map', () => {
    start();
    const view = sampleView(); // 14 x 10 tiles
    renderer.setView(view);
    const neverSeen = view.tiles.findIndex((tile) => tile === null);
    expect(neverSeen).toBeGreaterThanOrEqual(0);
    expect(renderer.tileAt(renderer.tileToScreen(neverSeen))).toBe(neverSeen);

    renderer.zoomBy(-2); // 1 CSS pixel per art pixel: the 377 x 226 map has dark space around it on the 800 x 600 canvas
    expect(renderer.tileAt({ x: BOX.left + 5, y: BOX.top + 5 })).toBeNull(); // on the canvas, beside the map
    expect(renderer.tileAt({ x: BOX.left - 1, y: BOX.top + 300 })).toBeNull(); // left of the canvas
    expect(renderer.tileAt({ x: BOX.left + BOX.width, y: BOX.top + 300 })).toBeNull(); // just past its right edge
    expect(renderer.tileAt({ x: BOX.left + 400, y: BOX.top + 300 })).not.toBeNull(); // the middle
    expect(() => renderer.tileToScreen(-1)).toThrow();
    expect(() => renderer.tileToScreen(tileCount(view))).toThrow();
    expect(() => renderer.tileToScreen(1.5)).toThrow();
  });

  it('a map smaller than the canvas can be dragged about, but never off the middle of the canvas', () => {
    start();
    const view = sampleView();
    renderer.setView(view);
    renderer.zoomBy(-2); // 1 CSS pixel per art pixel: the map is 377 x 226, the canvas 800 x 600
    const middle = { x: BOX.left + BOX.width / 2, y: BOX.top + BOX.height / 2 };

    // A small drag simply moves it.
    const before = renderer.tileToScreen(0);
    renderer.panBy(30, -20);
    expect(renderer.tileToScreen(0).x - before.x).toBeCloseTo(30, 6);
    expect(renderer.tileToScreen(0).y - before.y).toBeCloseTo(-20, 6);

    // A wild drag to the lower right stops with the map's top-left corner (and the small margin) at the middle.
    renderer.panBy(1e6, 1e6);
    const first = renderer.tileToScreen(0);
    expect(first.x).toBeCloseTo(middle.x + CAMERA_MARGIN + TILE_WIDTH / 2, 6);
    expect(first.y).toBeCloseTo(middle.y + CAMERA_MARGIN + TILE_HEIGHT / 2, 6);
    // And one to the upper left with its bottom-right corner there.
    renderer.panBy(-1e6, -1e6);
    const last = renderer.tileToScreen(tileCount(view) - 1);
    expect(last.x).toBeLessThan(middle.x);
    expect(last.x).toBeGreaterThan(middle.x - CAMERA_MARGIN - TILE_WIDTH);
    expect(last.y).toBeCloseTo(middle.y - CAMERA_MARGIN - TILE_HEIGHT / 2, 6);
  });

  it('panBy moves the map with the finger, in CSS pixels', () => {
    for (const ratio of [1, 2]) {
      start(ratio);
      renderer.setView(LARGE);
      renderer.centerOn(MIDDLE);
      const before = renderer.tileToScreen(MIDDLE);
      renderer.panBy(10, 0);
      expect(renderer.tileToScreen(MIDDLE).x - before.x).toBeCloseTo(10, 6);
      renderer.panBy(-4, 21);
      const after = renderer.tileToScreen(MIDDLE);
      expect(after.x - before.x).toBeCloseTo(6, 6);
      expect(after.y - before.y).toBeCloseTo(21, 6);
      browser.uninstall();
    }
    start();
  });

  it('panBy stops when the edge of the map (plus a small margin) reaches the middle of the canvas', () => {
    start();
    renderer.setView(LARGE);
    const middle = { x: BOX.left + BOX.width / 2, y: BOX.top + BOX.height / 2 };
    renderer.panBy(1e6, 1e6); // drag the map as far to the lower right as it goes: its top-left corner comes to the middle
    const first = renderer.tileToScreen(0);
    expect(first.x).toBeCloseTo(middle.x + (CAMERA_MARGIN + TILE_WIDTH / 2) * 3, 6);
    expect(first.y).toBeCloseTo(middle.y + (CAMERA_MARGIN + TILE_HEIGHT / 2) * 3, 6);
    renderer.panBy(-1e6, -1e6); // and the other way: the last tile ends up just above and left of the middle
    const last = renderer.tileToScreen(tileCount(LARGE) - 1);
    expect(insideBox(last)).toBe(true);
    expect(last.x).toBeLessThan(middle.x);
    expect(last.x).toBeGreaterThan(middle.x - 150);
    expect(last.y).toBeCloseTo(middle.y - (CAMERA_MARGIN + TILE_HEIGHT / 2) * 3, 6);
  });

  it('centerOn ignores a tile that is not on the map, and centres every tile that is, corners included', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const before = renderer.tileToScreen(MIDDLE);
    renderer.centerOn(-1);
    renderer.centerOn(tileCount(LARGE));
    renderer.centerOn(2.5);
    expect(renderer.tileToScreen(MIDDLE)).toEqual(before);

    // A corner tile really ends up in the middle (within a device pixel), so it can be
    // looked at and tapped clear of the panels that float over the corners of the map.
    for (const corner of [0, LARGE.width - 1, tileCount(LARGE) - LARGE.width, tileCount(LARGE) - 1]) {
      renderer.centerOn(corner);
      const point = renderer.tileToScreen(corner);
      expect(Math.abs(point.x - (BOX.left + BOX.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(point.y - (BOX.top + BOX.height / 2))).toBeLessThanOrEqual(1);
      expect(renderer.tileAt(point)).toBe(corner);
    }
  });

  it('zoomBy changes the zoom by whole steps and keeps the map point under the anchor where it is', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    const spacing = (): number => renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x;
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 3, 6);

    // Zoom in on a tile that is not in the middle of the canvas.
    const target = MIDDLE + 3;
    const anchor = renderer.tileToScreen(target);
    renderer.zoomBy(1, anchor);
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 4, 6);
    expect(renderer.tileAt(anchor)).toBe(target);
    expect(Math.abs(renderer.tileToScreen(target).x - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(renderer.tileToScreen(target).y - anchor.y)).toBeLessThanOrEqual(1);

    // Without an anchor: the middle of the canvas stays.
    const middle = { x: BOX.left + BOX.width / 2, y: BOX.top + BOX.height / 2 };
    const under = renderer.tileAt(middle);
    renderer.zoomBy(-2);
    expect(spacing()).toBeCloseTo(TILE_WIDTH * 2, 6);
    expect(renderer.tileAt(middle)).toBe(under);
  });

  it('zoomBy ignores steps beyond the smallest (about 1x) and the largest zoom (about 6x)', () => {
    for (const ratio of [1, 2]) {
      start(ratio);
      renderer.setView(LARGE);
      renderer.centerOn(MIDDLE);
      const spacing = (): number => renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x;
      renderer.zoomBy(100);
      expect(spacing()).toBeCloseTo(TILE_WIDTH * 6, 6);
      renderer.zoomBy(1);
      expect(spacing()).toBeCloseTo(TILE_WIDTH * 6, 6);
      renderer.zoomBy(-100);
      expect(spacing()).toBeCloseTo(TILE_WIDTH * 1, 6);
      renderer.zoomBy(-1);
      expect(spacing()).toBeCloseTo(TILE_WIDTH * 1, 6);
      browser.uninstall();
    }
    start();
  });

  it('one zoom step is one CSS pixel per art pixel on an ordinary and on a high-density display alike', () => {
    for (const ratio of [1, 2, 3]) {
      start(ratio);
      renderer.setView(LARGE);
      renderer.centerOn(MIDDLE);
      const spacing = (): number => renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x;
      const levels = [spacing()];
      for (const steps of [1, 1, -1, -1, -1, -1]) {
        renderer.zoomBy(steps);
        levels.push(spacing());
      }
      expect(levels.map((level) => Math.round((level / TILE_WIDTH) * 1000) / 1000)).toEqual([3, 4, 5, 4, 3, 2, 1]);
      browser.uninstall();
    }
    start();
  });

  it('on a 1.5x display every zoom is still a whole number of device pixels', () => {
    start(1.5);
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    // Device pixels per art pixel, read off the distance between two tile centres (26 art pixels).
    const zoom = (): number => ((renderer.tileToScreen(MIDDLE + 1).x - renderer.tileToScreen(MIDDLE).x) * 1.5) / TILE_WIDTH;
    const seen = [zoom()];
    for (const steps of [1, 1, 1, -1, -1, -1, -1, -1]) {
      renderer.zoomBy(steps);
      seen.push(zoom());
    }
    for (const value of seen) expect(Math.abs(value - Math.round(value))).toBeLessThan(1e-9);
    expect(seen.map(Math.round)).toEqual([5, 7, 9, 9, 7, 5, 3, 2, 2]); // from 5, in steps of 2, between 2 and 9
  });

  it('setView never moves the camera for a view of the same map size', () => {
    start();
    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    renderer.panBy(-33, 17);
    const before = renderer.tileToScreen(MIDDLE);
    renderer.setView({ ...LARGE, turn: 2 });
    expect(renderer.tileToScreen(MIDDLE)).toEqual(before);
    // A map of another size: the camera is brought back onto it (here from far beyond its lower right corner).
    renderer.panBy(-1e6, -1e6);
    const small = sampleView();
    renderer.setView(small);
    expect(insideBox(renderer.tileToScreen(tileCount(small) - 1))).toBe(true);
  });
});

describe('createMapRenderer: when it draws', () => {
  beforeEach(() => start());

  it('draws once per animation frame however many changes came in, and never without a reason', () => {
    browser.runFrames();
    expect(browser.pendingFrames()).toBe(0); // no idle loop

    renderer.setView(LARGE);
    renderer.centerOn(MIDDLE);
    renderer.panBy(3, 3);
    renderer.zoomBy(1);
    renderer.setOverlay({ ...EMPTY_OVERLAY, hoverTile: MIDDLE });
    expect(browser.pendingFrames()).toBe(1);
    const frame = nextFrame();
    // One frame: one background fill over the whole canvas.
    const fills = frame.filter((call) => call.method === 'fillRect' && call.fillStyle === PALETTE.outline);
    expect(fills.length).toBe(1);
    expect(fills[0].args).toEqual([0, 0, 800, 600]);
    expect(browser.pendingFrames()).toBe(0);
    expect(browser.runFrames()).toBe(0);
  });

  it('does not draw again for the same view or the same overlay object', () => {
    renderer.setView(LARGE);
    const overlay = { ...EMPTY_OVERLAY, selectedTile: MIDDLE };
    renderer.setOverlay(overlay);
    browser.runFrames();
    renderer.setView(LARGE);
    renderer.setOverlay(overlay);
    expect(browser.pendingFrames()).toBe(0);
    renderer.setOverlay({ ...overlay });
    expect(browser.pendingFrames()).toBe(1);
  });

  it('destroy stops the frame loop and the observer, for good', () => {
    renderer.setView(LARGE);
    expect(browser.pendingFrames()).toBe(1);
    expect(browser.activeObservers()).toBe(1);
    renderer.destroy();
    expect(browser.pendingFrames()).toBe(0);
    expect(browser.activeObservers()).toBe(0);
    const drawn = canvas.calls.length;
    renderer.setView(sampleView());
    renderer.panBy(5, 5);
    renderer.setOverlay({ ...EMPTY_OVERLAY, hoverTile: 3 });
    expect(browser.pendingFrames()).toBe(0);
    expect(browser.runFrames()).toBe(0);
    expect(canvas.calls.length).toBe(drawn);
  });

  it('keeps drawing while a unit slides to its new tile, then stops; hit testing uses the real position at once', () => {
    const view = sampleView();
    renderer.setView(view);
    renderer.centerOn(47);
    browser.runFrames();
    expect(browser.pendingFrames()).toBe(0);

    const moved = { ...view, units: view.units.map((unit) => (unit.id === 'u1_k7m2qd' ? { ...unit, tile: 48 } : unit)) };
    const target = renderer.tileToScreen(48);
    renderer.setView(moved);
    expect(renderer.tileToScreen(48)).toEqual(target); // the map does not wait for the animation
    expect(renderer.tileAt(target)).toBe(48);

    const sheet = createTextSpriteSheet();
    const warrior = sheet.get('unit.warrior', 'rome');
    /** Runs one frame and returns where it drew the warrior (x in device pixels). */
    const warriorAfterOneFrame = (): number => {
      const before = canvas.calls.length;
      browser.runFrames(1);
      return drawsOf(canvas.calls.slice(before), warrior)[0][4];
    };

    browser.now += 1;
    const early = warriorAfterOneFrame();
    expect(browser.pendingFrames()).toBe(1); // still sliding

    browser.now += SLIDE_MS + 50;
    const final = warriorAfterOneFrame();
    expect(browser.pendingFrames()).toBe(0); // over: no idle loop
    expect(early).toBeLessThan(final); // it came from the west ...
    expect(final - early).toBeLessThanOrEqual(TILE_WIDTH * 3); // ... from at most one tile away (3 pixels per art pixel)
    expect(final - early).toBeGreaterThan(TILE_WIDTH * 2);
  });
});

describe('createMapRenderer: what it draws', () => {
  let sheet: SpriteSheet;
  /** The offscreen canvas holding the finished ground, borders and features. */
  let terrain: FakeCanvas;

  beforeEach(() => {
    start();
    terrain = browser.offscreen[1]; // the renderer makes its sprite sheet first, then the terrain picture
    sheet = createTextSpriteSheet(); // laid out exactly like the renderer's own sheet
  });

  it('paints the ground of every explored tile once, fogged where it is not in sight, and nothing for never-seen tiles', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();

    const groundDraws = terrain.calls.filter(
      (call) => call.method === 'drawImage' && call.args.length === 9 && call.args[3] === TILE_WIDTH && call.args[4] === TILE_HEIGHT,
    );
    const explored = view.tiles.filter((tile) => tile !== null).length;
    expect(groundDraws.length).toBe(explored);

    view.tiles.forEach((tile, index) => {
      const origin = tileOrigin(tileCoord(index, view));
      const at = [LAYER_PADDING + origin.px, LAYER_PADDING + origin.py];
      const here = groundDraws.filter((call) => call.args[5] === at[0] && call.args[6] === at[1]);
      if (tile === null) {
        expect(here.length, `never-seen tile ${index}`).toBe(0);
        return;
      }
      const wanted = sheet.get(`ground.${tile.terrain}`, undefined, {
        look: tile.visible ? 'normal' : 'fogged',
        variant: index,
        bare: tile.feature !== null,
      });
      expect(here.length, `tile ${index}`).toBe(1);
      expect(here[0].args.slice(1, 3), `tile ${index}`).toEqual([wanted.sx, wanted.sy]);
      // Copied pixel for pixel: the terrain picture is at one pixel per art pixel.
      expect(here[0].args.slice(7)).toEqual([TILE_WIDTH, TILE_HEIGHT]);
    });
  });

  it('paints features over the ground, in the version for their terrain and fogged where the tile is', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();
    let features = 0;
    view.tiles.forEach((tile, index) => {
      if (tile === null || tile.feature === null) return;
      features += 1;
      const origin = tileOrigin(tileCoord(index, view));
      const sprite = sheet.get(`feature.${tile.feature}`, undefined, { look: tile.visible ? 'normal' : 'fogged', on: tile.terrain });
      const here = drawsOf(terrain.calls, sprite).filter(
        (args) => args[4] === LAYER_PADDING + origin.px + sprite.offsetX && args[5] === LAYER_PADDING + origin.py + sprite.offsetY,
      );
      expect(here.length, `tile ${index}`).toBe(1);
    });
    expect(features).toBeGreaterThan(5);
    // Ground first, features last.
    const order = terrain.calls.filter((call) => call.method === 'drawImage').map((call) => call.args.length === 9 && call.args[4] === TILE_HEIGHT);
    expect(order.lastIndexOf(true)).toBeLessThan(order.length - features);
  });

  it('paints a border strip on exactly the owned tiles at the edge of a territory', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();
    // Strips are small canvases of their own, copied whole (drawImage with 3 arguments).
    const strips = terrain.calls.filter((call) => call.method === 'drawImage' && call.args.length === 3);
    const at = new Set(strips.map((call) => `${call.args[1]},${call.args[2]}`));
    expect(at.size).toBe(strips.length);
    let expected = 0;
    view.tiles.forEach((tile, index) => {
      if (tile === null || tile.owner === null) return;
      const interior = isSurroundedByOwner(view, index);
      const origin = tileOrigin(tileCoord(index, view));
      const has = at.has(`${LAYER_PADDING + origin.px},${LAYER_PADDING + origin.py}`);
      expect(has, `tile ${index}`).toBe(!interior);
      if (!interior) expected += 1;
    });
    expect(strips.length).toBe(expected);
    expect(expected).toBeGreaterThan(12);
  });

  it('repaints the terrain picture when tiles change, but not when only units or the overlay do', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();
    const painted = terrain.calls.length;

    renderer.setView({ ...view, turn: 8, units: view.units.slice(0, 1) }); // same tiles, same players
    renderer.setOverlay({ ...EMPTY_OVERLAY, selectedTile: 47 });
    renderer.panBy(5, 5);
    browser.now += 1000;
    browser.runFrames();
    expect(terrain.calls.length).toBe(painted);

    // Somebody ending their turn changes the player list, but nobody's colours.
    renderer.setView({ ...view, players: view.players.map((player) => ({ ...player, endedTurn: !player.endedTurn })) });
    browser.runFrames();
    expect(terrain.calls.length).toBe(painted);

    const tiles = view.tiles.slice();
    tiles[0] = { terrain: 'ocean', feature: null, owner: null, visible: true };
    renderer.setView({ ...view, tiles });
    browser.runFrames();
    expect(terrain.calls.length).toBeGreaterThan(painted);

    // Another civilization for a player means other border colours: painted again.
    const repainted = terrain.calls.length;
    renderer.setView({ ...view, tiles, players: view.players.map((player) => (player.id === 'p2' ? { ...player, civ: 'maya' as const } : player)) });
    browser.runFrames();
    expect(terrain.calls.length).toBeGreaterThan(repainted);
  });

  it('a view that differs in one tile repaints only that tile and the two rings around it, inside a clip', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();
    const before = terrain.calls.length;

    // Tile 47 goes out of sight: its ground must be painted again, fogged.
    const tiles = view.tiles.slice();
    tiles[47] = { ...tiles[47]!, visible: false };
    renderer.setView({ ...view, tiles });
    browser.runFrames();
    const patch = terrain.calls.slice(before);

    const grounds = patch.filter((call) => call.method === 'drawImage' && call.args.length === 9 && call.args[4] === TILE_HEIGHT);
    expect(grounds.length).toBe(19); // the tile, its 6 neighbors and their 12 neighbors (all explored here)
    const fogged = sheet.get('ground.grassland', undefined, { look: 'fogged', variant: 47 });
    const origin = tileOrigin(tileCoord(47, view));
    expect(grounds.some((call) => call.args[1] === fogged.sx && call.args[2] === fogged.sy && call.args[5] === LAYER_PADDING + origin.px && call.args[6] === LAYER_PADDING + origin.py)).toBe(true);

    // Only the boxes of the tile and its 6 neighbors are wiped, and drawing is confined to them.
    const methods = patch.map((call) => call.method);
    expect(methods.filter((method) => method === 'rect').length).toBe(7);
    expect(methods.indexOf('save')).toBeLessThan(methods.indexOf('clip'));
    expect(methods.indexOf('clip')).toBeLessThan(methods.indexOf('clearRect'));
    expect(methods.indexOf('clearRect')).toBeLessThan(methods.indexOf('drawImage'));
    expect(methods[methods.length - 1]).toBe('restore');
    const rects = patch.filter((call) => call.method === 'rect').map((call) => call.args);
    expect(rects).toContainEqual([LAYER_PADDING + origin.px, LAYER_PADDING + origin.py, TILE_WIDTH, TILE_HEIGHT]);
  });

  it('a new view with the same tiles (a full sync after reconnecting) repaints nothing; a very different one everything', () => {
    const view = sampleView();
    renderer.setView(view);
    browser.runFrames();
    const before = terrain.calls.length;

    // Every tile a new object, all with the old content.
    renderer.setView({ ...view, tiles: view.tiles.map((tile) => (tile === null ? null : { ...tile })) });
    browser.runFrames();
    expect(terrain.calls.length).toBe(before);

    // More than a quarter of the tiles changed: one full repaint, no clip.
    const everythingSeen = view.tiles.map((tile) => (tile === null ? { terrain: 'ocean' as const, feature: null, owner: null, visible: true } : { ...tile, visible: true }));
    renderer.setView({ ...view, tiles: everythingSeen });
    browser.runFrames();
    const repaint = terrain.calls.slice(before);
    expect(repaint.some((call) => call.method === 'clip')).toBe(false);
    expect(repaint.filter((call) => call.method === 'drawImage' && call.args.length === 9 && call.args[4] === TILE_HEIGHT).length).toBe(tileCount(view));
  });

  it('draws only whole pixels and whole-number enlargements, also on a 1.5x display with the camera on a fraction', () => {
    browser.uninstall();
    start(1.5);
    const view = sampleView();
    renderer.setView(view);
    renderer.centerOn(47);
    renderer.setOverlay({ ...EMPTY_OVERLAY, selectedTile: 47, reachable: [46, 48], path: [48], workedTiles: [45], hoverTile: 33 });
    renderer.panBy(-17.3, 9.77);
    renderer.zoomBy(1, { x: 333.3, y: 222.2 });
    const frame = nextFrame();
    const draws = frame.filter((call) => call.method === 'drawImage');
    expect(draws.length).toBeGreaterThan(8);
    let scaled = 0;
    for (const call of draws) {
      const numbers = call.args.slice(1) as number[];
      for (const value of numbers) expect(Number.isInteger(value), `${call.args.length} arguments: ${numbers.join(', ')}`).toBe(true);
      if (numbers.length === 8) {
        const [, , width, height, , , drawnWidth, drawnHeight] = numbers;
        const zoom = drawnWidth / width;
        expect(Number.isInteger(zoom)).toBe(true);
        expect(drawnHeight / height).toBe(zoom);
        expect(zoom).toBe(7); // 1.5x display: starts at round(3 * 1.5) = 5 device pixels per art pixel; a step adds 2
        scaled += 1;
      }
    }
    expect(scaled).toBeGreaterThan(6);
    // Smoothing is off whenever something is drawn.
    expect((canvas.element.getContext('2d') as CanvasRenderingContext2D).imageSmoothingEnabled).toBe(false);
  });

  it('draws the highlights of the overlay on their tiles, under the cities and units', () => {
    const view = sampleView();
    renderer.setView(view);
    renderer.centerOn(47);
    browser.runFrames();
    renderer.setOverlay({ selectedTile: 47, selectedUnitId: 'u1_k7m2qd', reachable: [46, 48, 33], path: [48, 49], workedTiles: [45, 60], hoverTile: 34 });
    const frame = nextFrame();

    const zoom = 3;
    /** Where the frame drew this sprite, as tile indexes. */
    const tilesOf = (sprite: Sprite): number[] =>
      drawsOf(frame, sprite).map(([, , , , x, y]) => {
        const point = { x: BOX.left + x - sprite.offsetX * zoom + (TILE_WIDTH * zoom) / 2, y: BOX.top + y - sprite.offsetY * zoom + (TILE_HEIGHT * zoom) / 2 };
        return renderer.tileAt(point) ?? -1;
      });
    expect(tilesOf(sheet.get('marker.reachable')).sort()).toEqual([33, 46, 48]);
    // The path is a dotted line: a dot on tile 48 and one halfway on each side of it, then the ring on the last tile.
    expect(drawsOf(frame, sheet.get('marker.pathStep')).length).toBe(3);
    expect(tilesOf(sheet.get('marker.pathEnd'))).toEqual([49]);
    expect(tilesOf(sheet.get('marker.worked')).sort()).toEqual([45, 60]);
    expect(tilesOf(sheet.get('marker.selection'))).toEqual([47]);
    expect(tilesOf(sheet.get('marker.hover'))).toEqual([34]);

    // Back to front: terrain picture, highlights, cities, units, banners.
    const indexOf = (sprite: Sprite): number => frame.findIndex((call) => call.method === 'drawImage' && call.args[1] === sprite.sx && call.args[2] === sprite.sy);
    const terrainAt = frame.findIndex((call) => call.method === 'drawImage' && call.args[0] === terrain.element);
    const cityAt = indexOf(sheet.get('city', 'rome'));
    const unitAt = indexOf(sheet.get('unit.warrior', 'rome'));
    const bannerAt = frame.findIndex((call) => call.method === 'drawImage' && call.args.length === 3);
    expect(terrainAt).toBeGreaterThanOrEqual(0);
    for (const marker of ['reachable', 'pathStep', 'pathEnd', 'worked', 'selection', 'hover'] as const) {
      const at = indexOf(sheet.get(`marker.${marker}`));
      expect(at).toBeGreaterThan(terrainAt);
      expect(at).toBeLessThan(cityAt);
    }
    expect(cityAt).toBeLessThan(unitAt);
    expect(unitAt).toBeLessThan(bannerAt);
  });

  it('draws cities and units in their owner\'s colours; a remembered city fogged; an own unit without moves dimmed', () => {
    const view = sampleView();
    const spent = { ...view, units: view.units.map((unit) => (unit.id === 'u1_x3fp9a' ? { ...unit, own: { ...unit.own!, movesLeft: 0 } } : unit)) };
    renderer.setView(spent);
    renderer.zoomBy(-1); // the whole sample map on screen
    const frame = nextFrame();

    expect(drawsOf(frame, sheet.get('city', 'rome')).length).toBe(1); // Rome, in sight
    expect(drawsOf(frame, sheet.get('city', 'egypt', { look: 'fogged' })).length).toBe(1); // Thebes, remembered
    expect(drawsOf(frame, sheet.get('city', 'egypt')).length).toBe(0);
    expect(drawsOf(frame, sheet.get('unit.warrior', 'rome')).length).toBe(1);
    expect(drawsOf(frame, sheet.get('unit.warrior', 'egypt')).length).toBe(1);
    expect(drawsOf(frame, sheet.get('unit.settler', 'rome', { look: 'spent' })).length).toBe(1);
    expect(drawsOf(frame, sheet.get('unit.settler', 'rome')).length).toBe(0);
    // One banner per city.
    expect(frame.filter((call) => call.method === 'drawImage' && call.args.length === 3).length).toBe(2);
  });

  it('draws a unit among trees with the pale line around it, at the same spot; in the open, without', () => {
    const FOREST = 1 * 14 + 4; // a forest tile of the sample map
    const sample = sampleView();
    expect(sample.tiles[FOREST]?.feature).toBe('forest');
    const plain = sheet.get('unit.warrior', 'rome');
    const rimmed = sheet.get('unit.warrior', 'rome', { rim: true });
    expect(rimmed).not.toBe(plain);
    expect(rimmed.height).toBe(plain.height + 1); // the line needs a row above the sword

    // The same warrior on the same tile, once with the trees felled and once among them.
    const amongTrees: PlayerView = { ...sample, units: sample.units.map((unit) => (unit.id === 'u1_k7m2qd' ? { ...unit, tile: FOREST } : unit)) };
    const felled: PlayerView = { ...amongTrees, tiles: amongTrees.tiles.map((tile, index) => (index === FOREST && tile !== null ? { ...tile, feature: null } : tile)) };

    renderer.setView(felled);
    renderer.zoomBy(-1); // the whole sample map on screen
    const open = nextFrame();
    expect(drawsOf(open, rimmed).length).toBe(0);
    const [plainDraw] = drawsOf(open, plain);

    renderer.setView(amongTrees);
    const wooded = nextFrame();
    expect(drawsOf(wooded, plain).length).toBe(0);
    const [rimmedDraw] = drawsOf(wooded, rimmed);

    // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh): the figure has not moved.
    const zoom = plainDraw[6] / plain.width;
    expect(rimmedDraw[4]).toBe(plainDraw[4]);
    expect(rimmedDraw[5]).toBe(plainDraw[5] - zoom); // one art pixel higher, for the added row
    expect(rimmedDraw[7]).toBe(plainDraw[7] + zoom);
  });

  it('skips what is off screen: zoomed in on one corner, the far city and units are not drawn', () => {
    const view = sampleView();
    renderer.setView(view);
    renderer.zoomBy(3);
    renderer.centerOn(8 * 14 + 3); // the south-west of the island, far from every unit
    const frame = nextFrame();
    expect(drawsOf(frame, sheet.get('unit.warrior', 'rome')).length).toBe(0);
    expect(drawsOf(frame, sheet.get('unit.warrior', 'egypt')).length).toBe(0);
    expect(drawsOf(frame, sheet.get('city', 'egypt', { look: 'fogged' })).length).toBe(0);
  });
});

/** True if all six neighbors of the tile are on the map and have the tile's owner. */
function isSurroundedByOwner(view: PlayerView, tile: TileIndex): boolean {
  const owner = view.tiles[tile]!.owner;
  const { x, y } = tileCoord(tile, view);
  const shift = y & 1;
  const neighbors = [
    [x + 1, y], [x - 1, y],
    [x - 1 + shift, y - 1], [x + shift, y - 1],
    [x - 1 + shift, y + 1], [x + shift, y + 1],
  ];
  return neighbors.every(([nx, ny]) => {
    if (nx < 0 || ny < 0 || nx >= view.width || ny >= view.height) return false;
    return view.tiles[ny * view.width + nx]?.owner === owner;
  });
}
