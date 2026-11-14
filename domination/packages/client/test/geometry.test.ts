import { describe, expect, it } from 'vitest';
import { inBounds, neighborCoord } from '@domination/shared';
import {
  HEX_PIXEL_COUNT,
  TILE_HEIGHT,
  TILE_WIDTH,
  hexRowSpan,
  isInsideHex,
  mapPixelSize,
  pixelToTile,
  tileCenter,
  tileOrigin,
} from '../src/render/geometry';

/**
 * The approved pixel hexagon, exactly as written in the project brief and in
 * docs/art/style-d-reference.svg (an SVG path that only uses M, h, v and z).
 */
const HEX_OUTLINE =
  'M11 0h4v1h2v1h2v1h2v1h2v1h2v1h1v16h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-16h1v-1h2v-1h2v-1h2v-1h2v-1h2v-1z';

/** Fills the outline path into a 26 x 28 grid of booleans (independent of geometry.ts). */
function rasterizeOutline(path: string): boolean[][] {
  // Walk the path and remember its vertical edges.
  const verticalEdges: { x: number; y0: number; y1: number }[] = [];
  let x = 0;
  let y = 0;
  for (const match of path.matchAll(/([Mhv])\s*(-?\d+)(?:\s+(-?\d+))?/g)) {
    const [, command, first, second] = match;
    if (command === 'M') {
      x = Number(first);
      y = Number(second);
    } else if (command === 'h') {
      x += Number(first);
    } else {
      const nextY = y + Number(first);
      verticalEdges.push({ x, y0: Math.min(y, nextY), y1: Math.max(y, nextY) });
      y = nextY;
    }
  }
  // A pixel is inside if an odd number of vertical edges lie to its left on its row.
  const grid: boolean[][] = [];
  for (let row = 0; row < TILE_HEIGHT; row++) {
    const line: boolean[] = [];
    for (let column = 0; column < TILE_WIDTH; column++) {
      const crossings = verticalEdges.filter(
        (edge) => edge.x <= column && row >= edge.y0 && row < edge.y1,
      ).length;
      line.push(crossings % 2 === 1);
    }
    grid.push(line);
  }
  return grid;
}

describe('the pixel hexagon', () => {
  it('is exactly the approved outline, pixel for pixel', () => {
    const outline = rasterizeOutline(HEX_OUTLINE);
    let count = 0;
    for (let y = 0; y < TILE_HEIGHT; y++) {
      for (let x = 0; x < TILE_WIDTH; x++) {
        expect(isInsideHex(x, y)).toBe(outline[y][x]);
        if (outline[y][x]) count += 1;
      }
    }
    expect(count).toBe(HEX_PIXEL_COUNT);
    expect(count).toBe(26 * 22);
  });

  it('has the documented row widths', () => {
    expect(hexRowSpan(0)).toEqual([11, 14]);
    expect(hexRowSpan(5)).toEqual([1, 24]);
    expect(hexRowSpan(6)).toEqual([0, 25]);
    expect(hexRowSpan(21)).toEqual([0, 25]);
    expect(hexRowSpan(22)).toEqual([2, 23]);
    expect(hexRowSpan(27)).toEqual([12, 13]);
    expect(isInsideHex(0, -1)).toBe(false);
    expect(isInsideHex(13, 28)).toBe(false);
  });
});

describe('tile placement', () => {
  it('uses column pitch 26, row pitch 22 and shifts odd rows right by 13', () => {
    expect(tileOrigin({ x: 0, y: 0 })).toEqual({ px: 0, py: 0 });
    expect(tileOrigin({ x: 3, y: 0 })).toEqual({ px: 78, py: 0 });
    expect(tileOrigin({ x: 0, y: 1 })).toEqual({ px: 13, py: 22 });
    expect(tileOrigin({ x: 2, y: 3 })).toEqual({ px: 65, py: 66 });
    expect(tileOrigin({ x: 2, y: 4 })).toEqual({ px: 52, py: 88 });
    expect(tileCenter({ x: 0, y: 0 })).toEqual({ px: 13, py: 14 });
  });

  it('matches the positions used in the reference picture (shown there at 4x)', () => {
    // In the SVG, tile (1, 1) is drawn at x=156, y=88 and tile (2, 2) at x=208, y=176.
    expect(tileOrigin({ x: 1, y: 1 })).toEqual({ px: 156 / 4, py: 88 / 4 });
    expect(tileOrigin({ x: 2, y: 2 })).toEqual({ px: 208 / 4, py: 176 / 4 });
  });

  it('measures whole maps', () => {
    expect(mapPixelSize({ width: 56, height: 36 })).toEqual({ width: 1469, height: 798 });
    expect(mapPixelSize({ width: 1, height: 1 })).toEqual({ width: 39, height: 28 });
  });
});

describe('tiling and hit testing', () => {
  const GRID = { width: 12, height: 12 };
  const { width, height } = mapPixelSize(GRID);

  // Paint every tile's hexagon onto one big canvas of counters.
  const owner: (string | null)[][] = [];
  const coverage: number[][] = [];
  for (let py = 0; py < height; py++) {
    owner.push(new Array(width).fill(null));
    coverage.push(new Array(width).fill(0));
  }
  for (let y = 0; y < GRID.height; y++) {
    for (let x = 0; x < GRID.width; x++) {
      const origin = tileOrigin({ x, y });
      for (let ly = 0; ly < TILE_HEIGHT; ly++) {
        for (let lx = 0; lx < TILE_WIDTH; lx++) {
          if (!isInsideHex(lx, ly)) continue;
          coverage[origin.py + ly][origin.px + lx] += 1;
          owner[origin.py + ly][origin.px + lx] = `${x},${y}`;
        }
      }
    }
  }

  it('tiles without overlaps, and without gaps away from the ragged map edge', () => {
    let overlaps = 0;
    let interiorGaps = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (coverage[py][px] > 1) overlaps += 1;
        // Stay clear of the outermost tiles, where the zig-zag edge is expected.
        const interior = px >= 26 && px < width - 39 && py >= 6 && py < height - 6;
        if (interior && coverage[py][px] === 0) interiorGaps += 1;
      }
    }
    expect(overlaps).toBe(0);
    expect(interiorGaps).toBe(0);
  });

  it('pixelToTile returns the tile that was painted there, for every pixel', () => {
    let checked = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const hit = pixelToTile(px, py);
        if (owner[py][px] !== null) {
          expect(`${hit.x},${hit.y}`).toBe(owner[py][px]);
          checked += 1;
        } else {
          // Unpainted pixels lie outside the map.
          expect(inBounds(hit, GRID)).toBe(false);
        }
      }
    }
    expect(checked).toBe(GRID.width * GRID.height * HEX_PIXEL_COUNT);
  });

  it('accepts fractional and negative positions', () => {
    expect(pixelToTile(13.9, 14.2)).toEqual({ x: 0, y: 0 });
    expect(pixelToTile(-1, 10)).toEqual({ x: -1, y: 0 });
    expect(inBounds(pixelToTile(-5, -5), GRID)).toBe(false);
    // The centre of a tile is always inside that tile.
    for (const c of [{ x: 0, y: 0 }, { x: 5, y: 3 }, { x: 11, y: 11 }, { x: 4, y: 8 }]) {
      const center = tileCenter(c);
      expect(pixelToTile(center.px, center.py)).toEqual(c);
    }
  });

  it('agrees with the shared hex maths about who the neighbors are', () => {
    const c = { x: 5, y: 5 };
    const center = tileCenter(c);
    // Stepping one tile pitch in each of the six directions lands in that neighbor.
    const steps = [
      { dx: 26, dy: 0 },
      { dx: 13, dy: 22 },
      { dx: -13, dy: 22 },
      { dx: -26, dy: 0 },
      { dx: -13, dy: -22 },
      { dx: 13, dy: -22 },
    ];
    steps.forEach((step, direction) => {
      expect(pixelToTile(center.px + step.dx, center.py + step.dy)).toEqual(neighborCoord(c, direction));
    });
  });
});
