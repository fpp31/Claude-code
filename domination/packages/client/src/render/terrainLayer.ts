/**
 * The part of the map that only changes when the view does
 * (work package WP5): ground, territory borders and features, painted onto
 * an offscreen canvas at one canvas pixel per art pixel.
 *
 * Why: panning and zooming then cost one image copy per frame, however
 * large the map is, instead of thousands of small ones. And because the
 * finished picture is enlarged as ONE image by a whole number, there can be
 * no seams between hexagons at any zoom.
 *
 * Keeping the picture up to date is cheap too: when a view differs from the
 * last one in a few tiles (a unit moved and the fog shifted), only those
 * tiles and what touches them are painted again.
 */

import { jsonEqual, neighbors, tileCoord } from '@domination/shared';
import type { CivId, PlayerId, PlayerView, TileIndex, TileView } from '@domination/shared';
import { context2d, imageToCanvas } from '../sprites/canvas';
import { imageWithLook } from '../sprites/looks';
import type { SpriteLook } from '../sprites/looks';
import type { Sprite, SpriteSheet } from '../sprites/spriteSheet';
import { borderEdges, borderStripImage } from './borders';
import { TILE_HEIGHT, TILE_WIDTH, mapPixelSize, tileOrigin } from './geometry';
import { ownerColors } from './owners';

/**
 * Empty art pixels around the map on the layer, so that a sprite which
 * sticks out of its tile at the edge of the map is not cut off.
 */
export const LAYER_PADDING = 8;

/**
 * If more than this share of the tiles changed, painting everything afresh
 * is quicker than patching.
 */
const PATCH_AT_MOST = 0.25;

export interface TerrainLayer {
  /** The picture. Art pixel (0, 0) of the map is at (LAYER_PADDING, LAYER_PADDING). */
  readonly canvas: HTMLCanvasElement;
  /**
   * Brings the picture up to date with a view. The first time, and when the
   * map size or the players' colours changed, everything is painted afresh.
   * Otherwise only the tiles that differ from the last view are painted
   * again, together with their neighbors; if nothing differs, nothing is
   * painted.
   */
  update(view: PlayerView, civs: Map<PlayerId, CivId>): void;
}

/** What the picture was last painted from. */
interface Painted {
  tiles: readonly (TileView | null)[];
  width: number;
  height: number;
  /** Who plays which civilization, as one text: that decides the colours of the borders. */
  colors: string;
}

export function createTerrainLayer(sheet: SpriteSheet): TerrainLayer {
  const canvas = document.createElement('canvas');
  const context = context2d(canvas);
  let painted: Painted | null = null;

  // Border strips already made, by colours, edges and look. A game needs a
  // few dozen at most (6 edges give 63 shapes per civilization and look).
  const strips = new Map<string, HTMLCanvasElement>();

  function borderStrip(civ: CivId | undefined, edges: number, look: SpriteLook): HTMLCanvasElement {
    const key = `${civ ?? 'neutral'}|${edges}|${look}`;
    let strip = strips.get(key);
    if (strip === undefined) {
      strip = imageToCanvas(imageWithLook(borderStripImage(edges, ownerColors(civ)), look));
      strips.set(key, strip);
    }
    return strip;
  }

  function stamp(sprite: Sprite, px: number, py: number): void {
    context.drawImage(
      sprite.image,
      sprite.sx, sprite.sy, sprite.width, sprite.height,
      LAYER_PADDING + px + sprite.offsetX, LAYER_PADDING + py + sprite.offsetY, sprite.width, sprite.height,
    );
  }

  /**
   * Paints the given tiles (in ascending order) in three passes, each from
   * the top row down, so that every border lies on the ground and every
   * feature on the borders, and a tall feature overlaps the row behind it.
   */
  function paintTiles(view: PlayerView, civs: Map<PlayerId, CivId>, tiles: Iterable<TileIndex>): void {
    const list = [...tiles];
    for (const index of list) {
      const tile = view.tiles[index];
      if (tile === null) continue; // never seen: stays empty
      const origin = tileOrigin(tileCoord(index, view));
      const look: SpriteLook = tile.visible ? 'normal' : 'fogged';
      // Under a feature the ground is bare, as in the reference picture.
      const ground = sheet.get(`ground.${tile.terrain}`, undefined, { look, variant: index, bare: tile.feature !== null });
      stamp(ground, origin.px, origin.py);
    }
    for (const index of list) {
      const tile = view.tiles[index];
      if (tile === null || tile.owner === null) continue;
      const edges = borderEdges(view, index);
      if (edges === 0) continue;
      const origin = tileOrigin(tileCoord(index, view));
      const strip = borderStrip(civs.get(tile.owner), edges, tile.visible ? 'normal' : 'fogged');
      context.drawImage(strip, LAYER_PADDING + origin.px, LAYER_PADDING + origin.py);
    }
    for (const index of list) {
      const tile = view.tiles[index];
      if (tile === null || tile.feature === null) continue;
      const origin = tileOrigin(tileCoord(index, view));
      const look: SpriteLook = tile.visible ? 'normal' : 'fogged';
      stamp(sheet.get(`feature.${tile.feature}`, undefined, { look, on: tile.terrain }), origin.px, origin.py);
    }
  }

  function paintEverything(view: PlayerView, civs: Map<PlayerId, CivId>): void {
    // Setting the size also wipes the canvas.
    const size = mapPixelSize(view);
    canvas.width = size.width + 2 * LAYER_PADDING;
    canvas.height = size.height + 2 * LAYER_PADDING;
    paintTiles(view, civs, view.tiles.keys());
  }

  /**
   * Paints again only around the tiles that changed.
   *
   * What has to be wiped is the 26 x 28 box of every changed tile, and of
   * every neighbor of one (a tile's border strip depends on who owns its
   * neighbors). What has to be painted into the wiped boxes is those tiles
   * and, once more, THEIR neighbors: a sprite never leaves its own tile box,
   * and a box only overlaps the boxes of the six tiles around it. The
   * canvas is told to draw nowhere but in the wiped boxes ("clip"), so the
   * tiles painted for the second reason leave everything else as it is.
   */
  function paintAround(view: PlayerView, civs: Map<PlayerId, CivId>, changed: TileIndex[]): void {
    const wiped = new Set<TileIndex>();
    for (const tile of changed) {
      wiped.add(tile);
      for (const neighbor of neighbors(tile, view)) wiped.add(neighbor);
    }
    const toPaint = new Set<TileIndex>(wiped);
    for (const tile of wiped) {
      for (const neighbor of neighbors(tile, view)) toPaint.add(neighbor);
    }

    context.save();
    context.beginPath();
    for (const tile of wiped) {
      const origin = tileOrigin(tileCoord(tile, view));
      context.rect(LAYER_PADDING + origin.px, LAYER_PADDING + origin.py, TILE_WIDTH, TILE_HEIGHT);
    }
    context.clip();
    context.clearRect(0, 0, canvas.width, canvas.height);
    paintTiles(view, civs, [...toPaint].sort((a, b) => a - b));
    context.restore();
  }

  return {
    canvas,

    update(view, civs) {
      const colors = [...civs].map(([player, civ]) => `${player}=${civ}`).join(' ');
      const before = painted;
      painted = { tiles: view.tiles, width: view.width, height: view.height, colors };

      const sameMap = before !== null && before.width === view.width && before.height === view.height && before.colors === colors;
      if (!sameMap) {
        paintEverything(view, civs);
        return;
      }
      if (before.tiles === view.tiles) return; // views share the array for as long as no tile changes

      // Compared as whole tiles (like the shared diffViews), so that a field
      // added to a tile later cannot be forgotten here. Unchanged tiles are
      // usually the very same object, which jsonEqual sees at once.
      const changed: TileIndex[] = [];
      view.tiles.forEach((tile, index) => {
        if (!jsonEqual(before.tiles[index], tile)) changed.push(index);
      });
      if (changed.length === 0) return;
      if (changed.length > view.tiles.length * PATCH_AT_MOST) paintEverything(view, civs);
      else paintAround(view, civs, changed);
    },
  };
}
