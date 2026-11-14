/**
 * Unit type table. Phase 1 has three land units and no combat.
 * Phase 2 adds columns (strength, range...) and rows here.
 */

export type UnitTypeId = 'warrior' | 'scout' | 'settler';

/** Stacking rule: a tile holds at most one military unit and one civilian unit. */
export type UnitClass = 'military' | 'civilian';

export interface UnitDef {
  /** Name shown to players. */
  name: string;
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
}

/** All unit type ids, in the order they are listed in a city's build menu. */
export const UNIT_TYPE_IDS: readonly UnitTypeId[] = ['warrior', 'scout', 'settler'];

export const UNITS: Record<UnitTypeId, UnitDef> = {
  warrior: { name: 'Warrior', unitClass: 'military', moves: 2, sight: 2, cost: 18, populationCost: 0, canFoundCity: false },
  scout:   { name: 'Scout',   unitClass: 'military', moves: 3, sight: 3, cost: 12, populationCost: 0, canFoundCity: false },
  settler: { name: 'Settler', unitClass: 'civilian', moves: 2, sight: 3, cost: 30, populationCost: 1, canFoundCity: true },
};
