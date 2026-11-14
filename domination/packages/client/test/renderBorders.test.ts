import { describe, expect, it } from 'vitest';
import { DIRECTION_COUNT, inBounds, neighborInDirection, tileCoord, tileCount, tileIndex } from '@domination/shared';
import type { PlayerId, PlayerView, TileView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { BORDER_INNER, BORDER_OUTER, borderEdges, borderStripImage } from '../src/render/borders';
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  hexDepth,
  hexEdgeDepth,
  isInsideHex,
  mapPixelSize,
  pixelToTile,
  tileOrigin,
} from '../src/render/geometry';
import { getPixel } from '../src/sprites/image';

/**
 * Territory borders (WP5): which edges of a tile get a strip, what a strip
 * looks like, and that the strips of a whole territory join into one closed
 * line. Pure functions, plain Node.
 */

const E = 0, SE = 1, SW = 2, W = 3, NW = 4, NE = 5;
const COLORS = { primary: '#c81e1e', secondary: '#f6dc8c' };
const PRIMARY = [0xc8, 0x1e, 0x1e, 255];
const SECONDARY = [0xf6, 0xdc, 0x8c, 255];
const NOTHING = [0, 0, 0, 0];

/** A fully explored map of grassland where `ownerAt` decides who owns each tile. */
function landView(width: number, height: number, ownerAt: (x: number, y: number) => PlayerId | null): PlayerView {
  const tiles: (TileView | null)[] = [];
  for (let tile = 0; tile < width * height; tile++) {
    const { x, y } = tileCoord(tile, { width, height });
    tiles.push({ terrain: 'grassland', feature: null, owner: ownerAt(x, y), visible: true });
  }
  return {
    you: 'p1', turn: 1, width, height, tiles, units: [], cities: [],
    players: [
      { id: 'p1', name: 'Ada', civ: 'rome', endedTurn: false },
      { id: 'p2', name: 'Ben', civ: 'egypt', endedTurn: false },
    ],
  };
}

describe('hexEdgeDepth and hexDepth (WP5)', () => {
  it('a pixel is inside the hexagon exactly when it is on the inner side of all six edges', () => {
    for (let y = -6; y < TILE_HEIGHT + 6; y++) {
      for (let x = -6; x < TILE_WIDTH + 6; x++) {
        let allInside = true;
        for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
          if (hexEdgeDepth(x, y, direction) < 0) allInside = false;
        }
        expect(allInside, `(${x}, ${y})`).toBe(isInsideHex(x, y));
        expect(hexDepth(x, y) >= 0).toBe(isInsideHex(x, y));
      }
    }
  });

  it('depth 0 is exactly the outermost line of pixels: those with a pixel outside the hexagon next to them', () => {
    for (let y = 0; y < TILE_HEIGHT; y++) {
      for (let x = 0; x < TILE_WIDTH; x++) {
        if (!isInsideHex(x, y)) continue;
        const onTheRim =
          !isInsideHex(x + 1, y) || !isInsideHex(x - 1, y) || !isInsideHex(x, y + 1) || !isInsideHex(x, y - 1);
        expect(hexDepth(x, y) === 0, `(${x}, ${y})`).toBe(onTheRim);
      }
    }
  });

  it('counts upright edges in pixels across and slanted edges in rows of their staircase', () => {
    // Along row 10 (full width): the east edge is at column 25, the west edge at column 0.
    expect([25, 24, 23, 0].map((x) => hexEdgeDepth(x, 10, E))).toEqual([0, 1, 2, 25]);
    expect([0, 1, 2, 25].map((x) => hexEdgeDepth(x, 10, W))).toEqual([0, 1, 2, 25]);
    // Row 3 of the pointed top spans columns 5..20; the staircase moves 2 pixels per row.
    expect([20, 19, 18, 17, 16, 15].map((x) => hexEdgeDepth(x, 3, NE))).toEqual([0, 0, 1, 1, 2, 2]);
    expect([5, 6, 7, 8, 9, 10].map((x) => hexEdgeDepth(x, 3, NW))).toEqual([0, 0, 1, 1, 2, 2]);
    // Row 24 of the pointed bottom spans columns 6..19.
    expect([19, 18, 17, 16].map((x) => hexEdgeDepth(x, 24, SE))).toEqual([0, 0, 1, 1]);
    expect([6, 7, 8, 9].map((x) => hexEdgeDepth(x, 24, SW))).toEqual([0, 0, 1, 1]);
    expect(() => hexEdgeDepth(0, 0, 6)).toThrow();
  });

  it('is mirror-symmetric left to right', () => {
    // (Not top to bottom: the pointed top is 4 pixels wide at its tip and the
    // pointed bottom 2, which is what lets the rows interlock.)
    for (let y = 0; y < TILE_HEIGHT; y++) {
      for (let x = 0; x < TILE_WIDTH; x++) {
        const mirrorX = TILE_WIDTH - 1 - x;
        expect(hexEdgeDepth(x, y, E)).toBe(hexEdgeDepth(mirrorX, y, W));
        expect(hexEdgeDepth(x, y, NE)).toBe(hexEdgeDepth(mirrorX, y, NW));
        expect(hexEdgeDepth(x, y, SE)).toBe(hexEdgeDepth(mirrorX, y, SW));
        expect(hexDepth(x, y)).toBe(hexDepth(mirrorX, y));
      }
    }
  });
});

describe('borderEdges (WP5)', () => {
  it('is 0 for a tile nobody owns, for a never-seen tile, and for a tile surrounded by its owner', () => {
    const view = landView(5, 5, (x) => (x <= 3 ? 'p1' : null));
    expect(borderEdges(view, tileIndex({ x: 4, y: 2 }, view))).toBe(0); // unowned
    expect(borderEdges(view, tileIndex({ x: 1, y: 2 }, view))).toBe(0); // all six neighbors are p1's
    view.tiles[12] = null;
    expect(borderEdges(view, 12)).toBe(0);
  });

  it('marks an edge whose neighbor has no owner or another owner, and only those', () => {
    // Columns 0-1 belong to p1, column 2 to nobody, columns 3-4 to p2.
    const view = landView(5, 5, (x) => (x <= 1 ? 'p1' : x >= 3 ? 'p2' : null));
    // (1, 2) is in an even row, where SE and NE lead to the same column: only E leaves p1's columns.
    expect(borderEdges(view, tileIndex({ x: 1, y: 2 }, view))).toBe(1 << E);
    // (1, 1) is in an odd row, shifted right: E, SE and NE all lead to column 2.
    expect(borderEdges(view, tileIndex({ x: 1, y: 1 }, view))).toBe((1 << E) | (1 << SE) | (1 << NE));
    // p2's side mirrors it: (3, 1) in the odd row touches column 2 only to the west.
    expect(borderEdges(view, tileIndex({ x: 3, y: 1 }, view))).toBe(1 << W);
    expect(borderEdges(view, tileIndex({ x: 3, y: 2 }, view))).toBe((1 << W) | (1 << SW) | (1 << NW));

    // Two owners side by side: both get a strip along the shared edge.
    const split = landView(4, 3, (x) => (x <= 1 ? 'p1' : 'p2'));
    expect(borderEdges(split, tileIndex({ x: 1, y: 0 }, split)) & (1 << E)).not.toBe(0);
    expect(borderEdges(split, tileIndex({ x: 2, y: 0 }, split)) & (1 << W)).not.toBe(0);
  });

  it('treats the edge of the map and a never-seen neighbor as "a different owner"', () => {
    const view = landView(3, 3, () => 'p1');
    // The middle tile is surrounded by p1; the corner tile (0, 0) has only E and SE neighbors on the map.
    expect(borderEdges(view, tileIndex({ x: 1, y: 1 }, view))).toBe(0);
    expect(borderEdges(view, 0)).toBe((1 << SW) | (1 << W) | (1 << NW) | (1 << NE));

    // Forget the middle tile's east neighbor: that edge becomes a border.
    view.tiles[tileIndex({ x: 2, y: 1 }, view)] = null;
    expect(borderEdges(view, tileIndex({ x: 1, y: 1 }, view))).toBe(1 << E);
  });

  it('agrees with the shared hex maths about which neighbor an edge faces', () => {
    const view = sampleView();
    for (let tile = 0; tile < tileCount(view); tile++) {
      const owner = view.tiles[tile]?.owner ?? null;
      const edges = borderEdges(view, tile);
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
        const neighbor = neighborInDirection(tile, direction, view);
        const neighborOwner = neighbor === null ? null : view.tiles[neighbor]?.owner ?? null;
        const expected = owner !== null && neighborOwner !== owner;
        expect((edges & (1 << direction)) !== 0, `tile ${tile}, direction ${direction}`).toBe(expected);
      }
    }
  });
});

describe('borderStripImage (WP5)', () => {
  it('is 2 pixels of the primary colour at the edge and 1 pixel of the secondary colour inside it', () => {
    expect([BORDER_OUTER, BORDER_INNER]).toEqual([2, 1]);

    const east = borderStripImage(1 << E, COLORS);
    for (let y = 6; y <= 21; y++) {
      expect(getPixel(east, 25, y)).toEqual(PRIMARY);
      expect(getPixel(east, 24, y)).toEqual(PRIMARY);
      expect(getPixel(east, 23, y)).toEqual(SECONDARY);
      expect(getPixel(east, 22, y)).toEqual(NOTHING);
      expect(getPixel(east, 0, y)).toEqual(NOTHING); // nothing along the other edges
    }

    // A slanted edge: per row 4 pixels of primary (2 rows of the staircase) and 2 of secondary.
    const northEast = borderStripImage(1 << NE, COLORS);
    expect([20, 19, 18, 17].map((x) => getPixel(northEast, x, 3))).toEqual([PRIMARY, PRIMARY, PRIMARY, PRIMARY]);
    expect([16, 15].map((x) => getPixel(northEast, x, 3))).toEqual([SECONDARY, SECONDARY]);
    expect(getPixel(northEast, 14, 3)).toEqual(NOTHING);
  });

  it('paints nothing outside the hexagon, nothing without edges, and never the middle of the tile (no colour wash)', () => {
    const none = borderStripImage(0, COLORS);
    expect(none.pixels.every((value) => value === 0)).toBe(true);

    for (let edges = 1; edges < 64; edges++) {
      const strip = borderStripImage(edges, COLORS);
      let painted = 0;
      for (let y = 0; y < TILE_HEIGHT; y++) {
        for (let x = 0; x < TILE_WIDTH; x++) {
          const pixel = getPixel(strip, x, y);
          if (pixel[3] === 0) continue;
          painted += 1;
          expect(isInsideHex(x, y), `edges ${edges} at (${x}, ${y})`).toBe(true);
          // Only within 3 lines of pixels of the rim.
          expect(hexDepth(x, y)).toBeLessThan(BORDER_OUTER + BORDER_INNER);
          expect([PRIMARY.join(), SECONDARY.join()]).toContain(pixel.join());
        }
      }
      expect(painted).toBeGreaterThan(0);
      expect(getPixel(strip, 13, 14)).toEqual(NOTHING);
    }

    // All six edges: a closed ring, exactly the three outermost lines of pixels.
    const ring = borderStripImage(63, COLORS);
    for (let y = 0; y < TILE_HEIGHT; y++) {
      for (let x = 0; x < TILE_WIDTH; x++) {
        const depth = hexDepth(x, y);
        const expected = depth < 0 || depth > 2 ? NOTHING : depth < 2 ? PRIMARY : SECONDARY;
        expect(getPixel(ring, x, y), `(${x}, ${y})`).toEqual(expected);
      }
    }
  });

  it('the strips of a territory join into one closed line: every pixel on its outer edge is in the primary colour', () => {
    // An irregular territory that touches the map edge, has a dent and encloses a foreign tile.
    const mine = new Set(['1,0', '2,0', '0,1', '1,1', '2,1', '3,1', '1,2', '3,2', '4,2', '1,3', '2,3', '3,3', '2,4', '0,4']);
    const view = landView(6, 6, (x, y) => (mine.has(`${x},${y}`) ? 'p1' : x === 2 && y === 2 ? 'p2' : null));
    const size = mapPixelSize(view);

    // Paint every tile's strip where the renderer would: a map of "is this art pixel primary?".
    const primary = new Set<number>();
    const painted = new Set<number>();
    for (let tile = 0; tile < tileCount(view); tile++) {
      const edges = borderEdges(view, tile);
      if (view.tiles[tile]!.owner !== 'p1') continue;
      const strip = borderStripImage(edges, COLORS);
      const origin = tileOrigin(tileCoord(tile, view));
      for (let y = 0; y < TILE_HEIGHT; y++) {
        for (let x = 0; x < TILE_WIDTH; x++) {
          const pixel = getPixel(strip, x, y);
          if (pixel[3] === 0) continue;
          const at = (origin.py + y) * size.width + origin.px + x;
          painted.add(at);
          if (pixel.join() === PRIMARY.join()) primary.add(at);
        }
      }
    }

    const ownerOfPixel = (px: number, py: number): PlayerId | null => {
      const coord = pixelToTile(px, py);
      return inBounds(coord, view) ? view.tiles[tileIndex(coord, view)]!.owner : null;
    };
    let rimPixels = 0;
    for (let py = 0; py < size.height; py++) {
      for (let px = 0; px < size.width; px++) {
        const at = py * size.width + px;
        if (ownerOfPixel(px, py) !== 'p1') {
          // Strips are drawn inside the owner's tiles only.
          expect(painted.has(at), `(${px}, ${py}) is not p1's`).toBe(false);
          continue;
        }
        const onTheRim =
          ownerOfPixel(px + 1, py) !== 'p1' || ownerOfPixel(px - 1, py) !== 'p1' ||
          ownerOfPixel(px, py + 1) !== 'p1' || ownerOfPixel(px, py - 1) !== 'p1';
        if (onTheRim) {
          rimPixels += 1;
          expect(primary.has(at), `rim pixel (${px}, ${py})`).toBe(true);
        }
      }
    }
    expect(rimPixels).toBeGreaterThan(300);
  });
});
