import { describe, expect, it, vi } from 'vitest';
import { HOVER_INFO_DELAY_MS, HOVER_INFO_WARM_DELAY_MS, createHoverInfoTimer } from '../src/input/hoverInfo';
import type { HoverInfoTimer } from '../src/input/hoverInfo';
import type { ScreenRect } from '../src/render/api';
import { HOVER_BOX_EDGE, HOVER_BOX_GAP, placeHoverBox } from '../src/ui/hoverPlacement';

/**
 * The hover box, as far as it can be decided without a page: WHEN it comes
 * and goes (input/hoverInfo.ts, on a clock the test moves by hand) and WHERE
 * it is put (ui/hoverPlacement.ts, arithmetic on rectangles).
 */

interface TimerSetup {
  timer: HoverInfoTimer;
  /** Every call of `show`, oldest first, as "time:tile" ("400:7", "550:null"). */
  shows: string[];
  /** What the box describes now (the last `show`), or null. */
  shown(): number | null;
  /** Lets time pass and runs every timer that comes due, in order. */
  advance(ms: number): void;
  /** How many timers are waiting. */
  pending(): number;
}

/** A hover timer on a hand-made clock that starts at 0. */
function setup(): TimerSetup {
  let now = 0;
  let nextId = 1;
  let timers: { id: number; at: number; run: () => void }[] = [];
  const shows: string[] = [];
  let current: number | null = null;

  const timer = createHoverInfoTimer(
    {
      show(tile) {
        current = tile;
        shows.push(`${now}:${tile}`);
      },
    },
    {
      setTimer(run, delayMs) {
        const id = nextId;
        nextId += 1;
        timers.push({ id, at: now + delayMs, run });
        return id;
      },
      clearTimer(id) {
        timers = timers.filter((waiting) => waiting.id !== id);
      },
    },
  );

  return {
    timer,
    shows,
    shown: () => current,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((waiting) => waiting.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers = timers.filter((waiting) => waiting !== due);
        now = due.at;
        due.run();
      }
      now = end;
    },
    pending: () => timers.length,
  };
}

/** A timer whose box for `tile` is showing (the mouse came onto it and rested the full delay). */
function showing(tile: number): TimerSetup {
  const world = setup();
  world.timer.pointerOver(tile, false);
  world.advance(HOVER_INFO_DELAY_MS);
  expect(world.shown()).toBe(tile);
  world.shows.length = 0;
  return world;
}

describe('the hover timer (input/hoverInfo.ts)', () => {
  it('the two delays are 400 ms and 150 ms', () => {
    expect(HOVER_INFO_DELAY_MS).toBe(400);
    expect(HOVER_INFO_WARM_DELAY_MS).toBe(150);
  });

  it('nothing is shown before 400 ms; the tile is shown when they have passed', () => {
    const { timer, shows, advance } = setup();
    timer.pointerOver(7, false);
    advance(399);
    expect(shows).toEqual([]);
    advance(1);
    expect(shows).toEqual(['400:7']);
    // Resting on goes on showing it, without another word.
    advance(10_000);
    timer.pointerOver(7, false);
    expect(shows).toEqual(['400:7']);
  });

  it('leaving the tile before the delay shows nothing, and the new tile waits its own full delay', () => {
    const { timer, shows, advance } = setup();
    timer.pointerOver(7, false);
    advance(300);
    timer.pointerOver(8, false);
    advance(399); // 699: tile 7's 400 ms are long over, tile 8's are not
    expect(shows).toEqual([]);
    advance(1);
    expect(shows).toEqual(['700:8']);
  });

  it('coming onto another tile hides a showing box at once; the new tile is shown 150 ms later', () => {
    const { timer, shows, advance, shown } = showing(7);
    timer.pointerOver(8, false);
    expect(shows).toEqual(['400:null']);
    advance(149);
    expect(shown()).toBeNull();
    advance(1);
    expect(shows).toEqual(['400:null', '550:8']);
    // And so on from tile to tile, as long as each box was showing.
    timer.pointerOver(9, false);
    advance(HOVER_INFO_WARM_DELAY_MS);
    expect(shows).toEqual(['400:null', '550:8', '550:null', '700:9']);
  });

  it('patient: with a box showing, the next tile waits the full 400 ms', () => {
    const { timer, shows, advance } = showing(7);
    timer.pointerOver(8, true);
    expect(shows).toEqual(['400:null']); // it still goes away at once
    advance(399);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '800:8']);
  });

  it('crossing ten tiles 50 ms apart shows nothing; the box comes 150 ms after the mouse rests', () => {
    const { timer, shows, advance } = showing(7);
    for (let tile = 10; tile < 20; tile++) {
      timer.pointerOver(tile, false);
      advance(50);
    }
    // The last tile was entered at 850; it is 900 now.
    expect(shows).toEqual(['400:null']);
    advance(99);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '1000:19']);
  });

  it('leaving the map hides the box and ends "warm": the next tile waits 400 ms again', () => {
    const { timer, shows, advance } = showing(7);
    timer.pointerOver(null, false);
    expect(shows).toEqual(['400:null']);
    timer.pointerOver(8, false);
    advance(399);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '800:8']);
  });

  it('dismiss hides at once and says whether a box was showing; resting on the same tile does not bring the box back; another tile does, after 400 ms', () => {
    const { timer, shows, advance, pending } = showing(7);
    expect(timer.dismiss()).toBe(true);
    expect(shows).toEqual(['400:null']);
    expect(timer.dismiss()).toBe(false); // nothing was showing any more

    // The mouse stays, or wiggles inside the tile: quiet.
    timer.pointerOver(7, false);
    advance(5000);
    timer.pointerOver(7, true);
    advance(5000);
    expect(shows).toEqual(['400:null']);
    expect(pending()).toBe(0);

    // Another tile ends the quiet; "warm" ended with the dismiss, so it is the full delay.
    timer.pointerOver(8, false);
    advance(399);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '10800:8']);
  });

  it('dismiss before the box has appeared answers false and stops it from coming', () => {
    const { timer, shows, advance } = setup();
    timer.pointerOver(7, false);
    advance(200);
    expect(timer.dismiss()).toBe(false);
    advance(5000);
    expect(shows).toEqual([]);
  });

  it('mapMoved by the pointer hides at once and shows the tile under the mouse 400 ms after the last move', () => {
    const { timer, shows, advance } = showing(7);
    // The wheel turns for two seconds, a notch every 16 ms: nothing.
    for (let step = 0; step < 125; step++) {
      timer.mapMoved(9, true);
      advance(16);
    }
    expect(shows).toEqual(['400:null']); // hidden at the first move (400), nothing since
    // The last move was at 400 + 124 * 16 = 2384; it is 2400 now.
    advance(383);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '2784:9']);
  });

  it('mapMoved by the pointer ends "warm": the full delay, although a box was showing a moment ago', () => {
    const { timer, shows, advance } = showing(7);
    timer.mapMoved(8, true);
    advance(HOVER_INFO_WARM_DELAY_MS);
    expect(shows).toEqual(['400:null']);
    advance(HOVER_INFO_DELAY_MS - HOVER_INFO_WARM_DELAY_MS);
    expect(shows).toEqual(['400:null', '800:8']);
  });

  it('mapMoved by the pointer while quiet stays quiet, also when the tile under the mouse changed', () => {
    const { timer, shows, advance, pending } = showing(7);
    timer.dismiss(); // the press that starts a drag
    timer.mapMoved(7, true);
    timer.mapMoved(12, true); // the map slid along under the mouse
    advance(5000);
    expect(shows).toEqual(['400:null']);
    expect(pending()).toBe(0);
    // The mouse lies on tile 12 now. Moving within it changes nothing; the next tile is a new start.
    timer.pointerOver(12, false);
    advance(5000);
    expect(shows).toEqual(['400:null']);
    timer.pointerOver(13, false);
    advance(HOVER_INFO_DELAY_MS);
    expect(shows).toEqual(['400:null', '10800:13']);
  });

  it('mapMoved NOT by the pointer hides and shows nothing, however long the mouse lies still; the next pointerOver, also on the same tile, starts the 400 ms', () => {
    const { timer, shows, advance, pending } = showing(7);
    timer.mapMoved(9, false); // the N key centred the map: another tile lies under the resting mouse
    expect(shows).toEqual(['400:null']);
    advance(60_000);
    expect(shows).toEqual(['400:null']);
    expect(pending()).toBe(0);

    timer.pointerOver(9, false); // the mouse moves by two pixels, inside the same tile
    advance(399);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '60800:9']);
  });

  it('a map that moved by itself and then by the pointer follows the pointer\'s rule again', () => {
    const { timer, shows, advance } = showing(7);
    timer.mapMoved(9, false);
    timer.mapMoved(9, true); // then the wheel
    advance(HOVER_INFO_DELAY_MS);
    expect(shows).toEqual(['400:null', '800:9']);
  });

  it('dragEnded ends the quiet: the tile under the mouse is shown 400 ms later; without a tile nothing is', () => {
    const { timer, shows, advance } = showing(7);
    timer.dismiss(); // mouse button down
    timer.mapMoved(7, true); // the drag
    timer.mapMoved(11, true);
    advance(1000);
    timer.dragEnded(); // mouse button up, at 1400
    advance(399);
    expect(shows).toEqual(['400:null']);
    advance(1);
    expect(shows).toEqual(['400:null', '1800:11']);

    // The drag ended with the mouse off the map (over no tile): nothing to show, nothing waiting.
    const off = showing(7);
    off.timer.dismiss();
    off.timer.mapMoved(null, true);
    off.timer.dragEnded();
    off.advance(5000);
    expect(off.shows).toEqual(['400:null']);
    expect(off.pending()).toBe(0);
  });

  it('a click without a drag stays quiet: no dragEnded, no box on that tile', () => {
    const { timer, shows, advance } = showing(7);
    timer.dismiss();
    timer.pointerOver(7, false);
    advance(5000);
    expect(shows).toEqual(['400:null']);
  });

  it('mapMoved(null, ...) hides and waits for nothing', () => {
    for (const byPointer of [true, false]) {
      const { timer, shows, advance, pending } = showing(7);
      timer.mapMoved(null, byPointer);
      expect(shows).toEqual(['400:null']);
      expect(pending()).toBe(0);
      advance(5000);
      expect(shows).toEqual(['400:null']);
    }
  });

  it('show is called only when what is shown changes', () => {
    const { timer, shows, advance } = setup();
    // Nothing is showing: none of these has anything to take away.
    timer.pointerOver(null, false);
    timer.dismiss();
    timer.mapMoved(null, false);
    timer.mapMoved(3, true);
    timer.pointerOver(4, false);
    timer.dragEnded();
    expect(shows).toEqual([]);

    advance(HOVER_INFO_DELAY_MS);
    expect(shows).toEqual(['400:4']);
    // Showing tile 4: the same tile again, and time, call nothing.
    timer.pointerOver(4, false);
    timer.pointerOver(4, true);
    advance(5000);
    expect(shows).toEqual(['400:4']);
    // Taken away once, however many reasons there are.
    timer.dismiss();
    timer.dismiss();
    timer.mapMoved(4, false);
    timer.pointerOver(null, false);
    expect(shows).toEqual(['400:4', '5400:null']);
  });

  it('destroy stops a waiting timer', () => {
    const { timer, shows, advance, pending } = setup();
    timer.pointerOver(7, false);
    expect(pending()).toBe(1);
    timer.destroy();
    expect(pending()).toBe(0);
    advance(5000);
    expect(shows).toEqual([]);
    // Destroying again, or with nothing waiting, is harmless.
    expect(() => timer.destroy()).not.toThrow();
  });

  it('at most one timer waits at any moment', () => {
    const { timer, pending } = setup();
    timer.pointerOver(1, false);
    timer.pointerOver(2, false);
    timer.mapMoved(3, true);
    timer.mapMoved(4, true);
    timer.dragEnded();
    timer.dragEnded();
    expect(pending()).toBe(1);
  });

  it('without a clock of its own it uses the real timers (setTimeout, clearTimeout)', () => {
    vi.useFakeTimers(); // the test framework's stand-ins for the two, so nobody has to wait
    try {
      const shows: (number | null)[] = [];
      const timer = createHoverInfoTimer({ show: (tile) => shows.push(tile) });
      timer.pointerOver(7, false);
      vi.advanceTimersByTime(HOVER_INFO_DELAY_MS - 1);
      expect(shows).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(shows).toEqual([7]);
      timer.pointerOver(8, false);
      timer.destroy(); // the box that was due is never shown
      vi.advanceTimersByTime(10_000);
      expect(shows).toEqual([7, null]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------

/** A map area like the game screen's on a laptop: 1280 wide, below a 44-pixel top bar. */
const AREA: ScreenRect = { left: 0, top: 44, right: 1280, bottom: 800 };
/** A hover box with a few lines in it. */
const BOX = { width: 240, height: 120 };

/** A tile's box on screen: 78 x 84 (the art's 26 x 28 at zoom 3) with its top-left corner here. */
function tileAt(left: number, top: number, width = 78, height = 84): ScreenRect {
  return { left, top, right: left + width, bottom: top + height };
}

function boxRect(place: { left: number; top: number }, box = BOX): ScreenRect {
  return { left: place.left, top: place.top, right: place.left + box.width, bottom: place.top + box.height };
}

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe('placeHoverBox (ui/hoverPlacement.ts)', () => {
  it('with room everywhere: to the right of the tile, its top level with the tile\'s top', () => {
    const tile = tileAt(600, 300);
    expect(placeHoverBox({ tile, box: BOX, area: AREA, obstacles: [] })).toEqual({ left: tile.right + HOVER_BOX_GAP, top: tile.top });
    expect(HOVER_BOX_GAP).toBe(8);
    expect(HOVER_BOX_EDGE).toBe(8);
  });

  it('no room on the right: the left', () => {
    const tile = tileAt(1150, 300);
    expect(placeHoverBox({ tile, box: BOX, area: AREA, obstacles: [] })).toEqual({ left: tile.left - HOVER_BOX_GAP - BOX.width, top: tile.top });

    // The last place on the right that still fits, to the pixel, and the first that does not.
    const fits = tileAt(AREA.right - HOVER_BOX_EDGE - BOX.width - HOVER_BOX_GAP - 78, 300);
    expect(placeHoverBox({ tile: fits, box: BOX, area: AREA, obstacles: [] })?.left).toBe(fits.right + HOVER_BOX_GAP);
    const tooFar = tileAt(fits.left + 1, 300);
    expect(placeHoverBox({ tile: tooFar, box: BOX, area: AREA, obstacles: [] })?.left).toBe(tooFar.left - HOVER_BOX_GAP - BOX.width);
  });

  it('a tile at the top edge: the box is moved down to stay below the top of the area; at the bottom edge: moved up', () => {
    // The tile sticks out above the map area (it is half under the top bar).
    const high = tileAt(600, AREA.top - 40);
    expect(placeHoverBox({ tile: high, box: BOX, area: AREA, obstacles: [] })).toEqual({ left: high.right + HOVER_BOX_GAP, top: AREA.top + HOVER_BOX_EDGE });

    const low = tileAt(600, AREA.bottom - 60);
    expect(placeHoverBox({ tile: low, box: BOX, area: AREA, obstacles: [] })).toEqual({
      left: low.right + HOVER_BOX_GAP,
      top: AREA.bottom - HOVER_BOX_EDGE - BOX.height,
    });
  });

  it('an obstacle on the right: the left', () => {
    const tile = tileAt(600, 300);
    const panel: ScreenRect = { left: 700, top: 250, right: 1000, bottom: 500 };
    expect(placeHoverBox({ tile, box: BOX, area: AREA, obstacles: [panel] })).toEqual({ left: tile.left - HOVER_BOX_GAP - BOX.width, top: tile.top });

    // An obstacle that only begins where the box ends is not in the way.
    const beside: ScreenRect = { left: tile.right + HOVER_BOX_GAP + BOX.width, top: 250, right: 1280, bottom: 500 };
    expect(placeHoverBox({ tile, box: BOX, area: AREA, obstacles: [beside] })).toEqual({ left: tile.right + HOVER_BOX_GAP, top: tile.top });
  });

  it('obstacles on both sides: above the tile; a tile at the top with obstacles on both sides: below it', () => {
    const left: ScreenRect = { left: 0, top: 44, right: 590, bottom: 800 };
    const right: ScreenRect = { left: 690, top: 44, right: 1280, bottom: 800 };

    const tile = tileAt(600, 300);
    const middle = (tile.left + tile.right) / 2;
    // The obstacles leave a strip 100 pixels wide free, over and under the tile: room for a narrow box.
    const narrow = { width: 90, height: 120 };
    expect(placeHoverBox({ tile, box: narrow, area: AREA, obstacles: [left, right] })).toEqual({
      left: middle - narrow.width / 2,
      top: tile.top - HOVER_BOX_GAP - narrow.height,
    });

    const atTop = tileAt(600, AREA.top + 20);
    expect(placeHoverBox({ tile: atTop, box: narrow, area: AREA, obstacles: [left, right] })).toEqual({
      left: middle - narrow.width / 2,
      top: atTop.bottom + HOVER_BOX_GAP,
    });
  });

  it('above and below, the box is centred on the tile and moved sideways to stay inside the area', () => {
    // A phone held upright and a wide box: nothing fits beside a tile.
    const area: ScreenRect = { left: 0, top: 44, right: 390, bottom: 844 };
    const wide = { width: 300, height: 120 };
    const nearLeft = tileAt(20, 400);
    expect(placeHoverBox({ tile: nearLeft, box: wide, area, obstacles: [] })).toEqual({
      left: area.left + HOVER_BOX_EDGE, // centred on the tile it would begin left of the screen
      top: nearLeft.top - HOVER_BOX_GAP - wide.height,
    });
    const nearRight = tileAt(300, 400);
    expect(placeHoverBox({ tile: nearRight, box: wide, area, obstacles: [] })).toEqual({
      left: area.right - HOVER_BOX_EDGE - wide.width,
      top: nearRight.top - HOVER_BOX_GAP - wide.height,
    });
    const centred = tileAt(156, 400);
    expect(placeHoverBox({ tile: centred, box: wide, area, obstacles: [] })).toEqual({
      left: 156 + 39 - wide.width / 2,
      top: centred.top - HOVER_BOX_GAP - wide.height,
    });
  });

  it('only places that touch an obstacle fit: the first of them is taken', () => {
    const tile = tileAt(600, 300);
    // One obstacle over the whole map area: every place touches it.
    const everything: ScreenRect = { ...AREA };
    expect(placeHoverBox({ tile, box: BOX, area: AREA, obstacles: [everything] })).toEqual({ left: tile.right + HOVER_BOX_GAP, top: tile.top });

    // No room on the right at all: the first place that fits is the left one.
    const atRight = tileAt(1150, 300);
    expect(placeHoverBox({ tile: atRight, box: BOX, area: AREA, obstacles: [everything] })).toEqual({
      left: atRight.left - HOVER_BOX_GAP - BOX.width,
      top: atRight.top,
    });
  });

  it('the box fits nowhere beside, above or below: null', () => {
    // A tile that fills the little window almost to its edges.
    const area: ScreenRect = { left: 0, top: 0, right: 300, bottom: 200 };
    const tile: ScreenRect = { left: 60, top: 60, right: 240, bottom: 140 };
    expect(placeHoverBox({ tile, box: BOX, area, obstacles: [] })).toBeNull();

    // A box larger than the map area fits nowhere, wherever the tile is.
    expect(placeHoverBox({ tile: tileAt(600, 300), box: { width: 1300, height: 120 }, area: AREA, obstacles: [] })).toBeNull();
    expect(placeHoverBox({ tile: tileAt(600, 300), box: { width: 240, height: 800 }, area: AREA, obstacles: [] })).toBeNull();

    // One pixel more room and it fits: below the tile, in the last free strip.
    const roomy: ScreenRect = { left: 0, top: 0, right: 300, bottom: 140 + HOVER_BOX_GAP + BOX.height + HOVER_BOX_EDGE };
    expect(placeHoverBox({ tile, box: BOX, area: roomy, obstacles: [] })).toEqual({ left: 150 - BOX.width / 2, top: tile.bottom + HOVER_BOX_GAP });
    expect(placeHoverBox({ tile, box: BOX, area: { ...roomy, bottom: roomy.bottom - 1 }, obstacles: [] })).toBeNull();
  });

  it('for a grid of tile positions and four tile sizes (26, 78, 104 and 156 pixels wide): a result is never null in a 1280 x 756 area, never overlaps the tile, and always lies inside the area with 8 pixels to spare', () => {
    const area: ScreenRect = { left: 0, top: 44, right: 1280, bottom: 800 };
    expect(area.bottom - area.top).toBe(756);
    // The corners where panels and End Turn float.
    const corners: ScreenRect[] = [
      { left: 12, top: 520, right: 332, bottom: 788 },
      { left: 1048, top: 700, right: 1268, bottom: 788 },
    ];
    const boxes = [BOX, { width: 280, height: 190 }, { width: 160.5, height: 61.25 }];
    let tried = 0;

    for (const width of [26, 78, 104, 156]) {
      const height = (width / 26) * 28;
      // Every place a hovered tile can be: at least partly on the map area, also half off any edge. Odd steps and halves of pixels.
      for (let left = area.left - width / 2; left <= area.right - width / 2; left += 37.5) {
        for (let top = area.top - height / 2; top <= area.bottom - height / 2; top += 29.5) {
          const tile = tileAt(left, top, width, height);
          for (const box of boxes) {
            for (const obstacles of [[], corners]) {
              const place = placeHoverBox({ tile, box, area, obstacles });
              const where = `tile ${width} at ${left},${top}, box ${box.width}`;
              tried += 1;
              if (place === null) throw new Error(`no place for ${where}`);
              expect(Number.isInteger(place.left) && Number.isInteger(place.top), where).toBe(true);
              const rect = boxRect(place, box);
              expect(overlaps(rect, tile), where).toBe(false);
              expect(rect.left, where).toBeGreaterThanOrEqual(area.left + 8);
              expect(rect.top, where).toBeGreaterThanOrEqual(area.top + 8);
              expect(rect.right, where).toBeLessThanOrEqual(area.right - 8);
              expect(rect.bottom, where).toBeLessThanOrEqual(area.bottom - 8);
            }
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(5000);
  });

  it('a place that is clear of the corners is preferred to one that covers a panel', () => {
    const area: ScreenRect = { left: 0, top: 44, right: 1280, bottom: 800 };
    const leftPanel: ScreenRect = { left: 12, top: 520, right: 332, bottom: 788 };
    const rightPanel: ScreenRect = { left: 990, top: 520, right: 1268, bottom: 788 };
    const obstacles = [leftPanel, rightPanel];

    // A tile just above the left panel, near the left edge: beside it on the
    // right the box would hang down onto the panel, on the left is the edge
    // of the screen. So it goes above the tile.
    const overPanel = tileAt(100, 440);
    expect(placeHoverBox({ tile: overPanel, box: BOX, area, obstacles })).toEqual({
      left: 139 - BOX.width / 2,
      top: overPanel.top - HOVER_BOX_GAP - BOX.height,
    });

    // A tile left of the End Turn corner, level with it: the box goes to the tile's left.
    const besidePanel = tileAt(900, 600);
    expect(placeHoverBox({ tile: besidePanel, box: BOX, area, obstacles })).toEqual({
      left: besidePanel.left - HOVER_BOX_GAP - BOX.width,
      top: besidePanel.top,
    });
  });

  it('results are whole pixels also for a tile and a box measured in fractions, and the gap is never less than 8', () => {
    const tile: ScreenRect = { left: 600.4, top: 300.6, right: 678.4, bottom: 384.6 };
    const box = { width: 213.3, height: 97.7 };
    const right = placeHoverBox({ tile, box, area: AREA, obstacles: [] });
    expect(right).toEqual({ left: 687, top: 301 });

    const blockedRight: ScreenRect = { left: 690, top: 0, right: 1280, bottom: 800 };
    const left = placeHoverBox({ tile, box, area: AREA, obstacles: [blockedRight] });
    expect(left).toEqual({ left: Math.floor(600.4 - 8 - 213.3), top: 301 });
    if (left === null) throw new Error('unreachable');
    expect(tile.left - (left.left + box.width)).toBeGreaterThanOrEqual(HOVER_BOX_GAP);
  });
});
