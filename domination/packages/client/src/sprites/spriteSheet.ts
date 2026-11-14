/**
 * Where the renderer gets its pictures (work package WP5).
 *
 * The renderer only knows the `SpriteSheet` interface. Phase 1 fills it from
 * text sprites (createTextSpriteSheet). A later phase can add a
 * PNG-backed implementation of the same interface (an image plus a JSON
 * list of rectangles) without touching the renderer.
 */

import { CIVS, CIV_IDS } from '@domination/shared';
import type { CivId, FeatureId, TerrainId, UnitTypeId } from '@domination/shared';
import type { MarkerId } from './art/markers';
import { packImages } from './atlas';
import { imageToCanvas } from './canvas';
import { BARE_VERSION, RIM_VERSION, buildCatalog, featureOf, groundTerrain, groundVariantCount, isUnitSprite } from './catalog';
import type { OwnerColors, RasterImage } from './format';
import { SPRITE_LOOKS, imageWithLook } from './looks';
import type { SpriteLook } from './looks';
import { rasterizeSprite } from './rasterize';
import { RIM_ROWS_ADDED, imageWithRim } from './rim';

/**
 * Every sprite the game needs. Adding a terrain, feature or unit type to the tables adds an id here automatically.
 * The markers are the selection ring and the highlights (sprites/art/markers.ts).
 */
export type SpriteId =
  | `ground.${TerrainId}`
  | `feature.${FeatureId}`
  | `unit.${UnitTypeId}`
  | 'city'
  | `marker.${MarkerId}`;

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

/** The finer choices when asking for a sprite. Everything is optional. */
export interface SpriteOptions {
  /** 'fogged' for things on explored tiles out of sight, 'spent' for a unit without moves (see looks.ts). Default 'normal'. */
  look?: SpriteLook;
  /**
   * Ground sprites only: any whole number, normally the tile index. The
   * sheet turns it into one of the terrain's variants, always the same one
   * for the same number, so a tile keeps its look. Default 0.
   */
  variant?: number;
  /**
   * Ground sprites only: true for the ground without decorations, which
   * goes under a feature (`variant` is then ignored). Default false.
   */
  bare?: boolean;
  /**
   * Feature sprites only: the terrain the feature stands on (hills are
   * sand-coloured on desert). Default 'grassland'.
   */
  on?: TerrainId;
  /**
   * Unit sprites only: true for the picture with a pale line around the
   * figure, which keeps a unit among trees from getting lost (rim.ts).
   * Default false.
   */
  rim?: boolean;
}

export interface SpriteSheet {
  /**
   * The sprite for an id. Ground and feature sprites ignore `owner`. Unit
   * and city sprites are tinted in the owner's colours and need it; without
   * an owner they come in neutral grey (NEUTRAL_OWNER), so that something
   * owned by a player the view does not list is still drawn.
   * The same call always returns the same Sprite (cached).
   */
  get(id: SpriteId, owner?: CivId, options?: SpriteOptions): Sprite;
}

/** Colours for units and cities whose owner is not known. */
export const NEUTRAL_OWNER: OwnerColors = { primary: '#8088a0', secondary: '#f8f0d8' };

/** One finished picture of the sheet, before it is put on a canvas. */
export interface SpriteImage {
  /** Its name on the sheet (see spriteKey). */
  key: string;
  image: RasterImage;
  offsetX: number;
  offsetY: number;
}

/** The name of one picture: which sprite, which version of it, whose colours, which look. */
export function spriteKey(id: SpriteId, version: string, owner: CivId | 'neutral' | '', look: SpriteLook): string {
  return `${id}|${version}|${owner}|${look}`;
}

/**
 * Rasterises every text sprite of src/sprites/art/: every version of every
 * id, sprites in owner colours once per civilization (and once in neutral
 * grey), and each of those in every look. The 'rim' version of a unit gets
 * its pale line here. Pure: no canvas, so tests can check all of the art in
 * Node. Throws, naming the sprite, if one is broken.
 */
export function buildSpriteImages(): SpriteImage[] {
  const images: SpriteImage[] = [];
  for (const entry of buildCatalog()) {
    const owners: (CivId | 'neutral' | '')[] = entry.owned ? [...CIV_IDS, 'neutral'] : [''];
    for (const owner of owners) {
      let image: RasterImage;
      try {
        image = rasterizeSprite(entry.source, ownerColors(owner));
        if (entry.rim) image = imageWithRim(image);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`The sprite '${entry.id}' (version '${entry.version}') is broken: ${reason}`);
      }
      for (const look of SPRITE_LOOKS) {
        images.push({
          key: spriteKey(entry.id, entry.version, owner, look),
          image: imageWithLook(image, look),
          offsetX: entry.source.offsetX ?? 0,
          // The rows the line needed on top (rim.ts) must not push the figure down.
          offsetY: (entry.source.offsetY ?? 0) - (entry.rim ? RIM_ROWS_ADDED : 0),
        });
      }
    }
  }
  return images;
}

function ownerColors(owner: CivId | 'neutral' | ''): OwnerColors | undefined {
  if (owner === '') return undefined;
  if (owner === 'neutral') return NEUTRAL_OWNER;
  return { primary: CIVS[owner].primary, secondary: CIVS[owner].secondary };
}

/**
 * Which variant of a ground a number (a tile index) gets. The number is
 * scrambled first: taking it modulo the count directly would paint stripes
 * across the map, because tile indexes run along the rows.
 */
export function pickVariant(value: number, count: number): number {
  let mixed = Math.imul(value | 0, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) % count;
}

/** Width of the sheet in pixels; its height grows with the number of sprites. */
const SHEET_WIDTH = 512;

/**
 * Builds the phase 1 sprite sheet: rasterises every text sprite of
 * src/sprites/art/ (unit and city sprites once per civilization) onto
 * offscreen canvases. Called once at start-up; throws if any sprite is
 * broken.
 */
export function createTextSpriteSheet(): SpriteSheet {
  const images = buildSpriteImages();
  const packed = packImages(images.map((entry) => entry.image), SHEET_WIDTH);
  const canvas = imageToCanvas(packed.sheet);

  const sprites = new Map<string, Sprite>();
  images.forEach((entry, index) => {
    sprites.set(entry.key, {
      image: canvas,
      sx: packed.places[index].x,
      sy: packed.places[index].y,
      width: entry.image.width,
      height: entry.image.height,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
    });
  });
  const ownedIds = new Set(buildCatalog().filter((entry) => entry.owned).map((entry) => entry.id));

  return {
    get(id, owner, options = {}) {
      const key = spriteKey(id, versionFor(id, options), ownedIds.has(id) ? owner ?? 'neutral' : '', options.look ?? 'normal');
      const sprite = sprites.get(key);
      if (sprite === undefined) throw new Error(`There is no sprite '${key}'.`);
      return sprite;
    },
  };
}

/** Which picture of an id the options ask for (the versions are explained in catalog.ts). */
function versionFor(id: SpriteId, options: SpriteOptions): string {
  const terrain = groundTerrain(id);
  if (terrain !== null) {
    return options.bare ? BARE_VERSION : String(pickVariant(options.variant ?? 0, groundVariantCount(terrain)));
  }
  if (featureOf(id) !== null) return options.on ?? 'grassland';
  if (isUnitSprite(id)) return options.rim ? RIM_VERSION : '';
  return '';
}
