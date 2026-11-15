import { describe, expect, it } from 'vitest';
import type { ScreenRect } from '../src/render/api';
import { REVEAL_MARGIN, REVEAL_SLACK, isInTheOpen, lowestUncoveredY, sidewaysStep, upOrDownStep } from '../src/ui/mapReveal';
import type { RevealSurroundings } from '../src/ui/mapReveal';

/**
 * How the map steps aside for its own panels (ui/mapReveal.ts): rectangles
 * in, a pan out. The game screen measures and pans; every number of the
 * decision is made here.
 */

const NOTHING: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };

/** A laptop window, 1280 x 800: the map below a top bar of 44, a city panel bottom left, End Turn bottom right. */
const LAPTOP: RevealSurroundings = {
  map: { left: 0, top: 44, right: 1280, bottom: 800 },
  leftCorner: { left: 8, top: 380, right: 328, bottom: 792 },
  rightCorner: { left: 972, top: 700, right: 1272, bottom: 792 },
};

/** A phone held sideways, 844 x 390: the city panel floats bottom left and is as tall as the map allows. */
const SIDEWAYS: RevealSurroundings = {
  map: { left: 0, top: 44, right: 844, bottom: 390 },
  leftCorner: { left: 8, top: 52, right: 328, bottom: 382 },
  rightCorner: { left: 536, top: 290, right: 836, bottom: 382 },
};

/** The same phone held upright, 390 x 844: the panels are a deck BELOW the map, which ends at 345. */
const UPRIGHT: RevealSurroundings = {
  map: { left: 0, top: 63, right: 390, bottom: 345 },
  leftCorner: { left: 8, top: 353, right: 382, bottom: 724 },
  rightCorner: { left: 8, top: 732, right: 382, bottom: 832 },
};

/** Applies both steps, as the game screen does, and returns where the tile is afterwards (null: the map was left alone). */
function steppedAside(point: { x: number; y: number }, around: RevealSurroundings): { x: number; y: number } | null {
  const dx = sidewaysStep(point, around);
  if (dx === null) return null;
  const moved = { x: point.x + dx, y: point.y };
  return { x: moved.x, y: moved.y + upOrDownStep(moved, around) };
}

describe('is the marked tile in the open? (isInTheOpen)', () => {
  it('in the middle of the map: yes; under a panel, or closer than the margin to a panel or to any edge of the map: no', () => {
    expect(isInTheOpen({ x: 640, y: 400 }, LAPTOP)).toBe(true);
    // Under the city panel, and beside it but closer than the margin.
    expect(isInTheOpen({ x: 200, y: 500 }, LAPTOP)).toBe(false);
    expect(isInTheOpen({ x: 328 + REVEAL_MARGIN - 1, y: 500 }, LAPTOP)).toBe(false);
    expect(isInTheOpen({ x: 328 + REVEAL_MARGIN, y: 500 }, LAPTOP)).toBe(true);
    // Above the panel, with the margin to spare, it is in the open.
    expect(isInTheOpen({ x: 200, y: 380 - REVEAL_MARGIN }, LAPTOP)).toBe(true);
    expect(isInTheOpen({ x: 200, y: 380 - REVEAL_MARGIN + 1 }, LAPTOP)).toBe(false);
    // The top and the bottom edge of the map.
    expect(isInTheOpen({ x: 640, y: 44 + REVEAL_MARGIN - 1 }, LAPTOP)).toBe(false);
    expect(isInTheOpen({ x: 640, y: 44 + REVEAL_MARGIN }, LAPTOP)).toBe(true);
    expect(isInTheOpen({ x: 640, y: 800 - REVEAL_MARGIN + 1 }, LAPTOP)).toBe(false);
  });

  it('the side edges count like the top and the bottom: a tile whose middle is just inside the canvas is half off the screen', () => {
    // It used to be "in the open" one pixel inside the canvas.
    expect(isInTheOpen({ x: 1, y: 300 }, LAPTOP)).toBe(false);
    expect(isInTheOpen({ x: REVEAL_MARGIN - 1, y: 300 }, LAPTOP)).toBe(false);
    expect(isInTheOpen({ x: REVEAL_MARGIN, y: 300 }, LAPTOP)).toBe(true);
    expect(isInTheOpen({ x: 1280 - REVEAL_MARGIN, y: 300 }, LAPTOP)).toBe(true);
    expect(isInTheOpen({ x: 1280 - REVEAL_MARGIN + 1, y: 300 }, LAPTOP)).toBe(false);
    // Beyond the canvas altogether (the window got narrower).
    expect(isInTheOpen({ x: 422, y: 200 }, UPRIGHT)).toBe(false);
    expect(isInTheOpen({ x: -30, y: 200 }, UPRIGHT)).toBe(false);
  });

  it('a corner without a size (no panel is open) covers nothing; a deck below the map covers nothing either', () => {
    const noPanel: RevealSurroundings = { ...LAPTOP, leftCorner: NOTHING };
    expect(isInTheOpen({ x: 200, y: 700 }, noPanel)).toBe(true);
    expect(lowestUncoveredY(200, noPanel)).toBe(800 - REVEAL_MARGIN);
    expect(lowestUncoveredY(200, LAPTOP)).toBe(380 - REVEAL_MARGIN);
    // Upright phone: the deck begins where the map ends, so only the map's own bottom margin counts.
    expect(lowestUncoveredY(195, UPRIGHT)).toBe(345 - REVEAL_MARGIN);
    expect(isInTheOpen({ x: 195, y: 200 }, UPRIGHT)).toBe(true);
  });
});

describe('the two steps of stepping aside (sidewaysStep, upOrDownStep)', () => {
  it('a tile in the open is left where it is', () => {
    expect(sidewaysStep({ x: 640, y: 400 }, LAPTOP)).toBe(0);
    expect(upOrDownStep({ x: 640, y: 400 }, LAPTOP)).toBe(0);
  });

  it('under a panel with room above it: straight up, to just above the panel', () => {
    const point = { x: 200, y: 600 };
    expect(sidewaysStep(point, LAPTOP)).toBe(0);
    expect(upOrDownStep(point, LAPTOP)).toBe(380 - REVEAL_MARGIN - REVEAL_SLACK - 600);
    const after = steppedAside(point, LAPTOP);
    expect(after).toEqual({ x: 200, y: 380 - REVEAL_MARGIN - REVEAL_SLACK });
    expect(isInTheOpen(after!, LAPTOP)).toBe(true);
  });

  it('too close to the top or the bottom of the map: down or up by what is missing', () => {
    expect(upOrDownStep({ x: 640, y: 50 }, LAPTOP)).toBe(44 + REVEAL_MARGIN + REVEAL_SLACK - 50);
    expect(upOrDownStep({ x: 640, y: 790 }, LAPTOP)).toBe(800 - REVEAL_MARGIN - REVEAL_SLACK - 790);
  });

  it('under a panel with NO room above it (a low window): sideways to the nearest place beside a panel that has room', () => {
    const point = { x: 200, y: 217 };
    const dx = sidewaysStep(point, SIDEWAYS);
    expect(dx).toBe(328 + REVEAL_MARGIN + REVEAL_SLACK - 200);
    const after = steppedAside(point, SIDEWAYS);
    expect(after).toEqual({ x: 328 + REVEAL_MARGIN + REVEAL_SLACK, y: 217 });
    expect(isInTheOpen(after!, SIDEWAYS)).toBe(true);
  });

  it('no place on the map has room (panels from edge to edge, as tall as the map): the map is left alone', () => {
    const packed: RevealSurroundings = {
      map: { left: 0, top: 44, right: 700, bottom: 390 },
      leftCorner: { left: 8, top: 52, right: 380, bottom: 382 },
      rightCorner: { left: 388, top: 52, right: 692, bottom: 382 },
    };
    expect(sidewaysStep({ x: 200, y: 217 }, packed)).toBeNull();
    expect(steppedAside({ x: 200, y: 217 }, packed)).toBeNull();
  });

  it('beyond the side of the map, or closer to it than the margin: sideways, back to the margin', () => {
    // The phone was turned from sideways to upright with the city at x 422: the canvas is 390 wide now.
    expect(sidewaysStep({ x: 422, y: 200 }, UPRIGHT)).toBe(390 - REVEAL_MARGIN - REVEAL_SLACK - 422);
    expect(sidewaysStep({ x: 377, y: 200 }, UPRIGHT)).toBe(390 - REVEAL_MARGIN - REVEAL_SLACK - 377);
    expect(sidewaysStep({ x: -30, y: 200 }, UPRIGHT)).toBe(REVEAL_MARGIN + REVEAL_SLACK + 30);
    expect(sidewaysStep({ x: 10, y: 200 }, UPRIGHT)).toBe(REVEAL_MARGIN + REVEAL_SLACK - 10);
    // Exactly on the margin is in the open and stays.
    expect(sidewaysStep({ x: 390 - REVEAL_MARGIN, y: 200 }, UPRIGHT)).toBe(0);
    for (const x of [422, 377, -30, 10]) {
      const after = steppedAside({ x, y: 200 }, UPRIGHT);
      expect(after, `from x ${x}`).not.toBeNull();
      expect(isInTheOpen(after!, UPRIGHT), `from x ${x}`).toBe(true);
    }
  });

  it('beyond the side AND off the bottom (the window got narrower and lower at once): both steps, and the tile is in the open', () => {
    const after = steppedAside({ x: 700, y: 380 }, UPRIGHT);
    expect(after).toEqual({ x: 390 - REVEAL_MARGIN - REVEAL_SLACK, y: 345 - REVEAL_MARGIN - REVEAL_SLACK });
    expect(isInTheOpen(after!, UPRIGHT)).toBe(true);
  });

  it('brought back from beyond the left edge it lands under the panel that floats there, and goes on to the place beside it', () => {
    // A low window whose left part is all panel: the margin alone would put the tile under it.
    const point = { x: -100, y: 217 };
    const after = steppedAside(point, SIDEWAYS);
    expect(after).toEqual({ x: 328 + REVEAL_MARGIN + REVEAL_SLACK, y: 217 });
    expect(isInTheOpen(after!, SIDEWAYS)).toBe(true);
  });

  it('a map area narrower than two margins has no place inside the margins: the tile goes to its middle', () => {
    const sliver: RevealSurroundings = { map: { left: 0, top: 44, right: 60, bottom: 400 }, leftCorner: NOTHING, rightCorner: NOTHING };
    expect(sidewaysStep({ x: 200, y: 200 }, sliver)).toBe(30 - 200);
    expect(sidewaysStep({ x: 30, y: 200 }, sliver)).toBe(0);
  });

  it('wherever a tile is, on or off the screen, after both steps it is in the open (laptop, phone sideways, phone upright)', () => {
    for (const around of [LAPTOP, SIDEWAYS, UPRIGHT]) {
      for (let x = -200; x <= around.map.right + 200; x += 37) {
        for (let y = -100; y <= around.map.bottom + 200; y += 41) {
          const after = steppedAside({ x, y }, around);
          expect(after, `from (${x}, ${y})`).not.toBeNull();
          expect(isInTheOpen(after!, around), `from (${x}, ${y}) to (${after!.x}, ${after!.y})`).toBe(true);
          // And a tile that was in the open is not moved at all.
          if (isInTheOpen({ x, y }, around)) expect(after).toEqual({ x, y });
        }
      }
    }
  });
});
