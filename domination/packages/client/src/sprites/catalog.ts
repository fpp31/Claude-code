/**
 * The list of every picture the game has (work package WP5). Pure: no
 * canvas. The sprite sheet rasterises this list; tests walk through it.
 *
 * Most sprite ids have one picture. Four kinds have several VERSIONS:
 *  - a ground has a few variants (the same terrain with its decorations in
 *    other places), named '0', '1', '2'..., and one without decorations for
 *    under a feature or an improvement, named 'bare';
 *  - a feature has one picture per ground it can stand on, named after the
 *    terrain ('grassland', 'desert'...);
 *  - an improvement has one picture per ground, named after the terrain,
 *    like a feature;
 *  - a unit has its picture ('') and the same picture with a pale line
 *    around the figure ('rim'), for standing among trees (rim.ts). Every
 *    unit type has both, the two boats too, so that the sheet needs no
 *    list of exceptions; a boat's 'rim' picture is never drawn, because
 *    there is no forest on water.
 * Everything else has the single version ''.
 */

import { FEATURE_IDS, IMPROVEMENT_IDS, TERRAIN_IDS, UNIT_TYPE_IDS } from '@domination/shared';
import type { FeatureId, ImprovementId, TerrainId, UnitTypeId } from '@domination/shared';
import { city } from './art/buildings';
import { FEATURE_SPRITES } from './art/features';
import { BARE_GROUND_SPRITES, GROUND_SPRITES } from './art/ground';
import { IMPROVEMENT_SPRITES } from './art/improvements';
import { MARKER_IDS, MARKER_SPRITES } from './art/markers';
import { fishingBoat, scout, scoutBoat, settler, warrior, worker } from './art/units';
import type { SpriteSource } from './format';
import type { SpriteId } from './spriteSheet';

const UNIT_SPRITES: Record<UnitTypeId, SpriteSource> = { warrior, scout, settler, worker, fishingBoat, scoutBoat };

export interface CatalogEntry {
  id: SpriteId;
  /** Which picture of the id this is (see the top of this file). */
  version: string;
  source: SpriteSource;
  /** True for sprites drawn in their owner's colours (units and the city): they are rasterised once per civilization. */
  owned: boolean;
  /** True for the version of a unit with the pale line around it: the sheet adds the line after rasterising. */
  rim: boolean;
}

/** The version name of a ground without decorations. */
export const BARE_VERSION = 'bare';

/** The version name of a unit with the pale line around it. */
export const RIM_VERSION = 'rim';

/** Every sprite id, in a fixed order: grounds, features, improvements, units, the city, markers. */
export const ALL_SPRITE_IDS: readonly SpriteId[] = [
  ...TERRAIN_IDS.map((terrain): SpriteId => `ground.${terrain}`),
  ...FEATURE_IDS.map((feature): SpriteId => `feature.${feature}`),
  ...IMPROVEMENT_IDS.map((improvement): SpriteId => `improvement.${improvement}`),
  ...UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`),
  'city',
  ...MARKER_IDS.map((marker): SpriteId => `marker.${marker}`),
];

/** Every picture of every sprite id. */
export function buildCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const terrain of TERRAIN_IDS) {
    GROUND_SPRITES[terrain].forEach((source, variant) => {
      entries.push({ id: `ground.${terrain}`, version: String(variant), source, owned: false, rim: false });
    });
    entries.push({ id: `ground.${terrain}`, version: BARE_VERSION, source: BARE_GROUND_SPRITES[terrain], owned: false, rim: false });
  }
  for (const feature of FEATURE_IDS) {
    for (const terrain of TERRAIN_IDS) {
      entries.push({ id: `feature.${feature}`, version: terrain, source: FEATURE_SPRITES[feature][terrain], owned: false, rim: false });
    }
  }
  for (const improvement of IMPROVEMENT_IDS) {
    for (const terrain of TERRAIN_IDS) {
      entries.push({
        id: `improvement.${improvement}`, version: terrain, source: IMPROVEMENT_SPRITES[improvement][terrain], owned: false, rim: false,
      });
    }
  }
  for (const unitType of UNIT_TYPE_IDS) {
    entries.push({ id: `unit.${unitType}`, version: '', source: UNIT_SPRITES[unitType], owned: true, rim: false });
    entries.push({ id: `unit.${unitType}`, version: RIM_VERSION, source: UNIT_SPRITES[unitType], owned: true, rim: true });
  }
  entries.push({ id: 'city', version: '', source: city, owned: true, rim: false });
  for (const marker of MARKER_IDS) {
    entries.push({ id: `marker.${marker}`, version: '', source: MARKER_SPRITES[marker], owned: false, rim: false });
  }
  return entries;
}

/** How many decorated variants a terrain's ground has (the bare one not counted). */
export function groundVariantCount(terrain: TerrainId): number {
  return GROUND_SPRITES[terrain].length;
}

/** The terrain of a ground sprite id, or null for any other id. */
export function groundTerrain(id: SpriteId): TerrainId | null {
  return TERRAIN_IDS.find((terrain) => id === `ground.${terrain}`) ?? null;
}

/** True for the sprite id of a unit. */
export function isUnitSprite(id: SpriteId): boolean {
  return UNIT_TYPE_IDS.some((unitType) => id === `unit.${unitType}`);
}

/** The feature of a feature sprite id, or null for any other id. */
export function featureOf(id: SpriteId): FeatureId | null {
  return FEATURE_IDS.find((feature) => id === `feature.${feature}`) ?? null;
}

/** The improvement of an improvement sprite id, or null for any other id. */
export function improvementOf(id: SpriteId): ImprovementId | null {
  return IMPROVEMENT_IDS.find((improvement) => id === `improvement.${improvement}`) ?? null;
}
