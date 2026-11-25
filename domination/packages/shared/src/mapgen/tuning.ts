/**
 * The knobs of the map generator, in one place.
 *
 * These numbers decide what maps LOOK like. They are not rules of the game:
 * the rules about start positions read RULES and MAP_SIZES in data/rules.ts.
 * Changing a number here changes the map every seed produces, but never a
 * game that is already running (a game keeps its map in its save).
 *
 * "Share of the land" always means a fraction of the land tiles, 0.1 = 10%.
 */

import type { Range } from './noise';

/** Every number that shapes the look of the maps and the search for start positions. */
export const MAPGEN = {
  /**
   * How many times generateMap starts over (with the next attempt stream)
   * before it gives up. Fixed by the doc comment of generateMap.
   */
  maxAttempts: 100,
  /**
   * Rule H6 (startNeeds.ts): a start has at least this many coast tiles of
   * the sea inside the land its capital is sure to own. With 1 a quarter of
   * the capitals had a single tile to fish (495 of 1800 on 360 maps); with 3
   * every capital has three or more and the starts are as fair as before.
   *
   * 6 is as far as it can go. Measured with the number set to 1, 2, 3, 4,
   * 5 and 6, on 200 seeds for every map size with 1 to 8 players (4800 maps
   * for each number): a map every time. Up to 3 the first attempt gave it
   * every time; with 4 and 5 no map needed more than two. With 6 the
   * generator has to work for it: a small map for eight players takes 10
   * attempts on average, and of 5000 such maps one took 82 of the 100 it
   * has (maxAttempts above). From 7 on it gives up on many maps (with 7 on
   * 1399 of 4800: on a small map on 26 of 200 for three players, and on
   * every one for eight). generateMap then throws, and "Start game" answers
   * the host "The server had a problem. Please try again." A test holds the
   * 6 and the 7 (mapgenPlacement.test.ts).
   */
  startCoastTiles: 3,

  // --- Land and sea -------------------------------------------------------

  /** Part of the map that is land. Each map picks its own value from this range. */
  landShare: { min: 0.38, max: 0.42 } as Range,
  /**
   * The main continent is made of this many round "lobes", each joined to
   * the one it grew out of. More lobes give a longer, more winding continent.
   */
  mainLobes: { min: 4, max: 6 },
  /** A lobe keeps at least this many tiles of sea between its rim and the map edge, where there is room. */
  lobeEdgeGap: 1.5,
  /** Each lobe's radius is the typical radius times a factor from this range. */
  lobeSizeFactor: { min: 0.8, max: 1.2 } as Range,
  /**
   * How far a new lobe sits from the lobe it grows out of, as a multiple of
   * their average radius. Below 1 they nearly merge; near 1.5 only a neck of
   * land joins them; beyond about 1.8 the sea would come between them.
   */
  lobeSpacing: { min: 1.05, max: 1.45 } as Range,
  /**
   * Half the width of the land bridge that joins a new lobe to the lobe it
   * grew out of, as a multiple of the smaller of the two radii.
   */
  bridgeHalfWidth: 0.6,
  /**
   * Tiles whose centre is at most this far (in tiles) from the middle line
   * of a bridge are always land. It makes the thinnest possible neck one to
   * two tiles wide, which keeps the main continent in one piece.
   */
  spineHalfWidth: 0.8,
  /** Smaller lobes placed away from the main continent: a second landmass or large islands. */
  sideLobes: { min: 1, max: 2 },
  /** Radius of a side lobe, as a multiple of the typical main lobe radius. */
  sideLobeSizeFactor: { min: 0.4, max: 0.6 } as Range,
  /** Little islands in the open sea. */
  islets: { min: 1, max: 3 },
  /** Radius of an islet, in tiles. */
  isletRadius: { min: 1.6, max: 2.6 } as Range,
  /** Side lobes and islets keep this multiple of the two radii between themselves and other lobes. */
  sideLobeGap: 1.2,
  /**
   * Outside its radius the height of a side lobe or islet falls this many
   * times faster than inside, which keeps islands from growing far beyond
   * their planned size (see Lobe.outerSlope in land.ts).
   */
  sideLobeOuterSlope: 3,
  /**
   * Patch sizes (in tiles) of the noise that roughens the coastline, largest
   * first: bays and peninsulas, then inlets, then single-tile ragged edges.
   */
  coastNoiseCells: [7, 3.5, 1.75],
  /**
   * How strongly that noise bends the coast. 0 would give perfect circles;
   * at 1 the lobes would hardly be recognisable.
   */
  coastNoiseWeight: 0.85,
  /**
   * Tiles closer to the map edge than this many steps lose height: the full
   * `edgePenalty` right at the edge, fading out towards the margin. It keeps
   * most land away from the border, so that an open sea surrounds it. The
   * fade is gentle on purpose: a sudden drop would cut the coast in a
   * straight line along the border. (The outer ring itself is always water.)
   */
  edgeMargin: 6,
  edgePenalty: 1,
  /**
   * The margin is not the same all the way round: a smooth noise (patches
   * of `edgeMarginCell` tiles) makes it up to this much wider or narrower
   * (0.6 = from 40% to 160% of `edgeMargin`). Where it is narrow the land
   * may come close to the border, where it is wide the sea cuts in. On a
   * small map, where the land has to use nearly all the room, this is what
   * keeps the continent from looking like a box.
   */
  edgeMarginVariation: 0.6,
  edgeMarginCell: 6,
  /** Islands with fewer tiles than this are removed: single specks look like mistakes. */
  minIslandTiles: 3,
  /** Lakes with at most this many tiles are filled in, for the same reason. */
  maxFilledLakeTiles: 2,

  // --- Ground: desert, plains, grassland ----------------------------------

  /** Patch sizes of the moisture noise that separates grassland (wet) from plains (dry). */
  moistureNoiseCells: [5, 2.5],
  /** Share of the land that is desert. */
  desertShare: { min: 0.08, max: 0.12 } as Range,
  /**
   * The desert lies in a band across the map. This is how far the band may
   * lean away from running straight west-east: 0 = level, 0.5 = it climbs
   * one row for every two columns.
   */
  desertBandTilt: { min: -0.5, max: 0.5 } as Range,
  /** Half the width of the desert band, as a part of the map height. */
  desertBandHalfWidth: 0.1,
  /** Patch size of the noise that makes the band wander, and how far (in half band widths). */
  desertWanderCell: 9,
  desertWanderWeight: 1.2,
  /** Patch size of the noise that frays the band's edges into patches, and how strongly. */
  desertPatchCell: 3,
  desertPatchWeight: 0.9,
  /** Share of the land that is not desert which is grassland; the rest is plains. */
  grasslandShare: { min: 0.5, max: 0.58 } as Range,
  /**
   * Moisture taken off tiles near the desert, by their distance from it
   * (position 1 = next to desert, position 2 = two steps away), so that
   * plains (the drier ground) form a belt between desert and grassland.
   */
  drynessNearDesert: [0, 0.3, 0.15],

  // --- Mountains ----------------------------------------------------------

  /** Share of the land that is mountains. */
  mountainShare: { min: 0.04, max: 0.06 } as Range,
  /** Tiles in one mountain range, before thickening. */
  rangeLength: { min: 4, max: 9 },
  /**
   * Mountains keep this many steps away from water (2 = never on the shore),
   * so a strip of walkable land runs along every coast.
   */
  mountainCoastDistance: 2,
  /** A new range starts at least this many steps from mountains that already exist. */
  rangeSpacing: 3,
  /** Chance per step that the range sidesteps instead of going straight on. */
  rangeWobbleChance: 0.5,
  /** Chance per step that the whole range bends by one direction (60 degrees). */
  rangeBendChance: 0.12,
  /** Chance per step that a tile of the range stays open as a pass. */
  rangePassChance: 0.12,
  /** Chance per step that the range is two tiles thick at that point. */
  rangeThickenChance: 0.3,
  /** How many starting points are tried before the generator settles for fewer mountains. */
  rangeStartTries: 60,

  // --- Hills and forest ---------------------------------------------------

  /** Share of the land that is hills. */
  hillsShare: { min: 0.1, max: 0.13 } as Range,
  /** Patch sizes of the noise that groups hills into clusters. */
  hillsNoiseCells: [4, 2],
  /**
   * Extra hill score near mountains, by distance from the nearest one
   * (position 1 = next to it, position 2 = two steps away): foothills.
   */
  foothillBonus: [0, 0.3, 0.12],
  /** Extra hill score for a pass through a mountain range, so that passes are hills. */
  passBonus: 1,
  /** Share of the land that is forest. */
  forestShare: { min: 0.15, max: 0.19 } as Range,
  /** Patch sizes of the noise that groups forest into woods. */
  forestNoiseCells: [3.5, 1.75],
  /** How much moisture counts for forest, next to the forest noise (0 = not at all). */
  forestMoistureWeight: 0.25,

  // --- Start positions ----------------------------------------------------

  /**
   * A "comfortable" start has at least this many neighbors a land unit can
   * enter (rule H4 demands only 2) ...
   */
  comfortNeighbors: 3,
  /** ... and at least this many walkable tiles among the 19 within two steps. */
  comfortLandNearby: 9,
  /**
   * How the generator trades good land against distance when it places the
   * starts on an uncrowded map. It tries the steps in order. In each step
   * only sites whose score is at least `scorePercent` of the best site's
   * score are used, and the starts must be at least `spacingPercent` of the
   * ideal spacing apart (never less than RULES.minStartDistance).
   * Every `scorePercent` is 70 or more: that is what keeps rule S3.
   */
  fairnessSteps: [
    { scorePercent: 85, spacingPercent: 65 },
    { scorePercent: 78, spacingPercent: 45 },
    { scorePercent: 70, spacingPercent: 0 },
  ],
  /** Rule S3: the lowest start score is at least this many percent of the highest. */
  fairScorePercent: 70,
  /**
   * The starts are picked best site first, after adding a random 0..this to
   * every score, so that equally good sites take turns from map to map.
   */
  scoreJitter: 6,
  /**
   * How many differently jittered orders are tried for each spacing (besides
   * the four sweeps across the map, see tryOrders in starts.ts).
   */
  placementTries: 3,
  /** How many landmasses, largest first, are tried as the one home of all players. */
  homeLandmassTries: 3,
  /**
   * On a crowded map, a landmass smaller than this is used only as a last
   * resort: when the larger ones have no room for everybody even at the
   * smallest distance the rules allow (RULES.minCityDistance). A player
   * alone on a tiny island has nowhere to grow. (All players together on
   * one such landmass is a different matter and is tried like any other.)
   */
  roomyLandmassTiles: 30,
};
