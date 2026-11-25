/**
 * What the player may read about one tile: the words of the hover box, of
 * the tile card and of the unit panel's "Tile:" line. ONE function makes
 * them all, from the player's own view and the shared tables, so the three
 * places can never disagree and none of them can show anything the server
 * has not sent to this player.
 *
 * A few things are worked out here rather than sent: yields, the cost to
 * enter, and what could be built. Each goes through a SHARED function
 * (tileYields, tileMoveCost, tileIsWorkable, cityCenterYields,
 * improvementSiteError with siteInView) on facts of the view, so the client
 * and the server cannot drift apart. See the header of viewTypes.ts.
 */

import {
  CITY_FOCUS,
  CIVS,
  FEATURES,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  TERRAIN,
  UNITS,
  cityCenterYields,
  improvementBuilder,
  improvementSiteError,
  siteInView,
  tileIsWorkable,
  tileMoveCost,
  tileYields,
} from '@domination/shared';
import type {
  CivId,
  ImprovementId,
  OwnCityDetail,
  PlayerId,
  PlayerView,
  TileIndex,
  TileView,
  UnitView,
  Yields,
} from '@domination/shared';
import { cityNotGrowing } from './selectors';

/** How well the viewer knows a tile: never seen; seen before but out of sight now; in sight now. */
export type TileKnowledge = 'unexplored' | 'remembered' | 'visible';

/**
 * What a line is about. Also the end of the line's test id
 * (`tile-card-line-yields`, `hover-box-line-unit`) and its CSS class.
 * Lines always come in the order the kinds are listed here.
 *
 * The words about citizens (round 3): citizens GATHER a tile's yields;
 * units work and build. No line about citizens says "work": under a Worker
 * that was building a farm, round 2's "No citizen works ..." read as a
 * contradiction. The kind keeps its old name, `worked`, which no player
 * reads (it is in test ids and in the view's `worked` list).
 */
export type TileInfoLineKind =
  | 'remembered'   // "Out of sight: shown as you last saw it. Units are not shown."
  | 'city'         // the city standing on the tile
  | 'building'     // what the viewer's own city there builds ("Building: Warrior, 4 turns" / "Builds nothing")
  | 'focus'        // the viewer's own city there is set to Build ("Set to Build first: not growing"); no line on Grow
  | 'unit'         // one unit on the tile (a tile holds at most two)
  | 'improvement'  // the farm, mine or fishing net on the tile
  | 'yields'       // what the tile gives a city
  | 'worked'       // own land only: whether a citizen gathers the tile's yields
  | 'canBuild'     // own land only: an improvement that could be built here, and by which unit (one line each)
  | 'movement'     // what it costs to enter, and for whom (land units, boats)
  | 'owner';       // whose land it is

/** One line of a tile's description: a finished sentence, what it is about, and whose colours go in front of it. */
export interface TileInfoLine {
  kind: TileInfoLineKind;
  /** The finished sentence, as plain text. Never empty, never with a line break. */
  text: string;
  /**
   * The civilization whose colours are drawn as a small square in front of
   * the line: the owner of the city, of the unit or of the land. Null for
   * lines that are about nobody.
   */
  civ: CivId | null;
}

/** Everything the hover box and the tile card print about one tile: a heading and its lines. Plain data, made by describeTile. */
export interface TileInfo {
  tile: TileIndex;
  knowledge: TileKnowledge;
  /** "Forest on Grassland", "Coast", or "Unexplored". */
  title: string;
  /** Top to bottom. Empty for an unexplored tile. */
  lines: TileInfoLine[];
}

/**
 * Describes a tile as the viewer knows it. The exact rules are A-D1 to A-D12
 * of the round 2 spec, with the changes of round 3 (who gathers the yields,
 * which unit could build what, whom the cost to enter is about, and the one
 * line about an own city that is set to Build), and the tests in
 * test/shellTileInfo.test.ts. Pure; never throws, also not for a tile
 * number that is off the map ("Unexplored").
 */
export function describeTile(view: PlayerView, tile: TileIndex): TileInfo {
  return readTile(view, tile).info;
}

/**
 * The unit panel's line about the tile a unit stands on:
 * "Tile: Hills on Plains. Yields 0 food, 2 production." or, with something
 * built there, "Tile: Grassland, Farm. Yields 3 food, 1 production." (for a
 * boat: "Tile: Coast, Fishing Net. Yields 4 food, 0 production."). It is
 * the title, the improvement's name and the yields line of
 * describeTile(view, unit.tile), so the panel and the boxes use the same words.
 * (For a unit in a city the yields line is the centre's: "Tile: Grassland.
 * City centre: 2 food, 1 production.")
 */
export function unitTileText(view: PlayerView, unit: UnitView): string {
  const { info, seen } = readTile(view, unit.tile);
  const built = seen === null || seen.improvement === null ? '' : `, ${IMPROVEMENTS[seen.improvement].name}`;
  const yields = info.lines.find((line) => line.kind === 'yields');
  return yields === undefined ? `Tile: ${info.title}${built}.` : `Tile: ${info.title}${built}. ${yields.text}.`;
}

/**
 * What an improvement adds, read from the table: "+1 food", "+3 production",
 * "+2 food" (the net), and for a row that adds both "+1 food, +3
 * production". Used by the tile's improvement line and by the unit panel's
 * job buttons (ui/texts.ts).
 */
export function improvementBonusText(improvement: ImprovementId): string {
  const added = IMPROVEMENTS[improvement].yields;
  const parts: string[] = [];
  if (added.food !== 0) parts.push(`${withSign(added.food)} food`);
  if (added.production !== 0) parts.push(`${withSign(added.production)} production`);
  // No row of the table adds nothing; if one ever does, the brackets still hold words.
  return parts.length === 0 ? 'adds nothing' : parts.join(', ');
}

/** A description together with the tile it was made from (null: never seen, or not a tile of the map). */
interface TileReading {
  info: TileInfo;
  seen: TileView | null;
}

/** The work behind describeTile; unitTileText also wants the tile itself, for the improvement's name. */
function readTile(view: PlayerView, tile: TileIndex): TileReading {
  // A-D1. Never seen, or not a tile of this map at all: one answer, whatever
  // else the view may hold for that number.
  const onMap = Number.isInteger(tile) && tile >= 0 && tile < view.tiles.length;
  const seen = onMap ? (view.tiles[tile] ?? null) : null;
  if (seen === null) return { info: { tile, knowledge: 'unexplored', title: 'Unexplored', lines: [] }, seen: null };

  const lines: TileInfoLine[] = [];
  const add = (kind: TileInfoLineKind, text: string, civ: CivId | null = null): void => {
    // Names come cleaned from the server; this keeps the promise "never a
    // line break" even for a name that did not.
    lines.push({ kind, text: text.replace(/\s*[\r\n]+\s*/g, ' '), civ });
  };

  // A-D3. A tile out of sight says so before anything else.
  if (!seen.visible) add('remembered', 'Out of sight: shown as you last saw it. Units are not shown.');

  // A-D4, A-D4b. The city, and what the viewer's own city builds.
  const city = view.cities.find((candidate) => candidate.tile === tile) ?? null;
  if (city !== null) {
    const owner = playerWords(view, city.owner);
    const whose = city.owner === view.you ? 'your city' : `a city of ${owner.name}`;
    add('city', `${city.name}, population ${city.population}: ${whose}`, owner.civ);
    if (city.own !== null) add('building', buildingText(city.own));
    // A-D4c (round 3). The viewer's own city, set to Build: the one word
    // about that choice outside the city's open panel, so that a city left
    // on Build by mistake can be found by resting the mouse on it. It is
    // made from city.own, which is null for every other player's city:
    // nobody else can ever be shown it. A city on Grow has no such line, so
    // the box of a city nobody touched stays as it was.
    if (city.own !== null && city.own.focus === 'build') {
      const name = CITY_FOCUS.build.name;
      add('focus', cityNotGrowing(city.own) ? `Set to ${name}: not growing` : `Set to ${name}`);
    }
  }

  // A-D5. Units, only on a tile in sight: soldier before civilian, then by id.
  const units = seen.visible ? unitsOn(view, tile) : [];
  for (const unit of units) {
    add('unit', unitText(view, unit), playerWords(view, unit.owner).civ);
  }

  // A-D6. What is built on the tile (on a tile out of sight: as last seen).
  if (seen.improvement !== null) {
    const built = IMPROVEMENTS[seen.improvement];
    add('improvement', `${built.name} (${improvementBonusText(seen.improvement)}). ${built.description}`);
  }

  // A-D7. What the tile gives a city.
  const ownLand = seen.owner === view.you;
  if (city !== null) {
    add('yields', `City centre: ${yieldWords(cityCenterYields(seen))}`);
  } else if (!tileIsWorkable(seen)) {
    // A tile no citizen can gather from (mountains).
    add('yields', 'Yields nothing: citizens cannot gather here');
  } else {
    add('yields', `Yields ${yieldWords(tileYields(seen))}`);
    // A-D7b. On the viewer's own land: who gathers these yields? The line
    // stands right under the numbers and says what happens to exactly
    // those, and by whom. (No "works": a Worker is a unit, a citizen is
    // not, and a unit on the tile changes nothing about the gathering.)
    if (ownLand) {
      const workedBy = view.cities.find(
        (candidate) => candidate.owner === view.you && candidate.own !== null && candidate.own.worked.includes(tile),
      );
      add('worked', workedBy === undefined ? 'No citizen gathers these yields' : `A citizen of ${workedBy.name} gathers these yields`);
    }
  }

  // A-D7c. On the viewer's own land: what could be built here, and by
  // which unit (a Worker builds farms and mines, a Fishing Boat the net;
  // the unit table says who, improvementBuilder). Where it fits is the
  // shared rule's answer; an improvement one of the viewer's own units is
  // building on this very tile is left out (its unit line says so).
  if (ownLand) {
    const site = siteInView(view, tile);
    for (const id of IMPROVEMENT_IDS) {
      if (improvementSiteError(site, id) !== null) continue;
      const underWay = view.units.some(
        (unit) => unit.tile === tile && unit.own !== null && unit.own.job !== null && unit.own.job.improvement === id,
      );
      if (!underWay) add('canBuild', `A ${UNITS[improvementBuilder(id)].name} can build a ${IMPROVEMENTS[id].name} here`);
    }
  }

  // A-D8. What it costs to enter, from both columns of the terrain table
  // (round 3: a unit moves on land or on the sea, and the line names whom it
  // is about). The second case restates, for the two foreign cases only,
  // what canEnterTile (shared/src/rules/movement.ts) decides for a mover:
  // another player's city or unit blocks the tile. Whoever changes the
  // blocking rules there changes this line with them.
  const byLand = tileMoveCost(seen, 'land');
  const bySea = tileMoveCost(seen, 'sea');
  const foreignHere = (city !== null && city.owner !== view.you) || units.some((unit) => unit.owner !== view.you);
  if (byLand === null && bySea === null) add('movement', 'No unit can enter');
  else if (foreignHere) add('movement', "Blocked: another player's unit or city is here");
  else if (byLand !== null) add('movement', `Land units: costs ${counted(byLand, 'move', 'moves')} to enter`);
  else add('movement', `Boats only: costs ${counted(bySea ?? 0, 'move', 'moves')} to enter`);

  // A-D9. Whose land it is.
  if (seen.owner === null) {
    add('owner', 'Belongs to nobody');
  } else {
    const owner = playerWords(view, seen.owner);
    add('owner', ownLand ? 'Belongs to you' : `Belongs to ${owner.name}`, owner.civ);
  }

  const title = seen.feature === null ? TERRAIN[seen.terrain].name : `${FEATURES[seen.feature].name} on ${TERRAIN[seen.terrain].name}`;
  return { info: { tile, knowledge: seen.visible ? 'visible' : 'remembered', title, lines }, seen };
}

/** The units the view lists on a tile: military before civilian, then by id (plain character order). */
function unitsOn(view: PlayerView, tile: TileIndex): UnitView[] {
  const rank = (unit: UnitView): number => (UNITS[unit.type].unitClass === 'military' ? 0 : 1);
  return view.units
    .filter((unit) => unit.tile === tile)
    .sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The line of one unit. The viewer's own: its moves, or its job. Anybody
 * else's: type, owner and what that type is, and nothing more (whether it
 * is at work is not ours to know, and the view does not say).
 */
function unitText(view: PlayerView, unit: UnitView): string {
  const type = UNITS[unit.type];
  if (unit.own === null) return `${type.name} of ${playerWords(view, unit.owner).name}. ${type.description}`;
  if (unit.own.job === null) return `Your ${type.name}, ${unit.own.movesLeft} of ${type.moves} moves left`;
  const job = unit.own.job;
  return `Your ${type.name}, building a ${IMPROVEMENTS[job.improvement].name} (${counted(job.turnsLeft, 'turn', 'turns')} left)`;
}

/** What the viewer's own city builds: "Building: Warrior, 4 turns", "Building: Settler" (no number yet), "Builds nothing". */
function buildingText(own: OwnCityDetail): string {
  const first = own.buildQueue[0];
  if (first === undefined) return 'Builds nothing';
  const name = UNITS[first.item.unitType].name;
  return first.turns === null ? `Building: ${name}` : `Building: ${name}, ${counted(first.turns, 'turn', 'turns')}`;
}

/**
 * A-D10. A player for a sentence, "Ben (Egypt)", and the civilization whose
 * colours go in front of the line. A player id the view does not list is
 * "another player", in nobody's colours.
 */
function playerWords(view: PlayerView, playerId: PlayerId): { name: string; civ: CivId | null } {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (player === undefined) return { name: 'another player', civ: null };
  return { name: `${player.name} (${CIVS[player.civ].name})`, civ: player.civ };
}

/** "2 food, 1 production": both numbers always, also a 0. */
function yieldWords(yields: Yields): string {
  return `${yields.food} food, ${yields.production} production`;
}

/** "1 turn", "3 turns". (countOf of ui/texts.ts; this file may not import from ui/.) */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "+1", "-1": a number with its sign. */
function withSign(amount: number): string {
  return amount < 0 ? `${amount}` : `+${amount}`;
}
