/**
 * Terrain and feature tables. Every rule about what a tile costs to enter and
 * what it yields reads these tables through the helper functions at the bottom
 * of this file, so the group can tune the game by editing numbers here.
 *
 * A tile has a ground TERRAIN (ocean, coast, grassland, plains, desert) and at
 * most one FEATURE standing on it (forest, hills, mountains). This matches the
 * art: continuous ground with raised objects drawn on top.
 *
 * Phase 1 rule: when a tile has a feature, the feature's numbers REPLACE the
 * ground's numbers (they are not added). A forest behaves the same on
 * grassland and on plains.
 *
 * An IMPROVEMENT (a farm, a mine, a fishing net: data/improvements.ts) is
 * the one thing whose numbers are added instead of replacing.
 *
 * Since round 3 a unit moves on land or on the sea (its DOMAIN), and the
 * terrain table has one movement cost for each. Features stand on land
 * only, so a feature's cost is a land unit's cost.
 */

import { IMPROVEMENTS } from './improvements';
import type { ImprovementId } from './improvements';

/** What a worked tile gives a city each turn. Later phases add more keys (gold, science...). */
export interface Yields {
  food: number;
  production: number;
}

/**
 * Where a unit moves: on land or on the sea. Every unit type has one
 * (UNITS[type].domain) and never changes it. The terrain table has one
 * movement cost per domain.
 */
export type UnitDomain = 'land' | 'sea';

/** Both domains, in a fixed order. */
export const UNIT_DOMAINS: readonly UnitDomain[] = ['land', 'sea'];

export type TerrainId = 'ocean' | 'coast' | 'grassland' | 'plains' | 'desert';
export type FeatureId = 'forest' | 'hills' | 'mountains';

export interface TerrainDef {
  /** Name shown to players. */
  name: string;
  /** Water tiles are entered by sea units only, land tiles by land units only. */
  water: boolean;
  /**
   * Movement points a unit of each domain needs to enter the tile; null =
   * units of that domain cannot enter. A feature on the tile replaces the
   * LAND cost (FeatureDef.moveCost); no feature stands on water.
   */
  moveCost: Record<UnitDomain, number | null>;
  yields: Yields;
  /** May a city be founded on this ground (when no feature says otherwise)? */
  canFoundCity: boolean;
}

export interface FeatureDef {
  /** Name shown to players. */
  name: string;
  /**
   * Movement points a LAND unit needs to enter the tile; null = land units
   * cannot enter. For LAND units it replaces the ground's cost. A sea unit
   * never meets it: no feature stands on water (`allowedOn`, and a table
   * test), and land lets no sea unit in whatever stands on it.
   */
  moveCost: number | null;
  /** Replaces the ground's yields. */
  yields: Yields;
  /** Can a citizen work this tile? */
  workable: boolean;
  /** May a city be founded on a tile with this feature? */
  canFoundCity: boolean;
  /** Grounds the map generator may place this feature on. */
  allowedOn: readonly TerrainId[];
}

/** All terrain ids, in a fixed order (useful for loops, tests and sprite lists). */
export const TERRAIN_IDS: readonly TerrainId[] = ['ocean', 'coast', 'grassland', 'plains', 'desert'];

/** All feature ids, in a fixed order. */
export const FEATURE_IDS: readonly FeatureId[] = ['forest', 'hills', 'mountains'];

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  ocean:     { name: 'Ocean',     water: true,  moveCost: { land: null, sea: 1 }, yields: { food: 1, production: 0 }, canFoundCity: false },
  coast:     { name: 'Coast',     water: true,  moveCost: { land: null, sea: 1 }, yields: { food: 2, production: 0 }, canFoundCity: false },
  grassland: { name: 'Grassland', water: false, moveCost: { land: 1, sea: null }, yields: { food: 2, production: 1 }, canFoundCity: true },
  plains:    { name: 'Plains',    water: false, moveCost: { land: 1, sea: null }, yields: { food: 1, production: 2 }, canFoundCity: true },
  desert:    { name: 'Desert',    water: false, moveCost: { land: 1, sea: null }, yields: { food: 0, production: 1 }, canFoundCity: true },
};

export const FEATURES: Record<FeatureId, FeatureDef> = {
  forest: {
    name: 'Forest', moveCost: 2, yields: { food: 1, production: 1 },
    workable: true, canFoundCity: false, allowedOn: ['grassland', 'plains'],
  },
  hills: {
    name: 'Hills', moveCost: 2, yields: { food: 0, production: 2 },
    workable: true, canFoundCity: true, allowedOn: ['grassland', 'plains', 'desert'],
  },
  mountains: {
    name: 'Mountains', moveCost: null, yields: { food: 0, production: 0 },
    workable: false, canFoundCity: false, allowedOn: ['grassland', 'plains', 'desert'],
  },
};

/**
 * The part of a tile these helpers need. Both the real `Tile` (game state) and
 * a `TileView` (what one player sees) fit, so server and client share the code.
 */
export interface Ground {
  terrain: TerrainId;
  feature: FeatureId | null;
  /**
   * What has been built on the tile. A `Tile` and a `TileView` always carry
   * it. A caller that only knows the land (the map generator, the movement
   * Board, a table test) leaves it out, and that means "nothing built".
   * Only tileYields looks at it.
   */
  improvement?: ImprovementId | null;
}

/** True for ocean and coast. */
export function tileIsWater(ground: Ground): boolean {
  return TERRAIN[ground.terrain].water;
}

/**
 * Movement points a unit of this domain needs to enter the tile, or null if
 * it cannot enter at all (a land unit: water, mountains; a sea unit: land).
 * For a land unit a feature's cost replaces the ground's.
 */
export function tileMoveCost(ground: Ground, domain: UnitDomain): number | null {
  if (domain === 'land' && ground.feature !== null) return FEATURES[ground.feature].moveCost;
  return TERRAIN[ground.terrain].moveCost[domain];
}

/**
 * What a citizen working this tile produces (before any city-centre
 * minimum): the feature's yields if the tile has a feature, otherwise the
 * ground's, PLUS the yields of the tile's improvement, if it has one.
 * Hands out a fresh object.
 */
export function tileYields(ground: Ground): Yields {
  const source = ground.feature !== null ? FEATURES[ground.feature].yields : TERRAIN[ground.terrain].yields;
  const built = ground.improvement ?? null;
  const bonus = built === null ? null : IMPROVEMENTS[built].yields;
  return {
    food: source.food + (bonus === null ? 0 : bonus.food),
    production: source.production + (bonus === null ? 0 : bonus.production),
  };
}

/** Can a citizen work this tile? (Everything except mountains in phase 1; water is workable.) */
export function tileIsWorkable(ground: Ground): boolean {
  return ground.feature === null ? true : FEATURES[ground.feature].workable;
}

/** Does the ground itself allow a city here? (Ownership and distance rules are checked elsewhere.) */
export function tileAllowsCity(ground: Ground): boolean {
  if (ground.feature !== null) return FEATURES[ground.feature].canFoundCity;
  return TERRAIN[ground.terrain].canFoundCity;
}
