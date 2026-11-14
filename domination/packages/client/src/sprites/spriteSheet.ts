/**
 * Where the renderer gets its pictures (work package WP5).
 *
 * The renderer only knows the `SpriteSheet` interface. Phase 1 fills it from
 * text sprites (createTextSpriteSheet). A later phase can add a
 * PNG-backed implementation of the same interface (an image plus a JSON
 * list of rectangles) without touching the renderer.
 */

import type { CivId, FeatureId, TerrainId, UnitTypeId } from '@domination/shared';

/** Every sprite the game needs. Adding a terrain, feature or unit type to the tables adds an id here automatically. */
export type SpriteId = `ground.${TerrainId}` | `feature.${FeatureId}` | `unit.${UnitTypeId}` | 'city';

/** One picture, ready for `context.drawImage(image, sx, sy, width, height, ...)`. */
export interface Sprite {
  /** The canvas or image that holds the pixels (possibly many sprites on one sheet). */
  image: CanvasImageSource;
  /** Where the sprite is on `image`. */
  sx: number;
  sy: number;
  /** Size in art pixels. */
  width: number;
  height: number;
  /** Where its top-left corner goes relative to the tile's 26 x 28 box. */
  offsetX: number;
  offsetY: number;
}

export interface SpriteSheet {
  /**
   * The sprite for an id. Ground and feature sprites ignore `owner`. Unit
   * and city sprites are tinted in the owner's colours and need it.
   * The same call always returns the same Sprite (cached).
   */
  get(id: SpriteId, owner?: CivId): Sprite;
}

/**
 * Builds the phase 1 sprite sheet: rasterises every text sprite of
 * src/sprites/art/ (unit and city sprites once per civilization) onto
 * offscreen canvases. Called once at start-up; throws if any sprite is
 * broken.
 */
export function createTextSpriteSheet(): SpriteSheet {
  throw new Error('not implemented: createTextSpriteSheet');
}
