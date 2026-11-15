/**
 * A game that phase 1 saved, for the tests that load it. Not a test file.
 *
 * packages/shared/test/fixtures/room-layout-1.json is a whole room file
 * exactly as the phase 1 server's own storage wrote it: game PHASE, turn 29,
 * four players, saved in the middle of a turn (seats p1 and p3 had ended
 * it). Its game state has layout 1: a city has `production` instead of a
 * build queue, and nothing knows of improvements or jobs.
 *
 * The file is READ here and nowhere edited. Tests copy its text, byte for
 * byte, into a temporary data folder; a test that needs a damaged save
 * changes a parsed copy and writes that into its temporary folder.
 *
 * Tests take what they expect from the save itself (for every city of the
 * save: its queue is [what it was building], or empty), so that a save that
 * had to be made again still passes. Only a few coarse facts are named as
 * numbers: layout 1, four players, turn 29, seats p1 and p3 ended.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildItem, CityId, PlayerId, TileIndex, UnitId } from '@domination/shared';
import type { RoomFile, SeatRecord } from '../src/roomFile';
import { serializeRoomFile } from '../src/roomFileText';

/** The game code of the phase 1 save, and so the name of its file. */
export const PHASE_ONE_CODE = 'PHASE';

/** The tokens of its four players, in seat order (the save holds their hashes). */
export const PHASE_ONE_TOKENS: readonly string[] = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(32));

/** A city as phase 1 stored it. */
export interface PhaseOneCity {
  id: CityId;
  owner: PlayerId;
  name: string;
  tile: TileIndex;
  population: number;
  foodStored: number;
  /** What the city was building: one item, or null for "nothing chosen". Layout 2 has `buildQueue` instead. */
  production: BuildItem | null;
  productionStored: number;
}

/** The parts of a phase 1 game state (layout 1) that the tests look at or change. */
export interface PhaseOneGame {
  schema: number;
  turn: number;
  map: { width: number; height: number; tiles: Record<string, unknown>[] };
  players: { id: PlayerId; endedTurn: boolean; knowledge: { explored: number[]; remembered: Record<string, Record<string, unknown>> } }[];
  units: Record<UnitId, { id: UnitId; type: string; owner: PlayerId; tile: TileIndex; movesLeft: number }>;
  /** Optional only so that a test can take it out. */
  cities?: Record<CityId, PhaseOneCity>;
}

/** The phase 1 room file, parsed: the envelope of today (it did not change) around a game state of layout 1. */
export interface PhaseOneRoomFile {
  format: number;
  code: string;
  createdAt: string;
  hostId: PlayerId;
  mapSize: string;
  seats: SeatRecord[];
  game: PhaseOneGame;
}

/** The text of the phase 1 save, exactly as it is on disk. */
export function phaseOneSaveText(): string {
  return readFileSync(new URL('../../shared/test/fixtures/room-layout-1.json', import.meta.url), 'utf8');
}

/** The phase 1 save, parsed. A fresh object every time, so a test may change what it gets. */
export function phaseOneSave(): PhaseOneRoomFile {
  return JSON.parse(phaseOneSaveText()) as PhaseOneRoomFile;
}

/** The cities of the phase 1 save, in the order they were founded. */
export function phaseOneCities(): PhaseOneCity[] {
  return Object.values(phaseOneSave().game.cities ?? {});
}

/**
 * The phase 1 save with something changed in its game state, as the text of
 * a save file (written the way the server writes one).
 */
export function phaseOneSaveTextWith(change: (game: PhaseOneGame) => void): string {
  const file = phaseOneSave();
  change(file.game);
  // The writer only knows today's layout by its type; it writes whatever game it is handed.
  return serializeRoomFile(file as unknown as RoomFile);
}

/**
 * Puts a save into `<dataDir>/rooms/PHASE.json`, byte for byte (the phase 1
 * save unless another text is given), and returns the path of the file.
 */
export function putPhaseOneSave(dataDir: string, text: string = phaseOneSaveText()): string {
  const roomsDir = join(dataDir, 'rooms');
  mkdirSync(roomsDir, { recursive: true });
  const path = join(roomsDir, `${PHASE_ONE_CODE}.json`);
  writeFileSync(path, text);
  return path;
}
