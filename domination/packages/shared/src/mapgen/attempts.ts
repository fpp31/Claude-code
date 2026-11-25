/**
 * The loop around the six steps: build a map, place the starts, give every
 * start a hill if it has none, check the promises; if that fails, try
 * again with fresh random streams.
 *
 * An attempt fails when the land it happened to make has no room for the
 * starts the rules demand. With the map sizes of the game that is very
 * rare, but the promises about start positions must hold for EVERY result,
 * so the generator does not hope for the best: it checks, and starts over.
 */

import { seedRng, shuffle } from '../rng';
import { buildMap } from './buildMap';
import type { MapStreams } from './buildMap';
import type { GeneratedMap } from './generateMap';
import { gridFor } from './grid';
import { raiseStartHills, seaCoast, sitesBySea, startNeedsHold } from './startNeeds';
import { hardRulesHold, standardRulesHold } from './startRules';
import { placeStarts } from './starts';
import { MAPGEN } from './tuning';

/**
 * What the generator needs to know about a map size. Every entry of
 * MAP_SIZES fits. (Tests also pass sizes the game does not offer, to see
 * what happens when the land is too small for the players.)
 */
export interface MapDimensions {
  width: number;
  height: number;
  /** With more players than this the map counts as crowded: rules S1-S3 become aims. */
  recommendedPlayers: number;
}

/**
 * The random streams of one attempt: `streams('')` is the main stream,
 * `streams('moisture')` the one for moisture, and so on. Attempt 1 uses the
 * stream names 'map', 'map:moisture', ...; attempt 2 uses 'map#2',
 * 'map#2:moisture', ...
 */
export function attemptStreams(seed: string, attempt: number): MapStreams {
  const prefix = attempt === 1 ? 'map' : `map#${attempt}`;
  return (part) => seedRng(seed, part === '' ? prefix : `${prefix}:${part}`);
}

/** The shape of placeStarts (starts.ts): the step that chooses the start tiles, or says that there is no room. */
export type StartPlacer = typeof placeStarts;

/**
 * Generates a map of the given size with one start per player: the result
 * of the first attempt that keeps every promise about start positions.
 * Throws if MAPGEN.maxAttempts attempts all fail. The input is not checked
 * here; generateMap does that.
 *
 * @param place  for tests only: stands in for placeStarts, so a test can
 *               hand in starts that break a promise and see that the map
 *               is thrown away. What it hands in goes through the same
 *               lines as the real step's answer: the hill of rule H7 and
 *               every check
 */
export function generateForSize(
  seed: string,
  size: MapDimensions,
  playerCount: number,
  place: StartPlacer = placeStarts,
): GeneratedMap {
  const grid = gridFor(size);
  const crowded = playerCount > size.recommendedPlayers;

  for (let attempt = 1; attempt <= MAPGEN.maxAttempts; attempt++) {
    const streams = attemptStreams(seed, attempt);
    const map = buildMap(grid, streams);
    const startRng = streams('starts');
    // Rule H6 is kept by choosing the sites: only tiles with the sea in reach are offered.
    const starts = place(grid, map, playerCount, crowded, startRng, sitesBySea(grid, seaCoast(grid, map)));
    if (starts === null) continue;
    // placeStarts is built to keep the rules; they are checked all the same
    // (see startRules.ts and startNeeds.ts), and a map that fails is thrown away.
    if (starts.length !== playerCount || !hardRulesHold(grid, map, starts)) continue; // H1 to H5
    // Rule H7: a hill for every start that has no tile for a Mine it can
    // walk to. It comes before the last two checks, because a hill changes
    // a start's score: S3 is checked on the map WITH its new hills.
    // (-1 means that a start has no tile that could carry a hill. A start
    // that keeps H1 to H5 always has one, a neighbour it can walk to, so
    // this is a second lock and no test can tell it from the first.)
    if (raiseStartHills(grid, map, starts) === -1) continue;
    if (!startNeedsHold(grid, map, starts)) continue; // H6, H7
    if (!crowded && !standardRulesHold(grid, map, starts)) continue; // S1 to S3
    // Shuffled, so that seat 1 does not always get the site that was picked first.
    return { map, starts: shuffle(startRng, starts) };
  }
  throw new Error(
    `generateMap: no valid start positions after ${MAPGEN.maxAttempts} attempts ` +
      `(seed '${seed}', ${size.width} x ${size.height} tiles, ${playerCount} ${playerCount === 1 ? 'player' : 'players'}). ` +
      'With the numbers the game came with, this is a bug in the map generator. ' +
      'If a number in mapgen/tuning.ts was changed (startCoastTiles, for example), ' +
      'that number asks for more than a map of this size can give that many players.',
  );
}
