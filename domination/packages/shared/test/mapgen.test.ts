import { describe, it } from 'vitest';

/**
 * Tests WP1 must write for generateMap (packages/shared/src/mapgen/).
 * Each `it.todo` is a promise made in the doc comment of generateMap;
 * replace it with a real test. Run them over many seeds (for example 50)
 * and all three map sizes, for 1 to RULES.maxSeats players.
 *
 * (The rule "only Math functions that give the same result everywhere" is
 * checked for the whole shared package by purity.test.ts.)
 */
describe('generateMap (WP1)', () => {
  it.todo('returns a deep-equal result for the same seed, size and player count');
  it.todo('returns different maps for different seeds');
  it.todo('has width * height tiles of the requested size, all with cityId null');
  it.todo('makes every tile on the map edge water');
  it.todo('marks water next to land as coast and all other water as ocean');
  it.todo('only places features on grounds listed in FEATURES[feature].allowedOn');
  it.todo('has a sensible share of land (roughly 35-45%) and contains every terrain and feature kind on medium and large maps');
  // Hard rules H1-H5: every map size, 1 to RULES.maxSeats players.
  it.todo('H1: returns exactly playerCount distinct start tiles, for 1 to RULES.maxSeats players, on every map size');
  it.todo('H2: puts every start on a legal, enterable city site (tileAllowsCity, tileMoveCost not null)');
  it.todo('H3: keeps any two starts at least RULES.minCityDistance apart, even with 8 players on the small map');
  it.todo('H4: gives every start at least 2 neighbors that land units can enter');
  it.todo('H5: gives every start at least RULES.minStartLandmass walkable tiles (flood fill over tileMoveCost)');

  // Standard rules S1-S3: only for playerCount <= MAP_SIZES[size].recommendedPlayers.
  it.todo('S1: keeps starts at least RULES.minStartDistance apart when the map is not crowded');
  it.todo('S2: puts all starts on one landmass (walkable from one to another) when the map is not crowded');
  it.todo('S3: fairness when the map is not crowded: the lowest start score (food + production of workable tiles within 2) is at least 70% of the highest');

  it.todo('never throws for valid input, even 8 players on the small map');
  it.todo('throws a clear error for invalid input (unknown size, 0 players, too many players, empty seed)');
});
