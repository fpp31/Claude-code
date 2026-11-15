/**
 * Improvement rules: where a unit may build what, and what its owner is told
 * about it.
 */

import type { RuleErrorCode } from '../actions';
import { IMPROVEMENTS, IMPROVEMENT_IDS, improvementFits } from '../data/improvements';
import type { ImprovementId } from '../data/improvements';
import type { Ground } from '../data/terrain';
import { UNITS } from '../data/units';
import type { GameState, PlayerId, TileIndex, Unit, UnitJob } from '../types';
import type { JobOption, PlayerView, UnitJobView } from '../viewTypes';
import { tileOwner } from './stateQueries';

/** The facts about a tile that decide whether a player may have an improvement built on it. */
export interface ImprovementSite {
  /** The tile's ground and what is built on it (a Tile and a TileView both fit). */
  ground: Ground;
  /** Is the tile that player's own land? */
  own: boolean;
  /** Does a city stand on the tile? */
  city: boolean;
}

/** The site as the truth has it, for the engine. */
export function siteOfTile(state: GameState, owner: PlayerId, tile: TileIndex): ImprovementSite {
  const truth = state.map.tiles[tile];
  return {
    ground: { terrain: truth.terrain, feature: truth.feature, improvement: truth.improvement },
    own: tileOwner(state, tile) === owner,
    city: Object.values(state.cities).some((city) => city.tile === tile),
  };
}

/**
 * The same facts as the viewer knows them, for the client's tile
 * information: `own` is `tileView.owner === view.you`, `city` is "the view
 * has a city on this tile". For a tile of the viewer's OWN land (the only
 * tiles the client asks about) every one of them is the truth: a player
 * always has their own land in sight. null for a tile the viewer has never
 * seen or that is not on the map.
 */
export function siteInView(view: PlayerView, tile: TileIndex): ImprovementSite | null {
  if (!Number.isInteger(tile) || tile < 0 || tile >= view.tiles.length) return null;
  const seen = view.tiles[tile];
  if (seen === null || seen === undefined) return null;
  return {
    ground: { terrain: seen.terrain, feature: seen.feature, improvement: seen.improvement },
    own: seen.owner === view.you,
    city: view.cities.some((city) => city.tile === tile),
  };
}

/**
 * May this improvement be built on this site? Returns null if yes,
 * otherwise the first reason in this order (null site: 'notYourLand'):
 *  1. 'notYourLand'         the tile is not the player's own land: nobody's,
 *                           or another player's;
 *  2. 'cityOnTile'          a city stands on the tile;
 *  3. 'badImprovementTile'  improvementFits(improvement, ground) is false;
 *  4. 'alreadyImproved'     the tile already carries this improvement.
 * (A tile that carries ANOTHER improvement and still fits this one passes:
 * the new one replaces the old one when it is finished. Today no tile fits two.)
 *
 * It is about the tile only. ONE implementation for four users, so they can
 * never disagree: the startJob action, resolveTurn (runJobs judges the site
 * again before every turn of work), the view (OwnUnitDetail.jobOptions) and
 * the client's tile information ("A Farm can be built here").
 *
 * Fog note: the server shows the answer to a player only for the tile one
 * of that player's own units stands on. A unit always sees its own tile
 * (every unit has sight >= 1; a table test guards it), so the owner, the
 * city, the ground and the improvement of that tile are all in the player's
 * view already. The client asks only about its own land, from its own view.
 */
export function improvementSiteError(site: ImprovementSite | null, improvement: ImprovementId): RuleErrorCode | null {
  if (site === null || !site.own) return 'notYourLand';
  if (site.city) return 'cityOnTile';
  if (!improvementFits(improvement, site.ground)) return 'badImprovementTile';
  if ((site.ground.improvement ?? null) === improvement) return 'alreadyImproved';
  return null;
}

/**
 * May this unit start building this improvement where it stands, right now?
 * Returns null if yes, otherwise the first reason in this order:
 *  1. 'cannotImprove'  UNITS[unit.type].canImprove is false, or `improvement`
 *                      is not a key of IMPROVEMENTS (a real key: 'constructor'
 *                      and the like are not improvements);
 *  2. 'unitBusy'       the unit has a job;
 *  3. improvementSiteError(siteOfTile(state, unit.owner, unit.tile), improvement).
 * The unit's moves left are NOT looked at: work may begin in the turn the
 * unit arrives.
 *
 * Like foundCityError it is about the unit and its tile only; whether the
 * player may give any order at this moment (wrong turn, turn ended) is a
 * separate question, answered by applyAction.
 *
 * @param improvement  as it came in the action: any string
 */
export function startJobError(state: GameState, unit: Unit, improvement: string): RuleErrorCode | null {
  if (!UNITS[unit.type].canImprove || !isImprovementId(improvement)) return 'cannotImprove';
  if (unit.job !== null) return 'unitBusy';
  return improvementSiteError(siteOfTile(state, unit.owner, unit.tile), improvement);
}

/** True for a real key of the IMPROVEMENTS table ('constructor' and the like are inherited by every object and are not improvements). */
function isImprovementId(improvement: string): improvement is ImprovementId {
  return Object.hasOwn(IMPROVEMENTS, improvement);
}

/**
 * The jobs a unit could do, for the view: one entry per improvement in
 * IMPROVEMENT_IDS order, with the turns it takes (IMPROVEMENTS[id].turns)
 * and startJobError for it. Empty for a unit whose type cannot improve.
 */
export function jobOptions(state: GameState, unit: Unit): JobOption[] {
  if (!UNITS[unit.type].canImprove) return [];
  return IMPROVEMENT_IDS.map((improvement): JobOption => ({
    improvement,
    turns: IMPROVEMENTS[improvement].turns,
    error: startJobError(state, unit, improvement),
  }));
}

/**
 * A job as its owner sees it: turnsTotal = IMPROVEMENTS[improvement].turns,
 * turnsLeft = max(1, turnsTotal - turnsWorked). Never less than 1: a job
 * that is all but done still only ends when a turn resolves.
 */
export function jobView(job: UnitJob): UnitJobView {
  const turnsTotal = IMPROVEMENTS[job.improvement].turns;
  return {
    improvement: job.improvement,
    turnsWorked: job.turnsWorked,
    turnsTotal,
    turnsLeft: Math.max(1, turnsTotal - job.turnsWorked),
  };
}
