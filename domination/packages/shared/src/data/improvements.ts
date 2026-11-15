/**
 * Tile improvements: what a Worker can build on a tile. One table; tune the
 * numbers here.
 *
 * A tile carries at most one improvement. Its yields are ADDED to whatever
 * the tile yields (unlike a feature, whose numbers replace the ground's):
 * see tileYields in terrain.ts. Building one takes a unit that can improve
 * (UNITS[type].canImprove) several turns on the tile: see rules/improvements.ts.
 *
 * Whether a citizen works an improved tile is decided by cityEconomy
 * (rules/city.ts), which never lets a city stop growing over one. So these
 * numbers can be tuned freely.
 *
 * Never remove or rename an id that saved games may contain without writing
 * a save migration (see data/rules.ts).
 */

import type { FeatureId, Ground, TerrainId, Yields } from './terrain';

export type ImprovementId = 'farm' | 'mine';

export interface ImprovementDef {
  /** Name shown to players. */
  name: string;
  /**
   * One short line for players: what it is. Shown in the tile information,
   * after the name and what it adds ("Farm (+1 food). Fields that give the
   * tile more food."). Plain words, no digits, at most 45 characters,
   * ending with a full stop.
   */
  description: string;
  /**
   * Where it can be built, in words that complete "A <name> needs ...":
   * shown next to a greyed-out button. Must say the same as `terrains` and
   * `features` below.
   */
  needs: string;
  /** Grounds it may stand on. */
  terrains: readonly TerrainId[];
  /** What must stand on the ground: a feature, or null for "nothing" (open ground). */
  features: readonly (FeatureId | null)[];
  /** Added to the tile's yields. */
  yields: Yields;
  /** Turn resolutions a unit must spend on the tile to build it. At least 1. */
  turns: number;
}

/** All improvement ids, in the order the unit panel lists them. */
export const IMPROVEMENT_IDS: readonly ImprovementId[] = ['farm', 'mine'];

export const IMPROVEMENTS: Record<ImprovementId, ImprovementDef> = {
  farm: {
    name: 'Farm', description: 'Fields that give the tile more food.',
    needs: 'open grassland, plains or desert',
    terrains: ['grassland', 'plains', 'desert'], features: [null],
    yields: { food: 1, production: 0 }, turns: 4,
  },
  mine: {
    name: 'Mine', description: 'A pit in the hills for more production.',
    needs: 'hills',
    terrains: ['grassland', 'plains', 'desert'], features: ['hills'],
    yields: { food: 0, production: 1 }, turns: 5,
  },
};

/**
 * Can this improvement stand on this kind of tile? True if the ground is one
 * of its `terrains` and what stands on it (a feature, or nothing) is one of
 * its `features`. It looks at the land only: who owns the tile, whether a
 * city stands there and what is built there already are judged by
 * improvementSiteError (rules/improvements.ts).
 */
export function improvementFits(improvement: ImprovementId, ground: Ground): boolean {
  const def = IMPROVEMENTS[improvement];
  return def.terrains.includes(ground.terrain) && def.features.includes(ground.feature);
}
