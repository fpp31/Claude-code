/**
 * Unit type table. Three land units in phase 1, a fourth (the Worker)
 * since round 2; no combat yet.
 * Phase 2 adds columns (strength, range...) and rows here.
 */

export type UnitTypeId = 'warrior' | 'scout' | 'settler' | 'worker';

/** Stacking rule: a tile holds at most one military unit and one civilian unit. */
export type UnitClass = 'military' | 'civilian';

export interface UnitDef {
  /** Name shown to players. */
  name: string;
  /**
   * One short line for players: what the unit is for. Shown in the unit
   * panel, in the city's list of things to build and in the tile information
   * about another player's unit. Plain words; no digits (the numbers are in
   * the other columns and would go stale here); at most 45 characters, so
   * that it is ONE line in a panel; ending with a full stop.
   */
  description: string;
  unitClass: UnitClass;
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
   * Can this unit build tile improvements (data/improvements.ts) on the tile
   * it stands on? Such a unit can have a job; see Unit.job in types.ts.
   */
  canImprove: boolean;
}

/** All unit type ids, in the order they are listed in a city's build menu. */
export const UNIT_TYPE_IDS: readonly UnitTypeId[] = ['warrior', 'scout', 'settler', 'worker'];

export const UNITS: Record<UnitTypeId, UnitDef> = {
  warrior: {
    name: 'Warrior', description: 'A foot soldier who guards and blocks the way.',
    unitClass: 'military', moves: 2, sight: 2, cost: 18, populationCost: 0, canFoundCity: false, canImprove: false,
  },
  scout: {
    name: 'Scout', description: 'A fast explorer who sees far.',
    unitClass: 'military', moves: 3, sight: 3, cost: 12, populationCost: 0, canFoundCity: false, canImprove: false,
  },
  settler: {
    name: 'Settler', description: 'Founds a new city. Takes one citizen.',
    unitClass: 'civilian', moves: 2, sight: 3, cost: 30, populationCost: 1, canFoundCity: true, canImprove: false,
  },
  worker: {
    name: 'Worker', description: 'Builds farms and mines inside the borders.',
    unitClass: 'civilian', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false, canImprove: true,
  },
};
