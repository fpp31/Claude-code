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
 * numbers can be tuned, with one limit that two table tests hold: a mined
 * hill must give more food + production than every unimproved tile AND than
 * every farmed tile. Citizens take the tiles with the highest sum first and
 * a mine gives no food, so it loses every tie. At +1 production (level with
 * open grassland and plains) a mine was the last tile a city took and stood
 * unused for a whole game. At +2 (level with a farmed grassland or plains
 * tile) every farm after the first pushed the mine one citizen back, and a
 * mine that was worked fell out of use while the Worker went on farming.
 * At +3 a mined hill is the tile with the most to give and is taken first.
 * It still needs the food of a farm on grassland (the one tile that feeds
 * more than the citizen who works it): a city without one cannot spare a
 * citizen for a tile without food for as long as it can still grow.
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
   * tile more food."). Plain words, no digits, at most 42 characters (the
   * limit of a unit's description, data/units.ts), ending with a full stop.
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
    yields: { food: 0, production: 3 }, turns: 5,
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
