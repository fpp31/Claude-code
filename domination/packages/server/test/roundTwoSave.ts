/**
 * A game that round 2 saved, for the tests that load it. Not a test file.
 * The twin of phaseOneSave.ts, one layout later.
 *
 * packages/shared/test/fixtures/room-layout-2.json is a whole room file
 * exactly as the round 2 server's own storage wrote it: game SECND, turn 41,
 * four players, saved in the middle of a turn (seats p1 and p3 had ended
 * it). Its game state has layout 2: a city has a build queue and no `focus`
 * (its "Grow first / Build first" choice came with layout 3), and nothing
 * knows of boats or fishing nets.
 *
 * Beside it lies expected-layout-2.json: what the round 2 ENGINE said about
 * each city of that save (the tiles its citizens gather from, its food and
 * production, every "in N turns"). A save does not hold those, and the
 * round 2 engine is no longer in the folder, so this file is the only
 * witness of how the game was being played when it was saved.
 *
 * Both files are READ here and nowhere edited or made again. Tests copy the
 * save's text, byte for byte, into a temporary data folder; a test that
 * needs a damaged save changes a parsed copy and writes that into its
 * temporary folder.
 *
 * Tests take what they expect from the two files themselves, so that a save
 * that had to be made again would still pass. Only a few coarse facts are
 * named as numbers: layout 2, four players, turn 41, seats p1 and p3 ended.
 * Because of those two seats a test gives its orders to a city of seat p2
 * or p4; an order from p1 or p3 is answered 'turnAlreadyEnded'.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildItem, CityId, PlayerId, TileIndex, UnitId } from '@domination/shared';
import type { RoomFile, SeatRecord } from '../src/roomFile';
import { serializeRoomFile } from '../src/roomFileText';

/** The game code of the round 2 save, and so the name of its file. */
export const ROUND_TWO_CODE = 'SECND';

/** The tokens of its four players, in seat order (the save holds their hashes). */
export const ROUND_TWO_TOKENS: readonly string[] = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(32));

/** A city as round 2 stored it: with a queue, without a `focus`. */
export interface RoundTwoCity {
  id: CityId;
  owner: PlayerId;
  name: string;
  tile: TileIndex;
  population: number;
  foodStored: number;
  /** Optional only so that a test can take it out. */
  buildQueue?: BuildItem[];
  productionStored: number;
  /** Layout 2 has no such field. Here only so that a test can put one in by hand. */
  focus?: unknown;
}

/** A unit as round 2 stored it (the shape did not change with layout 3; the types a save may hold did). */
export interface RoundTwoUnit {
  id: UnitId;
  type: string;
  owner: PlayerId;
  tile: TileIndex;
  movesLeft: number;
  job: { improvement: string; turnsWorked: number } | null;
}

/** The parts of a round 2 game state (layout 2) that the tests look at or change. */
export interface RoundTwoGame {
  schema: number;
  turn: number;
  map: { width: number; height: number; tiles: { terrain: string; feature: string | null; improvement: string | null; cityId: CityId | null }[] };
  players: { id: PlayerId; endedTurn: boolean }[];
  units: Record<UnitId, RoundTwoUnit>;
  /** Optional only so that a test can take it out. */
  cities?: Record<CityId, RoundTwoCity>;
}

/** The round 2 room file, parsed: the envelope of today (it did not change) around a game state of layout 2. */
export interface RoundTwoRoomFile {
  format: number;
  code: string;
  createdAt: string;
  hostId: PlayerId;
  mapSize: string;
  seats: SeatRecord[];
  game: RoundTwoGame;
}

/**
 * What the round 2 engine said about one city of the save, as
 * expected-layout-2.json holds it.
 */
export interface RoundTwoCityFacts {
  name: string;
  /** The tiles its citizens gathered from, ascending (OwnCityDetail.worked). */
  worked: TileIndex[];
  /** Food and production per turn, the city's own tile included, before the citizens eat. */
  food: number;
  production: number;
  /** Food per turn after the citizens have eaten (OwnCityDetail.foodPerTurn). */
  foodSurplus: number;
  /** The "in N turns" of every row of its queue, in order. */
  queueTurns: (number | null)[];
  held: string | null;
  /** The "in N turns" of the four units round 2 could add, as 'warrior:14'. */
  optionTurns: string[];
}

/** The text of the round 2 save, exactly as it is on disk. */
export function roundTwoSaveText(): string {
  return readFileSync(new URL('../../shared/test/fixtures/room-layout-2.json', import.meta.url), 'utf8');
}

/** The round 2 save, parsed. A fresh object every time, so a test may change what it gets. */
export function roundTwoSave(): RoundTwoRoomFile {
  return JSON.parse(roundTwoSaveText()) as RoundTwoRoomFile;
}

/** The cities of the round 2 save, in the order the save lists them. */
export function roundTwoCities(): RoundTwoCity[] {
  return Object.values(roundTwoSave().game.cities ?? {});
}

/** What the round 2 engine said about every city of the save, by city id. */
export function roundTwoCityFacts(): Record<CityId, RoundTwoCityFacts> {
  const text = readFileSync(new URL('../../shared/test/fixtures/expected-layout-2.json', import.meta.url), 'utf8');
  return JSON.parse(text) as Record<CityId, RoundTwoCityFacts>;
}

/**
 * The round 2 save with something changed in its game state, as the text of
 * a save file (written the way the server writes one).
 */
export function roundTwoSaveTextWith(change: (game: RoundTwoGame) => void): string {
  const file = roundTwoSave();
  change(file.game);
  // The writer only knows today's layout by its type; it writes whatever game it is handed.
  return serializeRoomFile(file as unknown as RoomFile);
}

/**
 * Puts a save into `<dataDir>/rooms/SECND.json`, byte for byte (the round 2
 * save unless another text is given), and returns the path of the file.
 */
export function putRoundTwoSave(dataDir: string, text: string = roundTwoSaveText()): string {
  const roomsDir = join(dataDir, 'rooms');
  mkdirSync(roomsDir, { recursive: true });
  const path = join(roomsDir, `${ROUND_TWO_CODE}.json`);
  writeFileSync(path, text);
  return path;
}
