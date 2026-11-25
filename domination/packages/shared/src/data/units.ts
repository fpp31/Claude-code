/**
 * Unit type table. Four land units and, since round 3, two boats (the
 * Fishing Boat and the Scout Boat); no combat yet.
 * Phase 2 adds columns (strength, range...) and rows here.
 *
 * Never remove or rename an id that saved games may contain without writing
 * a save migration (see data/rules.ts).
 */

import type { ImprovementId } from './improvements';
import type { UnitDomain } from './terrain';

export type UnitTypeId = 'warrior' | 'scout' | 'settler' | 'worker' | 'fishingBoat' | 'scoutBoat';

/** Stacking rule: a tile holds at most one military unit and one civilian unit. */
export type UnitClass = 'military' | 'civilian';

export interface UnitDef {
  /** Name shown to players. */
  name: string;
  /**
   * One short line for players: what the unit is for. Shown in the unit
   * panel, in the city's list of things to build and in the tile information
   * about another player's unit. Plain words; no digits (the numbers are in
   * the other columns and would go stale here); ending with a full stop; at
   * most 42 characters.
   *
   * The 42 are the limit a table test holds, and a rule of thumb:
   * characters are not pixels. Under an add button of the city panel a
   * description has 258 pixels where the browser shows a scroll bar.
   * Today's four take 162 to 241 of them and stand on ONE line each, the
   * longest with 16 pixels to spare. A sentence of 42 characters with wider
   * letters can need more than the 258 (273 were measured for one), and so
   * can any sentence in a wider font than the one this was measured with.
   * Such a line wraps onto a second one, which the page allows; it is never
   * cut. The end-to-end test looks at these lines themselves (step 33), so
   * a new description that takes two lines there is reported.
   */
  description: string;
  unitClass: UnitClass;
  /**
   * Where the unit moves: a land unit on land tiles only, a sea unit (a
   * boat) on water tiles only (coast and ocean). It decides which column of
   * the terrain table the unit pays (tileMoveCost), and where a city puts
   * the finished unit (findSpawnTile). No unit ever changes its domain.
   */
  domain: UnitDomain;
  /** Movement points at the start of every turn. */
  moves: number;
  /** Sight radius in tiles (plain distance, nothing blocks sight in phase 1). Must be at least 1. */
  sight: number;
  /** Production a city must store to complete this unit. */
  cost: number;
  /** Population removed from the city when the unit is completed (the city must keep at least 1). */
  populationCost: number;
  /** Can this unit found a city (and be consumed doing so)? */
  canFoundCity: boolean;
  /**
   * The tile improvements (data/improvements.ts) this unit can build on the
   * tile it stands on, in IMPROVEMENT_IDS order; empty for a unit that
   * builds none. A unit with at least one can have a job (Unit.job in
   * types.ts), and its panel shows one button per entry. Every entry must
   * fit some tile the unit's domain can enter (a table test holds that).
   */
  improvements: readonly ImprovementId[];
}

/** Can a unit of this type build tile improvements at all? */
export function unitCanImprove(type: UnitTypeId): boolean {
  return UNITS[type].improvements.length > 0;
}

/**
 * The unit type that builds this improvement: the first in UNIT_TYPE_IDS
 * order whose list holds it. Every improvement has exactly one today (a
 * table test). The page names it: "A Fishing Boat can build a Fishing Net
 * here".
 *
 * Throws for an improvement no unit type builds: that is a hole in the
 * table, which the table test finds first.
 */
export function improvementBuilder(improvement: ImprovementId): UnitTypeId {
  const builder = UNIT_TYPE_IDS.find((type) => UNITS[type].improvements.includes(improvement));
  if (builder === undefined) throw new Error(`No unit type builds the improvement '${improvement}'.`);
  return builder;
}

/**
 * All unit type ids, in the order a city's build menu lists them. Land
 * first, the boats last: the four older buttons stay where they were.
 */
export const UNIT_TYPE_IDS: readonly UnitTypeId[] = ['warrior', 'scout', 'settler', 'worker', 'fishingBoat', 'scoutBoat'];

export const UNITS: Record<UnitTypeId, UnitDef> = {
  warrior: {
    name: 'Warrior', description: 'A soldier who guards and blocks the way.',
    unitClass: 'military', domain: 'land', moves: 2, sight: 2, cost: 18, populationCost: 0, canFoundCity: false, improvements: [],
  },
  scout: {
    name: 'Scout', description: 'A fast explorer who sees far.',
    unitClass: 'military', domain: 'land', moves: 3, sight: 3, cost: 12, populationCost: 0, canFoundCity: false, improvements: [],
  },
  settler: {
    name: 'Settler', description: 'Founds a new city. Takes one citizen.',
    unitClass: 'civilian', domain: 'land', moves: 2, sight: 3, cost: 30, populationCost: 1, canFoundCity: true, improvements: [],
  },
  worker: {
    name: 'Worker', description: 'Builds farms and mines inside the borders.',
    unitClass: 'civilian', domain: 'land', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false, improvements: ['farm', 'mine'],
  },
  fishingBoat: {
    name: 'Fishing Boat', description: 'Builds fishing nets inside the borders.',
    unitClass: 'civilian', domain: 'sea', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false, improvements: ['fishingNet'],
  },
  scoutBoat: {
    name: 'Scout Boat', description: 'A fast boat that explores the sea.',
    unitClass: 'military', domain: 'sea', moves: 4, sight: 4, cost: 24, populationCost: 0, canFoundCity: false, improvements: [],
  },
};
