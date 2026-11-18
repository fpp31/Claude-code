/**
 * End-to-end test: two real browsers play the first turns of a game together,
 * through the real page, the real server, the real rules and the real map.
 *
 *   npm run build      (the test uses the built client)
 *   npm run e2e
 *
 * It starts its own server inside this process, on a free port, with a
 * throw-away data folder and a fixed seed, so it never touches real saved
 * games, always gets the same map, and leaves nothing running.
 *
 * What it plays (the numbered steps in `playTwoPlayers` below):
 *   1. Ada creates a game.                 5. Ada founds a city; Ben must not see it.
 *   2. Ben joins through the link.         6. Both end the turn: turn 2.
 *   3. Ben picks a civilization;           7. Ada reloads the page and is still in her seat.
 *      Ada starts the game.                8. The server is stopped and started again:
 *   4. Ada moves her Warrior.                 both come back, and the game goes on.
 *
 * And three things that went wrong when the game was first played by hand
 * (`checkTheScreenHoldsTogether`):
 *   9. A stranger opens the link of the running game: the page says that it
 *      has started, and does not invite her to join.
 *  10. In a low window (a phone held sideways) the city panel stays on the
 *      screen, below the top bar.
 *  11. Two players with the longest names allowed, in a narrow window: the
 *      top bar stays a bar.
 *
 * And five small things that only show on a real page, each of which once
 * went wrong (`checkTheSmallThings`, one more player in a game of her own):
 *  12. A damaged link invites nobody and is called damaged.
 *  13. The lobby shows the leaders' names as written, warns that a
 *      "localhost" link only works on this computer, and a double-click on
 *      Start gives no error message.
 *  14. Enter ends the turn also right after a mouse click on a zoom button.
 *  15. "Turn N has begun." is on the screen once, however fast turns go by.
 *  16. A double-click on Leave gives no error message, and the first screen
 *      does not offer the game that was just left.
 * (Step 15a, between them, came later: a double-click on a Settler that
 * stands where its own Found City button comes up founds nothing.)
 *
 * And what the second round added: words about every tile, the build queue
 * of a city, and the Worker. Four of the steps above grew: step 4 reads the
 * unit panel's two new lines; step 5 goes on (5a) with the new city, which
 * asks for something to build and whose queue is edited; step 6 sees the
 * city save production; step 10 works the queue in the low window. Then
 * Ada and Ben play on, after everything above, so that steps 1 to 16 play
 * on a game these have not touched.
 *
 * The map explains itself (`checkTheMapExplainsItself`):
 *  17. Ada rests the mouse on a tile of her own land: a box beside the tile
 *      says what it is. It goes away on the next tile, on Escape, during a
 *      drag, with the wheel, with the keyboard and off the map.
 *  18. Ada clicks tiles: the card in the corner. After End Turn every tile
 *      answers a tap; in a low window the map steps out from under the card.
 *  19. A tile Ada has seen and left says so.
 *  20. The boxes keep the fog: Ben reads nothing about Ada's city.
 *  21. On a phone, a finger does it all (one more player, a touch screen).
 *  21a. On the phone two taps on an add button are two items, the arrows
 *       and the x take every tap for what it was aimed at, and stopping the
 *       only construction adds nothing.
 *  21b. On the phone a queue of eight greys every add button, and the
 *       sentence that says why stays in sight; on a small phone no line of
 *       the panel is cut.
 *  21c. On a tablet two taps on one x, 1.8 s apart, take two neighbours.
 *
 * The queue runs empty (`checkTheQueueRunsEmpty`):
 *  22. Ada's city completes a unit, its queue runs empty, and the game says so.
 *
 * A Worker improves the land (`checkAWorkerImprovesTheLand`):
 *  23. Ada queues a Worker and puts it first.     28. Stop and start again.
 *  24. The Worker is built.                       29. The low window.
 *  25. In the city nothing can be built.          30. Ben learns nothing.
 *  26. The Worker walks to a tile it can improve. 31. The improvement is finished,
 *  27. Ada starts the job.                            and is still there after a reload.
 *  28a. A double-click (and, on a phone, a double tap) on the Worker does
 *       not stop its work.
 *  28b. While Ada has ended her turn, "Stop work" and every button of the
 *       queue are grey, the sentence that says why is in sight with them,
 *       and the bars are as long as the numbers say.
 *  28c. A double-click (and, on a phone, a double tap) on a unit at the
 *       edge of the map does not send it to the tile beside it.
 *
 * What the panels grey out and say is one rule in plain functions
 * (packages/client/src/ui/panelButtons.ts, tested in plain Node). Steps 5a,
 * 18, 21b, 28 and 28b compare the page with what those functions answer for
 * the player's own view, so a panel that prints something else fails here.
 * Four more looks were put into older steps with the same repair: step 22
 * (a tap on the map beside "Show me" reaches the map), step 28 (the job
 * buttons after End Turn), step 31 (the job's bar) and step 33 (the city
 * panel in a second browser, one that shows its scroll bars).
 *
 * Six looks came last, for the map, the news of a turn and the hover box,
 * and for what the page files decide by themselves: step 15 (in a laptop
 * window a click closes a message), step 17 (while a unit can be sent the
 * hover box takes its full 0.4 s), step 18 (the hover box of a tile right
 * above the open card does not lie on the card), step 21 (the phone is
 * turned with a city selected: the city stays on the map), step 21b (on a
 * phone a tap on the news of a turn goes through to the tile under it),
 * and steps 22 and 24 (a tile card left open across End Turn shows the
 * words of the new turn; made in the first of their turns in which Ada's
 * city grows).
 *
 * Every press counts for what the player chose (`checkEveryPressCounts`):
 *  32. "Empty the queue" asks once; quick clicks on the add buttons and on
 *      the arrows all count, and End Turn does not go grey meanwhile.
 *  33. After a removal the entry that followed comes under the pointer,
 *      in a laptop window and in a large one.
 *  34. With the keyboard, Enter twice on the last row's x removes one
 *      entry and does not end the turn.
 *  35. Through a link with delay, two quick clicks on an add button are
 *      still two items.
 *
 * The second repair after round 2 added steps 21c and 28c and a dozen looks
 * inside older steps, each for one press or key that went wrong: step 2
 * (Ben's page, which holds no seat yet, becomes the player another tab of
 * his browser stores) and step 8 (in the game it does not, and its secret
 * is the stored one again after the restart); step 21a (two taps on the
 * LAST add button: neither the panel nor the button moves); step 28 (on a
 * phone held sideways both greyed job buttons are in view after End Turn);
 * step 28b (a tap in the strip above End Turn does nothing, a tap on the map
 * beside "Show me" still opens a card); step 34 (three Enters on the x of
 * the only row do not end the turn, and the two halves of that rule each
 * alone); step 35 (End Turn pressed while an add is on its way ends the
 * turn after it; a second press on an x 0.65 s after the first removes
 * nothing more).
 *
 * Steps 19, 26 and 28c and the card look of steps 22 and 24 depend on the
 * map the fixed seed gives, and steps 21, 21a, 21b, 21c, 28, 28a, 28b and
 * 28c on a browser that can pretend to have a touch screen; each fails with
 * a sentence that says what to change.
 *
 * Playwright is NOT a dependency of this project and `npm install` does not
 * fetch it. It is loaded from a global install; the default path below only
 * fits the machine this was first written on, so on your own computer set
 * the PLAYWRIGHT_PATH environment variable to where yours lives.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { idleUnits } from '../packages/client/src/game/selectors';
import { describeTile, unitTileText } from '../packages/client/src/game/tileInfo';
import type { TileInfo } from '../packages/client/src/game/tileInfo';
import { cityPanelButtons, unitPanelButtons } from '../packages/client/src/ui/panelButtons';
import type { AddButton, JobButton, QueueRowButtons } from '../packages/client/src/ui/panelButtons';
import { HOVER_BOX_GAP } from '../packages/client/src/ui/hoverPlacement';
import { TEST_IDS } from '../packages/client/src/ui/testIds';
import { REMOVE_HINT, ordersClosedText, productionNoteText, productionText, progressFraction, todoHints } from '../packages/client/src/ui/texts';
import { loadConfig } from '../packages/server/src/config';
import { startServer } from '../packages/server/src/server';
import {
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  RULE_ERROR_MESSAGES,
  UNITS,
  UNIT_TYPE_IDS,
  distance,
  improvementFits,
  neighbors,
  tileIsWorkable,
  tileYields,
} from '../packages/shared/src/index';
import type {
  CityId,
  CityView,
  ImprovementId,
  OwnCityDetail,
  PlayerView,
  TileIndex,
  UnitId,
  UnitTypeId,
  UnitView,
} from '../packages/shared/src/index';

const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH ?? '/opt/node-tools/node_modules/playwright';

/** The longest any single wait may take, in milliseconds. A step that takes longer fails the test. */
const WAIT_MS = 20_000;

/**
 * The client ignores a press of End Turn for 0.6 s after the button changed
 * its meaning (Controller.toggleEndTurn). Before pressing it again in a new
 * turn the test waits a little longer than that, as a person would.
 */
const END_TURN_PAUSE_MS = 800;

/**
 * The client ignores a second press on the SAME row button of a build queue
 * (the up, down or remove button of one row place) for 0.6 s after one that
 * went out, and a press on an add button or on "Empty the queue" for 0.6 s
 * after a removal (QUEUE_ROW_GUARD_MS in ui/queuePresses.ts); and a press of
 * "Build ..." or "Stop work" for 0.6 s after a job started or stopped
 * (JOB_GUARD_MS in game/controller.ts). Before the next such press the test
 * waits a little longer than that, as a person would.
 */
const GUARD_PAUSE_MS = 700;

/**
 * The client ignores the order buttons of a panel (Found City, the job
 * buttons, "Stop work", every button of the build queue) for 0.5 s after
 * the selection went to another unit or city (SELECTION_GUARD_MS in
 * game/controller.ts): the panel may have come up under the very finger
 * that selected. Before the first press in a panel that has just opened
 * the test waits a little longer than that, as a person does who first has
 * to find the button.
 */
const SELECTION_PAUSE_MS = 600;

/**
 * The client gives no order for a tap on the map for 0.5 s after the map
 * moved by itself (MAP_MOVE_GUARD_MS in game/controller.ts): it stepped
 * aside for a panel, and the tile under the pointer is another one. Before
 * a unit is sent somewhere after such a move the test waits a little longer
 * than that, as a person does who first has to find the tile again.
 */
const MAP_MOVE_PAUSE_MS = 600;

/**
 * The key under which the page keeps a player's secret in the browser's
 * storage. (STORAGE_KEYS.token in packages/client/src/net/identity.ts, a
 * file that touches the page and cannot be imported here.)
 */
const SECRET_KEY = 'domination.token';

// The small functions handed to `page.evaluate` and `page.waitForFunction`
// run inside the browser, where `window` and `document` exist. This file
// itself runs in Node, so they are only declared here.
declare const window: any;
declare const document: any;

/** What the steps need from the outside: a browser, and a server they can stop and start. */
interface TestSetup {
  /** A Playwright browser (not typed: Playwright is not a dependency of the project). */
  browser: any;
  /**
   * A second browser, one that SHOWS its scroll bars, as Chrome, Edge and
   * Firefox do on Windows and Linux. (The first hides them, as a phone
   * does, so it cannot see what a scroll bar does to a panel.)
   */
  scrollBarBrowser: any;
  /** Address of the game page. It stays the same when the server is restarted. */
  baseUrl: string;
  /** Stops the server, as if the computer it runs on was switched off. */
  stopServer(): Promise<void>;
  /** Starts a new server on the same port, with the same folder of saved games. */
  startServer(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Says what the test is doing, so a failure shows how far it got. */
function step(text: string): void {
  console.log(`  ${text}`);
}

/** Fails the test with `message` unless `condition` holds. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

/** The CSS selector of an element with a test id (packages/client/src/ui/testIds.ts). */
function byTestId(id: string): string {
  return `[data-testid="${id}"]`;
}

/** The text of the element with this test id. */
async function textOf(page: any, id: string): Promise<string> {
  return ((await page.textContent(byTestId(id))) ?? '').trim();
}

/** Waits until the element with this test id shows exactly this text. */
async function waitForText(page: any, id: string, text: string): Promise<void> {
  try {
    await page.waitForFunction(
      ([selector, wanted]: [string, string]) => document.querySelector(selector)?.textContent?.trim() === wanted,
      [byTestId(id), text],
      { timeout: WAIT_MS },
    );
  } catch {
    const shown = await page.evaluate((selector: string) => document.querySelector(selector)?.textContent ?? null, byTestId(id));
    throw new Error(`Waited ${WAIT_MS / 1000} s for "${id}" to show "${text}", but ${describeFound(shown, 'it shows')}.`);
  }
}

/** Waits until the text of the element with this test id contains these words. */
async function waitForWords(page: any, id: string, words: string): Promise<void> {
  try {
    await page.waitForFunction(
      ([selector, wanted]: [string, string]) => document.querySelector(selector)?.textContent?.includes(wanted) === true,
      [byTestId(id), words],
      { timeout: WAIT_MS },
    );
  } catch {
    const shown = await page.evaluate((selector: string) => document.querySelector(selector)?.textContent ?? null, byTestId(id));
    throw new Error(`Waited ${WAIT_MS / 1000} s for "${id}" to say "${words}", but ${describeFound(shown, 'it shows')}.`);
  }
}

/** Waits until the element with this test id has this value in one of its attributes. */
async function waitForAttribute(page: any, id: string, attribute: string, value: string): Promise<void> {
  try {
    await page.waitForFunction(
      ([selector, name, wanted]: [string, string, string]) => document.querySelector(selector)?.getAttribute(name) === wanted,
      [byTestId(id), attribute, value],
      { timeout: WAIT_MS },
    );
  } catch {
    const found = await page.evaluate(
      ([selector, name]: [string, string]) => document.querySelector(selector)?.getAttribute(name) ?? null,
      [byTestId(id), attribute],
    );
    throw new Error(`Waited ${WAIT_MS / 1000} s for "${id}" to have ${attribute}="${value}", but ${describeFound(found, 'it has')}.`);
  }
}

/** The second half of a "waited in vain" message: what was there instead. */
function describeFound(found: string | null, verb: string): string {
  return found === null ? 'the page has no such element (or it has no such attribute)' : `${verb} "${found.trim()}"`;
}

/** Waits until this page shows the game screen in the given turn, connected. */
async function waitForTurn(page: any, turn: number): Promise<void> {
  await waitForText(page, TEST_IDS.topTurn, `Turn ${turn}`);
  await waitForText(page, TEST_IDS.topConnection, 'online');
}

/**
 * Collects the secret of every `hello` a page says from now on, oldest
 * first: who the page tells the server it is, each time it connects.
 */
function watchHellos(page: any): (string | null)[] {
  const secrets: (string | null)[] = [];
  page.on('websocket', (socket: any) => {
    socket.on('framesent', (frame: { payload: string | Buffer }) => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'hello') secrets.push(message.token);
      } catch {
        // Not one of the game's messages.
      }
    });
  });
  return secrets;
}

/** The secret in the storage of the browser this page belongs to. */
async function storedSecret(page: any): Promise<string | null> {
  return page.evaluate((key: string) => window.localStorage.getItem(key), SECRET_KEY);
}

/**
 * Another tab of the same browser stores a secret, as a second tab does
 * that was opened on the browser's first visit: a page of the game's
 * address that runs none of the game's code writes it into the storage both
 * share. Returns when the browser has told `page` about it (the `storage`
 * event), and the page has had the time of a few frames to act on it.
 */
async function anotherTabStores(page: any, baseUrl: string, secret: string): Promise<void> {
  await page.evaluate((key: string) => {
    window.__heardOfSecret = false;
    window.addEventListener('storage', (event: { key: string | null }) => {
      if (event.key === key) window.__heardOfSecret = true;
    });
  }, SECRET_KEY);
  const tab = await page.context().newPage();
  await tab.goto(`${baseUrl}/healthz`);
  await tab.evaluate(([key, value]: string[]) => window.localStorage.setItem(key, value), [SECRET_KEY, secret]);
  await page.waitForFunction(() => window.__heardOfSecret === true, undefined, { timeout: WAIT_MS });
  await tab.close();
  await page.waitForTimeout(150);
}

/** Number of taken seats shown in the lobby of this page. */
async function seatCount(page: any): Promise<number> {
  return page.locator(`[data-testid^="${TEST_IDS.lobbySeat}"]`).count();
}

/** What this player's client knows about the game: exactly what the server sent it. */
async function viewOf(page: any): Promise<PlayerView> {
  const view = await page.evaluate(() => window.__domination?.view() ?? null);
  if (view === null) throw new Error('This page is not showing a game.');
  return view as PlayerView;
}

/** The viewer's own unit of a type (every player starts with one Settler and one Warrior). */
function ownUnit(view: PlayerView, type: UnitView['type']): UnitView {
  const unit = view.units.find((candidate) => candidate.owner === view.you && candidate.type === type);
  if (unit === undefined) throw new Error(`${view.you} has no ${type}.`);
  return unit;
}

/** A rectangle on the screen, in CSS pixels. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** A point on the screen, in CSS pixels. */
interface Point {
  x: number;
  y: number;
}

/** Where an element is on the screen, in CSS pixels; fails if the page has no such element. */
async function boxOf(page: any, selector: string): Promise<Box> {
  const box = await page.evaluate((wanted: string) => {
    const rect = document.querySelector(wanted)?.getBoundingClientRect();
    return rect === undefined
      ? null
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, selector);
  if (box === null) throw new Error(`The page has no element "${selector}".`);
  return box;
}

/** Does `inner` lie wholly inside `outer`? (Half a pixel is forgiven: browsers place things on fractions of a pixel.) */
function isInside(inner: Box, outer: Box): boolean {
  return inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
}

/** Do the two rectangles have a pixel in common? */
function overlap(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Does the point lie inside the rectangle? */
function holds(box: Box, point: Point): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

/** "(149, 283)": a place on the screen, for a message. */
function at(point: Point): string {
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}

/** Scrolls the map so the tile is in the middle of the screen, then clicks on it. */
async function tapTile(page: any, tile: TileIndex): Promise<void> {
  const point = await page.evaluate((target: number) => {
    window.__domination.centerOn(target);
    return window.__domination.tileToScreen(target);
  }, tile);
  await page.mouse.click(point.x, point.y);
}

/** The size of a laptop window, which is what the game is played in unless a step says otherwise. */
const LAPTOP = { width: 1280, height: 800 };

/** A low window: a phone held sideways. */
const LOW_WINDOW = { width: 844, height: 390 };

/** The same phone held upright. */
const PHONE = { width: 390, height: 844 };

/**
 * Opens a page in a browser of its own (its own storage, so its own player), and watches it for crashes.
 *
 * @param touch  true for a browser that has a touch screen, as a phone has:
 *               the page then gets fingers (`page.touchscreen`, `page.tap`)
 *               and shows its larger buttons
 */
async function openPlayer(browser: any, name: string, crashes: string[], viewport = LAPTOP, touch = false): Promise<any> {
  const context = await browser.newContext(touch ? { viewport, hasTouch: true } : { viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  // An exception nobody caught inside the page is a bug, whatever the test was looking at.
  page.on('pageerror', (error: Error) => crashes.push(`${name}'s page: ${error.message}`));
  return page;
}

// ---------------------------------------------------------------------------
// Helpers for the second round: views, the build queue, the hover box, the
// tile card, turns, a finger
// ---------------------------------------------------------------------------

/** Waits until the element with this test id is on the screen (in the page and not hidden). */
async function waitUntilShown(page: any, id: string): Promise<void> {
  try {
    await page.waitForSelector(byTestId(id), { state: 'visible', timeout: WAIT_MS });
  } catch {
    throw new Error(`Waited ${WAIT_MS / 1000} s for "${id}" to be on the screen, but it is not.`);
  }
}

/**
 * Waits until what this player's client knows passes `test`, and returns
 * that view. No button of the game changes anything on the page at the
 * press: it sends a wish, and the page changes when the server's view comes
 * back. So every press is followed by a wait like this one.
 *
 * @param what   completes the sentence "Waited 20 s for ..."
 * @param found  says what is there instead, for the message
 */
async function waitForView(
  page: any,
  what: string,
  test: (view: PlayerView) => boolean,
  found: (view: PlayerView) => string = () => 'it did not happen',
): Promise<PlayerView> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const view = await viewOf(page);
    if (test(view)) return view;
    if (Date.now() > deadline) throw new Error(`Waited ${WAIT_MS / 1000} s for ${what}, but ${found(view)}.`);
    await page.waitForTimeout(50);
  }
}

/** What a player is told about a city of their own; fails if the view has no such city. */
function ownCity(view: PlayerView, cityId: CityId): OwnCityDetail {
  const own = view.cities.find((city) => city.id === cityId)?.own ?? null;
  if (own === null) throw new Error(`${view.you} has no city "${cityId}" of their own.`);
  return own;
}

/** The build queue of an own city, as a list of unit types: ['warrior', 'scout']. */
function queueOf(view: PlayerView, cityId: CityId): UnitTypeId[] {
  return ownCity(view, cityId).buildQueue.map((entry) => entry.item.unitType);
}

/** Waits until the city's build queue is exactly this list, and returns the view that shows it. */
async function waitForQueue(page: any, cityId: CityId, wanted: UnitTypeId[]): Promise<PlayerView> {
  return waitForView(
    page,
    `the build queue to be [${wanted.join(', ')}]`,
    (view) => isDeepStrictEqual(queueOf(view, cityId), wanted),
    (view) => `it is [${queueOf(view, cityId).join(', ')}]`,
  );
}

/** One of the viewer's own units, by its id; fails if the view no longer has it. */
function unitOf(view: PlayerView, unitId: UnitId): UnitView {
  const unit = view.units.find((candidate) => candidate.id === unitId);
  if (unit === undefined) throw new Error(`${view.you}'s view has no unit "${unitId}".`);
  return unit;
}

/** Does anything of the viewer's own stand on this tile (a unit or a city)? */
function holdsOwnThing(view: PlayerView, tile: TileIndex): boolean {
  return (
    view.units.some((unit) => unit.owner === view.you && unit.tile === tile) ||
    view.cities.some((city) => city.owner === view.you && city.tile === tile)
  );
}

/** The tiles an own unit can reach this turn, as the page itself works them out. */
async function reachableOf(page: any, unitId: UnitId): Promise<TileIndex[]> {
  return page.evaluate((id: string) => window.__domination.reachable(id), unitId);
}

/** Where the middle of a tile is on the screen right now. */
async function screenOf(page: any, tile: TileIndex): Promise<Point> {
  return page.evaluate((target: number) => window.__domination.tileToScreen(target), tile);
}

/** Where a tile's box is on the screen right now. */
async function tileRectOf(page: any, tile: TileIndex): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate((target: number) => window.__domination.tileScreenRect(target), tile);
}

/**
 * Taps a tile until the element with this test id shows this text. A tile
 * that holds several of the player's things (a unit in a city, a Worker
 * behind a Warrior) gives them one after the other, tap by tap.
 */
async function tapTileUntil(page: any, tile: TileIndex, id: string, text: string): Promise<void> {
  const most = 3;
  for (let taps = 0; taps < most; taps++) {
    await tapTile(page, tile);
    if ((await page.isVisible(byTestId(id))) && (await textOf(page, id)) === text) return;
  }
  throw new Error(`Tapped tile ${tile} ${most} times, but "${id}" never showed "${text}".`);
}

/** The test ids of one place that prints what is on a tile. There are two: the hover box and the tile card. */
interface TileWordsIds {
  box: string;
  title: string;
  line: string;
}

const HOVER_BOX: TileWordsIds = { box: TEST_IDS.hoverBox, title: TEST_IDS.hoverBoxTitle, line: TEST_IDS.hoverBoxLine };
const TILE_CARD: TileWordsIds = { box: TEST_IDS.tileCard, title: TEST_IDS.tileCardTitle, line: TEST_IDS.tileCardLine };

/** What a hover box or a tile card prints, read from the page. */
interface ShownTile {
  /** The tile it says it is about (its data-tile attribute). */
  tile: number | null;
  /** How well the player knows that tile (its data-knowledge attribute). */
  knowledge: string | null;
  title: string;
  /** Top to bottom: what each line is about (the end of its test id) and its words. */
  lines: { kind: string; text: string }[];
}

/** Reads what the hover box or the tile card prints right now; fails if the page has no such element. */
async function shownTile(page: any, ids: TileWordsIds): Promise<ShownTile> {
  const shown = await page.evaluate(
    ([box, title, line]: string[]) => {
      const element = document.querySelector(`[data-testid="${box}"]`);
      if (element === null) return null;
      const tile = element.getAttribute('data-tile');
      return {
        tile: tile === null ? null : Number(tile),
        knowledge: element.getAttribute('data-knowledge'),
        title: (element.querySelector(`[data-testid="${title}"]`)?.textContent ?? '').trim(),
        lines: [...element.querySelectorAll(`[data-testid^="${line}"]`)].map((item: any) => ({
          kind: item.getAttribute('data-testid').slice(line.length),
          text: (item.textContent ?? '').trim(),
        })),
      };
    },
    [ids.box, ids.title, ids.line],
  );
  if (shown === null) throw new Error(`The page has no "${ids.box}".`);
  return shown;
}

/** Does the page print exactly what describeTile says about the tile: the same title, the same lines, in the same order? */
function saysTheSame(shown: ShownTile, words: TileInfo): boolean {
  const lines = words.lines.map((line) => ({ kind: line.kind, text: line.text }));
  return shown.title === words.title && isDeepStrictEqual(shown.lines, lines);
}

/** Everything a box prints, on one line, for a message. */
function wordsOf(shown: { title: string; lines: { text: string }[] }): string {
  return [shown.title, ...shown.lines.map((line) => line.text)].join(' / ');
}

/** The words of the lines of one kind ('owner', 'worked', 'canBuild'...). */
function linesOf(shown: ShownTile, kind: string): string[] {
  return shown.lines.filter((line) => line.kind === kind).map((line) => line.text);
}

/** Is the hover box away (not on the screen)? */
async function hoverBoxIsAway(page: any): Promise<boolean> {
  return !(await page.isVisible(byTestId(TEST_IDS.hoverBox)));
}

/**
 * Waits until the hover box is on the screen, and returns the tile it is about.
 *
 * @param tile  the tile it must be about; left out, any tile will do
 */
async function waitForHoverBox(page: any, tile: TileIndex | null = null): Promise<TileIndex> {
  try {
    await page.waitForFunction(
      ([selector, wanted]: [string, number | null]) => {
        const box = document.querySelector(selector);
        return box !== null && !box.hidden && (wanted === null || box.getAttribute('data-tile') === String(wanted));
      },
      [byTestId(TEST_IDS.hoverBox), tile],
      { timeout: WAIT_MS },
    );
  } catch {
    const away = await hoverBoxIsAway(page);
    const instead = away ? 'no box is showing' : `the box of tile ${(await shownTile(page, HOVER_BOX)).tile} is showing`;
    throw new Error(`Waited ${WAIT_MS / 1000} s for the hover box${tile === null ? '' : ` of tile ${tile}`}, but ${instead}.`);
  }
  const shown = (await shownTile(page, HOVER_BOX)).tile;
  if (shown === null) throw new Error('The hover box does not say which tile it is about (it has no data-tile).');
  return shown;
}

/**
 * Brings up the hover box of a tile, as a hand on a mouse does. A box comes
 * only for a mouse that has MOVED onto a tile and rests there, and not for
 * the tile that was clicked last. So the map is scrolled until the tile is
 * in the middle of the screen, the mouse goes to the middle of a
 * neighboring tile first, then onto the tile, and stays there.
 */
async function showHoverBox(page: any, tile: TileIndex): Promise<void> {
  const beside = neighbors(tile, await viewOf(page))[0];
  const points = await page.evaluate(
    ([target, neighbor]: number[]) => {
      const hook = window.__domination;
      hook.centerOn(target);
      return { tile: hook.tileToScreen(target), beside: hook.tileToScreen(neighbor) };
    },
    [tile, beside],
  );
  await page.mouse.move(points.beside.x, points.beside.y);
  await page.mouse.move(points.tile.x, points.tile.y);
  await waitForHoverBox(page, tile);
}

/**
 * Makes the page write down what its hover box does from now on: one entry
 * each time the box appears, goes away or turns to another tile (null: it
 * went away; a number: it shows that tile). Read with hoverBoxStory.
 *
 * "The box is gone the moment the mouse moves on" is over a sixth of a
 * second later, when the next box comes. Asked from this script, the answer
 * would depend on how busy the computer is; written down by the page
 * itself, it does not.
 */
async function watchHoverBox(page: any): Promise<void> {
  await page.evaluate((selector: string) => {
    const box = document.querySelector(selector);
    const story: (number | null)[] = [];
    window.__hoverBoxWatch?.disconnect();
    window.__hoverBoxStory = story;
    window.__hoverBoxWatch = new window.MutationObserver(() => {
      story.push(box.hidden ? null : Number(box.getAttribute('data-tile')));
    });
    window.__hoverBoxWatch.observe(box, { attributes: true, attributeFilter: ['hidden', 'data-tile'] });
  }, byTestId(TEST_IDS.hoverBox));
}

/**
 * Waits until the hover box has done something since watchHoverBox and is
 * on the screen, and returns what it did, oldest first.
 *
 * @param after  what was done to the page, for the message: "the mouse moved to the next tile"
 */
async function hoverBoxStory(page: any, after: string): Promise<(TileIndex | null)[]> {
  try {
    await page.waitForFunction(
      () => {
        const story = window.__hoverBoxStory;
        return story.length > 0 && story[story.length - 1] !== null;
      },
      undefined,
      { timeout: WAIT_MS },
    );
  } catch {
    const story = await page.evaluate(() => window.__hoverBoxStory);
    throw new Error(`Waited ${WAIT_MS / 1000} s for a hover box after ${after}, but none came (what the box did meanwhile: ${JSON.stringify(story)}).`);
  }
  return page.evaluate(() => window.__hoverBoxStory);
}

/**
 * Moves the mouse from where it rests onto another tile, and returns how
 * long the hover box of that tile took to come: the milliseconds from the
 * mouse's move to the box, measured by the page itself. (Measured from this
 * script, the answer would depend on how busy the computer is.)
 */
async function timeToHoverBox(page: any, tile: TileIndex): Promise<number> {
  const point = await screenOf(page, tile);
  await page.evaluate(
    ([boxSelector, canvasSelector, wanted]: [string, string, number]) => {
      const box = document.querySelector(boxSelector);
      const timing: { moved: number | null; shown: number | null } = { moved: null, shown: null };
      window.__hoverTiming = timing;
      document.querySelector(canvasSelector).addEventListener(
        'pointermove',
        () => {
          timing.moved = window.performance.now();
        },
        { once: true },
      );
      window.__hoverTimingWatch?.disconnect();
      window.__hoverTimingWatch = new window.MutationObserver(() => {
        const showsIt = !box.hidden && box.getAttribute('data-tile') === String(wanted);
        if (timing.shown === null && timing.moved !== null && showsIt) timing.shown = window.performance.now();
      });
      window.__hoverTimingWatch.observe(box, { attributes: true, attributeFilter: ['hidden', 'data-tile'] });
    },
    [byTestId(TEST_IDS.hoverBox), byTestId(TEST_IDS.gameCanvas), tile],
  );
  await page.mouse.move(point.x, point.y);
  try {
    await page.waitForFunction(() => window.__hoverTiming.shown !== null, undefined, { timeout: WAIT_MS });
  } catch {
    throw new Error(`Waited ${WAIT_MS / 1000} s for the hover box of tile ${tile} after the mouse moved onto it, but it did not come.`);
  }
  return page.evaluate(() => window.__hoverTiming.shown - window.__hoverTiming.moved);
}

/** Is everything this page shows as a message a "Turn N has begun."? More than that, a player whose turn held nothing of their own may not be told. */
async function onlyTurnNews(page: any): Promise<boolean> {
  return (await toastTexts(page)).every((text) => /^Turn \d+ has begun\.$/.test(text));
}

/**
 * Ada and Ben both end the turn, and both pages arrive in the next one.
 * Returns the number of that turn.
 *
 * Ben does nothing in this game but end his turns. So right after every
 * turn start his page is looked at: all it may show is that a turn has
 * begun, whatever Ada has built, queued or improved meanwhile.
 */
async function bothEndTheTurn(ada: any, ben: any): Promise<number> {
  const turn = (await viewOf(ada)).turn;
  await ada.waitForTimeout(END_TURN_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  for (const page of [ada, ben]) await waitForAttribute(page, TEST_IDS.topPlayer + 'p1', 'data-ended', 'true');
  await ben.click(byTestId(TEST_IDS.endTurnButton));
  for (const page of [ada, ben]) {
    await waitForTurn(page, turn + 1);
    await waitForAttribute(page, TEST_IDS.endTurnButton, 'data-ended', 'false');
  }
  check(await onlyTurnNews(ben), `all Ben is told is that turn ${turn + 1} has begun (on his screen: ${(await toastTexts(ben)).join(' | ')})`);
  return turn + 1;
}

/**
 * The tile the next citizen of a city will take, by the rule of the
 * citizens' first choice: the most food and production together, then the
 * most food, then the lower tile number. -1 if no tile is free. (For a
 * player with ONE city: all the player's land is then that city's.)
 */
function nextWorkedTile(view: PlayerView, city: CityView): TileIndex {
  const worked = ownCity(view, city.id).worked;
  let best: TileIndex = -1;
  let bestRank = [0, 0];
  view.tiles.forEach((ground, tile) => {
    if (ground === null || ground.owner !== view.you || tile === city.tile || !tileIsWorkable(ground) || worked.includes(tile)) return;
    const yields = tileYields(ground);
    const rank = [yields.food + yields.production, yields.food];
    // Tiles are looked at in rising order, so a tile only wins by being better, never by coming later.
    if (best === -1 || rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
      best = tile;
      bestRank = rank;
    }
  });
  return best;
}

/** Has the look "a card left open across an End Turn shows the new words" been made? (It is made in the first turn of steps 22 and 24 that lets it.) */
let cardLookMade = false;

/**
 * bothEndTheTurn, with one look on the way, made once: if Ada's city is
 * going to grow when this turn ends, the turn is ended with a tile card
 * OPEN on the tile the new citizen will take. That card says "No citizen
 * works this tile" before the turn and must say "A citizen of Rome works
 * this tile" after it: the card keeps a tile number, and its words are made
 * again from every new view. (Nothing else in this game changes the words
 * of a tile that holds nothing of Ada's.)
 *
 * @param ada  her page; whatever panel is open is open again afterwards
 */
async function bothEndTheTurnWithACardOpen(ada: any, ben: any, city: CityView): Promise<number> {
  if (cardLookMade) return bothEndTheTurn(ada, ben);
  const view = await viewOf(ada);
  const rome = ownCity(view, city.id);
  const grows = rome.foodStored + rome.foodPerTurn >= rome.foodToGrow;
  const tile = grows ? nextWorkedTile(view, city) : -1;
  if (tile === -1 || holdsOwnThing(view, tile)) return bothEndTheTurn(ada, ben);

  const cityPanelWasOpen: boolean = await ada.isVisible(byTestId(TEST_IDS.cityPanel));
  await ada.keyboard.press('Escape');
  await tapTile(ada, tile);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  const before = await shownTile(ada, TILE_CARD);
  check(
    before.tile === tile && isDeepStrictEqual(linesOf(before, 'worked'), ['No citizen works this tile']),
    `before the turn ends, the card of tile ${tile} says that no citizen works it (it says "${wordsOf(before)}")`,
  );

  const turn = await bothEndTheTurn(ada, ben);
  const words = describeTile(await viewOf(ada), tile);
  check(
    words.lines.some((line) => line.kind === 'worked' && line.text === `A citizen of ${city.name} works this tile`),
    `${city.name} grew, and its new citizen took tile ${tile}, the one the card is open on (if not, this look checks nothing: the citizens choose their tiles another way than nextWorkedTile says; describeTile says "${wordsOf(words)}")`,
  );
  check(await ada.isVisible(byTestId(TEST_IDS.tileCard)), 'a tile card that was open when the turn ended is still open in the next turn');
  const after = await shownTile(ada, TILE_CARD);
  check(
    after.tile === tile && saysTheSame(after, words),
    `a card left open across End Turn shows the words of the new turn (the card: "${wordsOf(after)}"; describeTile for the new view: "${wordsOf(words)}")`,
  );
  cardLookMade = true;
  await ada.keyboard.press('Escape');
  if (cityPanelWasOpen) await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  return turn;
}

/** Where the bottom-left panels float in a low window: a tile brought here lies under the panel that opens for it. */
const PANEL_CORNER: Point = { x: 60, y: 330 };

/**
 * Scrolls the map so that a tile comes to lie near a place on the screen,
 * with the debug hook alone (no dragging), and returns where the tile is
 * afterwards. The hook can only put a tile in the MIDDLE of the map. So
 * this looks for the tile that lies as far from the wanted tile as the
 * middle lies from the wanted place, and puts that one in the middle.
 */
async function bringTileNear(page: any, tile: TileIndex, place: Point): Promise<Point> {
  return page.evaluate(
    ([target, wanted, selector]: [number, { x: number; y: number }, string]) => {
      const hook = window.__domination;
      const canvas = document.querySelector(selector).getBoundingClientRect();
      const from = hook.tileToScreen(target);
      const aim = { x: from.x + (canvas.left + canvas.right) / 2 - wanted.x, y: from.y + (canvas.top + canvas.bottom) / 2 - wanted.y };
      let nearest = 0;
      let nearestGap = Infinity;
      for (let candidate = 0; candidate < hook.view().tiles.length; candidate++) {
        const point = hook.tileToScreen(candidate);
        const gap = Math.hypot(point.x - aim.x, point.y - aim.y);
        if (gap < nearestGap) {
          nearest = candidate;
          nearestGap = gap;
        }
      }
      hook.centerOn(nearest);
      return hook.tileToScreen(target);
    },
    [tile, place, byTestId(TEST_IDS.gameCanvas)],
  );
}

/** Did the tile arrive where bringTileNear was asked to put it (within 45 pixels both ways: tiles lie about 80 apart)? */
function isNear(point: Point, place: Point): boolean {
  return Math.abs(point.x - place.x) <= 45 && Math.abs(point.y - place.y) <= 45;
}

/**
 * Within a second: is the middle of the tile outside the element's box?
 * (The map steps aside one or two frames after a panel has opened on the
 * tile it is about.)
 */
async function comesOutFromUnder(page: any, tile: TileIndex, selector: string): Promise<boolean> {
  try {
    await page.waitForFunction(
      ([target, wanted]: [number, string]) => {
        const point = window.__domination.tileToScreen(target);
        const box = document.querySelector(wanted).getBoundingClientRect();
        return !(point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom);
      },
      [tile, selector],
      { timeout: 1000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits until the page has drawn three more frames. The map steps aside for
 * a panel that has just opened or changed its size, one or two frames
 * later; a finger that is aimed at a tile before that would land beside it.
 */
async function settled(page: any): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.requestAnimationFrame(() => done())));
      }),
  );
}

/** Scrolls the map so the tile is in the middle of the map, then taps it with a finger. */
async function fingerTile(page: any, tile: TileIndex): Promise<void> {
  await settled(page);
  const point = await page.evaluate((target: number) => {
    window.__domination.centerOn(target);
    return window.__domination.tileToScreen(target);
  }, tile);
  await page.touchscreen.tap(point.x, point.y);
}

/** tapTileUntil with a finger. */
async function fingerTileUntil(page: any, tile: TileIndex, id: string, text: string): Promise<void> {
  const most = 3;
  for (let taps = 0; taps < most; taps++) {
    await fingerTile(page, tile);
    if ((await page.isVisible(byTestId(id))) && (await textOf(page, id)) === text) return;
  }
  throw new Error(`Tapped tile ${tile} ${most} times with a finger, but "${id}" never showed "${text}".`);
}

// ---------------------------------------------------------------------------
// Helpers for the presses that could go wrong: what lies under a point, a
// press on a point, a second device, a link with delay
// ---------------------------------------------------------------------------

/** The size of a large desktop window. */
const LARGE_WINDOW = { width: 1920, height: 1080 };

/** A small phone held upright. */
const SMALL_PHONE = { width: 360, height: 640 };

/** Waits until `ms` milliseconds have passed since `since` (a Date.now() of this script). */
async function waitUntilSince(page: any, since: number, ms: number): Promise<void> {
  const left = since + ms - Date.now();
  if (left > 0) await page.waitForTimeout(left);
}

/**
 * What lies on top at a point of the screen: 'map' for the map, the test id
 * of a button (its class names, if it has no test id), '' for anything else.
 * This is what a press on that point would press.
 */
async function onTopAt(page: any, point: Point): Promise<string> {
  return page.evaluate(
    ([x, y, canvas]: [number, number, string]) => {
      const element = document.elementFromPoint(x, y);
      if (element === null) return '';
      if (element.matches(canvas)) return 'map';
      const button = element.closest('button');
      return button === null ? '' : (button.getAttribute('data-testid') ?? button.className);
    },
    [point.x, point.y, byTestId(TEST_IDS.gameCanvas)],
  );
}

/**
 * Scrolls the panel a button is in, as a wheel or a finger would, until the
 * button lies in the open (below the panel's head, above its lower edge),
 * and returns the middle of the button. Fails if something else is on top
 * there afterwards: a press on that point must press this button.
 */
async function pointOf(page: any, id: string): Promise<Point> {
  const point: Point | null = await page.evaluate((selector: string) => {
    const button = document.querySelector(selector);
    const panel = button?.closest('.panel');
    if (button == null || panel == null) return null;
    const head = panel.querySelector('.panel-head').getBoundingClientRect().bottom;
    const box = button.getBoundingClientRect();
    const frame = panel.getBoundingClientRect();
    if (box.top < head + 4) panel.scrollTop -= head + 4 - box.top;
    else if (box.bottom > frame.bottom - 6) panel.scrollTop += box.bottom - (frame.bottom - 6);
    const now = button.getBoundingClientRect();
    return { x: (now.left + now.right) / 2, y: (now.top + now.bottom) / 2 };
  }, byTestId(id));
  if (point === null) throw new Error(`The page has no button "${id}" inside a panel.`);
  await settled(page); // the panel answers a scroll with its next frames
  const onTop = await onTopAt(page, point);
  check(onTop === id, `"${id}" is in the open at ${at(point)}, so that a press there presses it (on top there: "${onTop}")`);
  return point;
}

/** A press on a point of the screen: a click of the mouse, or a tap of a finger. */
async function pressAt(page: any, point: Point, finger: boolean): Promise<void> {
  if (finger) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/**
 * Two presses on one point with nothing in between: a double-click, or a
 * double tap. (No pause on purpose: what is checked afterwards must hold
 * however fast the second press comes, and a pause here would only be a
 * margin that a busy computer could use up.)
 */
async function pressTwiceAt(page: any, point: Point, finger: boolean): Promise<void> {
  if (finger) {
    await page.touchscreen.tap(point.x, point.y);
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.dblclick(point.x, point.y);
  }
}

/**
 * Brings a tile to a place on the screen, to within 4 pixels, by dragging
 * the map with the mouse. (The debug hook can only put a tile in the middle
 * of the map, which is too coarse for a button.) The camera stops when the
 * map's edge reaches the middle of the window; a tile near the edge is then
 * brought further by zooming in, which puts more pixels between the two.
 *
 * @returns how many steps it zoomed in; the caller zooms out again with as
 *          many presses of "-" when it is done
 */
async function bringTileTo(page: any, tile: TileIndex, place: Point): Promise<number> {
  for (let zoomedIn = 0; ; zoomedIn++) {
    await settled(page);
    const from = await screenOf(page, tile);
    // Where the mouse takes hold of the map: a place where the map itself is
    // on top (the news of a turn lies over its upper middle for a few seconds).
    const canvas = await boxOf(page, byTestId(TEST_IDS.gameCanvas));
    const holds: Point[] = [
      { x: canvas.right - 120, y: canvas.top + 60 },
      { x: (canvas.left + canvas.right) / 2, y: (canvas.top + canvas.bottom) / 2 },
      { x: canvas.left + 120, y: canvas.top + 60 },
    ];
    let grip: Point | null = null;
    for (const hold of holds) if (grip === null && (await onTopAt(page, hold)) === 'map') grip = hold;
    if (grip === null) throw new Error(`Check failed: the map is on top at one of ${holds.map(at).join(', ')}, to be dragged by`);
    // A detour first, so that even a short way is a drag and never a click.
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 40, grip.y + 40, { steps: 2 });
    await page.mouse.move(grip.x + (place.x - from.x), grip.y + (place.y - from.y), { steps: 4 });
    await page.mouse.up();
    const arrived = await screenOf(page, tile);
    if (Math.abs(arrived.x - place.x) <= 4 && Math.abs(arrived.y - place.y) <= 4) return zoomedIn;
    check(
      zoomedIn < 4,
      `tile ${tile} could be brought to ${at(place)} (it lies at ${at(arrived)}, with the map zoomed in ${zoomedIn} steps: the camera stops at the map's edge; pick another tile for this step)`,
    );
    await page.keyboard.press('+');
  }
}

/** Zooms the map out again by as many steps as bringTileTo zoomed in. */
async function zoomBackOut(page: any, steps: number): Promise<void> {
  for (let step = 0; step < steps; step++) await page.keyboard.press('-');
}

/**
 * Opens the page of a player who is already in a game on a second device:
 * a browser of its own that knows the same player (a copy of the first
 * one's storage), at another size, with a touch screen if wanted.
 *
 * @param from     the player's first page
 * @param address  what the new page opens; left out, the address of `from`
 * @param origin   the origin the copied storage is filed under, when
 *                 `address` is not on the origin of `from` (a link with delay)
 * @param mobile   true (with `touch`): the browser also behaves as a phone's
 *                 does. Only then does it aim a finger's tap at the nearest
 *                 button, as a phone does
 */
async function openSecondDevice(
  browser: any,
  name: string,
  crashes: string[],
  from: any,
  viewport: { width: number; height: number },
  touch: boolean,
  address: string = from.url(),
  origin: string | null = null,
  mobile = false,
): Promise<any> {
  const storage = await from.context().storageState();
  if (origin !== null) for (const filed of storage.origins) filed.origin = origin;
  const context = await browser.newContext(touch ? { viewport, hasTouch: true, isMobile: mobile, storageState: storage } : { viewport, storageState: storage });
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  page.on('pageerror', (error: Error) => crashes.push(`${name}'s page: ${error.message}`));
  await page.goto(address);
  await page.waitForSelector(byTestId(TEST_IDS.gameCanvas));
  await waitForText(page, TEST_IDS.topConnection, 'online');
  return page;
}

/**
 * A link with delay: listens on a free port of this computer and passes
 * everything on to the game server and back, every chunk `delayMs` later
 * and in order, as an ordinary internet connection does.
 *
 * @returns the port to open the game on, and a function that takes the link down
 */
async function startSlowLink(serverPort: number, delayMs: number): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const later = (from: Socket, to: Socket): void => {
    let last: Promise<unknown> = Promise.resolve();
    const afterDelay = (act: () => void): void => {
      const due = new Promise((resolve) => setTimeout(resolve, delayMs));
      last = Promise.all([last, due]).then(() => {
        if (!to.destroyed) act();
      });
    };
    from.on('data', (chunk) => afterDelay(() => to.write(chunk)));
    from.on('end', () => afterDelay(() => to.end()));
    from.on('error', () => to.destroy());
    from.on('close', () => sockets.delete(from));
  };
  const link = createServer((browserSide) => {
    const serverSide = connect(serverPort, '127.0.0.1');
    sockets.add(browserSide).add(serverSide);
    later(browserSide, serverSide);
    later(serverSide, browserSide);
  });
  await new Promise<void>((resolve) => link.listen(0, '127.0.0.1', resolve));
  const address = link.address();
  if (address === null || typeof address === 'string') throw new Error('The link with delay has no port.');
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => link.close(() => resolve()));
    },
  };
}

/**
 * Makes the page count every change of the End Turn button's `disabled`
 * from now on (read with endTurnGreyings). The button must not go grey for
 * the blink of a round trip, and a blink is too short to be seen from this
 * script: the page itself has to count.
 */
async function watchEndTurnGreying(page: any): Promise<void> {
  await page.evaluate((selector: string) => {
    window.__endTurnWatch?.disconnect();
    window.__endTurnGreyings = 0;
    window.__endTurnWatch = new window.MutationObserver((changes: unknown[]) => {
      window.__endTurnGreyings += changes.length;
    });
    window.__endTurnWatch.observe(document.querySelector(selector), { attributes: true, attributeFilter: ['disabled'] });
  }, byTestId(TEST_IDS.endTurnButton));
}

/** How often End Turn's `disabled` has changed since watchEndTurnGreying. */
async function endTurnGreyings(page: any): Promise<number> {
  return page.evaluate(() => {
    window.__endTurnGreyings += window.__endTurnWatch.takeRecords().length;
    return window.__endTurnGreyings;
  });
}

/** Has this player ended the turn, as their own page knows it? */
async function hasEndedTurn(page: any): Promise<boolean> {
  const view = await viewOf(page);
  return view.players.some((player) => player.id === view.you && player.endedTurn);
}

// ---------------------------------------------------------------------------
// Helpers for what the panels grey out and say: the buttons as the page
// shows them, a line in sight, the length of a bar
// ---------------------------------------------------------------------------

/**
 * Is the element with this test id in sight: on the page, inside the part
 * of its panel that shows, and with nothing lying on its middle? (A line in
 * a panel's head stays in sight while the panel scrolls; a line further
 * down can be scrolled away, or lie under the head.)
 */
async function isInSight(page: any, id: string): Promise<boolean> {
  return page.evaluate((selector: string) => {
    const element = document.querySelector(selector);
    const panel = element?.closest('.panel');
    if (element == null || panel == null || element.getClientRects().length === 0) return false;
    const box = element.getBoundingClientRect();
    const frame = panel.getBoundingClientRect();
    if (box.top < frame.top - 0.5 || box.bottom > frame.bottom + 0.5) return false;
    const onTop = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    return onTop !== null && element.contains(onTop);
  }, byTestId(id));
}

/** What the city panel shows of its buttons, and of the two lines that go with them (null: not on the screen). */
interface ShownCityButtons {
  /** The line in the panel's head that says why the queue cannot be changed. */
  note: string | null;
  /** The small line under the queue's title. */
  hint: string | null;
  /** Is the queue's heading ("Build queue") on the screen? */
  queueShown: boolean;
  /** One per row on the screen, top to bottom. */
  rows: QueueRowButtons[];
  /** "Empty the queue". */
  clearDisabled: boolean | null;
  /** The add buttons on the screen, top to bottom. */
  adds: AddButton[];
}

/**
 * Reads the buttons of the open city panel from the page and compares them
 * with what cityPanelButtons (packages/client/src/ui/panelButtons.ts) answers
 * for the player's own view: which buttons are there, which are greyed
 * out, and the sentence that says why. The rule itself is tested in plain
 * Node; this is the check that the panel prints it. Returns what the page
 * shows.
 *
 * @param where  begins the message: "on the phone, with a full queue"
 */
async function cityPanelPrintsItsButtons(page: any, cityId: CityId, where: string): Promise<ShownCityButtons> {
  const view = await viewOf(page);
  const ended = view.players.some((player) => player.id === view.you && player.endedTurn);
  const answer = cityPanelButtons(ownCity(view, cityId), ended ? 'turnEnded' : null);
  const wanted: ShownCityButtons = {
    note: answer.note,
    hint: answer.hasQueue ? REMOVE_HINT : null,
    queueShown: answer.hasQueue,
    rows: answer.rows,
    clearDisabled: answer.hasQueue ? answer.clearDisabled : null,
    adds: answer.adds,
  };
  // (No named helper functions inside the page's code: the tool that runs this script wraps those in a call the page does not know.)
  const shown: ShownCityButtons = await page.evaluate(
    (ids: Record<string, string>) => {
      const panel = document.querySelector(`[data-testid="${ids.panel}"]`);
      const note = panel.querySelector(`[data-testid="${ids.note}"]`);
      const hint = panel.querySelector(`[data-testid="${ids.hint}"]`);
      const clear = panel.querySelector(`[data-testid="${ids.clear}"]`);
      return {
        note: note.getClientRects().length > 0 ? note.textContent.trim() : null,
        hint: hint.getClientRects().length > 0 ? hint.textContent.trim() : null,
        queueShown: hint.previousElementSibling.getClientRects().length > 0, // the heading stands right above the line
        rows: [...panel.querySelectorAll(`[data-testid^="${ids.row}"]`)]
          .filter((row: any) => row.getClientRects().length > 0)
          .map((row: any) => ({
            upDisabled: row.querySelector(`[data-testid^="${ids.up}"]`).disabled,
            downDisabled: row.querySelector(`[data-testid^="${ids.down}"]`).disabled,
            removeDisabled: row.querySelector(`[data-testid^="${ids.remove}"]`).disabled,
          })),
        clearDisabled: clear.getClientRects().length > 0 ? clear.disabled : null,
        adds: [...panel.querySelectorAll(`[data-testid^="${ids.add}"]`)]
          .filter((button: any) => button.getClientRects().length > 0)
          .map((button: any) => ({ unitType: button.getAttribute('data-testid').slice(ids.add.length), disabled: button.disabled })),
      };
    },
    {
      panel: TEST_IDS.cityPanel,
      note: TEST_IDS.queueNote,
      hint: TEST_IDS.queueHint,
      row: TEST_IDS.queueRow,
      up: TEST_IDS.queueUp,
      down: TEST_IDS.queueDown,
      remove: TEST_IDS.queueRemove,
      clear: TEST_IDS.queueClear,
      add: TEST_IDS.buildOption,
    },
  );
  check(
    isDeepStrictEqual(shown, wanted),
    `${where}: the city panel greys out and says what cityPanelButtons answers for the view (the panel: ${JSON.stringify(shown)}; the function: ${JSON.stringify(wanted)})`,
  );
  return shown;
}

/** What the unit panel shows of its buttons, and of the lines that go with them (null: not on the screen). */
interface ShownUnitButtons {
  /** "Found City" and the reason beside it. */
  found: { disabled: boolean; reason: string | null } | null;
  /** The job block: its first line (why nothing can be ordered), the one reason for all, its heading, the job buttons, "Stop work". */
  jobs: {
    closed: string | null;
    reason: string | null;
    showTitle: boolean;
    start: JobButton[];
    stop: { disabled: boolean; warning: string | null } | null;
  } | null;
  /** The two sentences of the hint at the panel's bottom ('' for one that is not there). */
  hint: { main: string; more: string };
}

/**
 * The same for the open unit panel and unitPanelButtons. Only for a window
 * that is not low: a low window leaves the block's heading and the hint's
 * second sentence out, whatever the function says.
 */
async function unitPanelPrintsItsButtons(page: any, unitId: UnitId, where: string): Promise<ShownUnitButtons> {
  const view = await viewOf(page);
  const ended = view.players.some((player) => player.id === view.you && player.endedTurn);
  const wanted = unitPanelButtons(view, unitOf(view, unitId), ended ? 'turnEnded' : null);
  const shown: ShownUnitButtons = await page.evaluate(
    (ids: Record<string, string>) => {
      const panel = document.querySelector(`[data-testid="${ids.panel}"]`);
      // The words of the elements that are on the screen, by name; null for one that is not.
      const words: Record<string, string | null> = {};
      for (const [name, selector] of Object.entries({
        closed: `[data-testid="${ids.closed}"]`,
        reason: `[data-testid="${ids.reason}"]`,
        warning: `[data-testid="${ids.warning}"]`,
        foundReason: '.found-row .panel-reason',
        hintMain: '.hint-main',
        hintMore: '.hint-more',
      })) {
        const element = panel.querySelector(selector);
        words[name] = element !== null && element.getClientRects().length > 0 ? element.textContent.trim() : null;
      }
      const found = panel.querySelector(`[data-testid="${ids.found}"]`);
      const jobs = panel.querySelector(`[data-testid="${ids.jobs}"]`);
      const stop = panel.querySelector(`[data-testid="${ids.stop}"]`);
      return {
        found: found.getClientRects().length > 0 ? { disabled: found.disabled, reason: words.foundReason } : null,
        jobs:
          jobs.getClientRects().length > 0
            ? {
                closed: words.closed,
                reason: words.reason,
                showTitle: jobs.querySelector('.build-title').getClientRects().length > 0,
                start: [...jobs.querySelectorAll(`[data-testid^="${ids.start}"]`)]
                  .filter((button: any) => button.getClientRects().length > 0)
                  .map((button: any) => {
                    const improvement = button.getAttribute('data-testid').slice(ids.start.length);
                    const reason = panel.querySelector(`[data-testid="${ids.jobReason}${improvement}"]`);
                    return {
                      improvement,
                      label: button.querySelector('.job-name').textContent.trim(),
                      disabled: button.disabled,
                      reason: reason.getClientRects().length > 0 ? reason.textContent.trim() : null,
                    };
                  }),
                stop: stop.getClientRects().length > 0 ? { disabled: stop.disabled, warning: words.warning } : null,
              }
            : null,
        hint: { main: words.hintMain ?? '', more: words.hintMore ?? '' },
      };
    },
    {
      panel: TEST_IDS.unitPanel,
      found: TEST_IDS.foundCityButton,
      jobs: TEST_IDS.unitJobs,
      closed: TEST_IDS.unitJobsClosed,
      reason: TEST_IDS.unitJobsReason,
      start: TEST_IDS.jobStart,
      jobReason: TEST_IDS.jobReason,
      stop: TEST_IDS.jobStop,
      warning: TEST_IDS.jobStopWarning,
    },
  );
  check(
    isDeepStrictEqual(shown, wanted),
    `${where}: the unit panel greys out and says what unitPanelButtons answers for the view (the panel: ${JSON.stringify(shown)}; the function: ${JSON.stringify(wanted)})`,
  );
  return shown;
}

/** How full a progress bar is drawn, from 0 to 1: the width of its fill against the room inside the bar. */
async function barFraction(page: any, fill: string): Promise<number> {
  const drawn: number | null = await page.evaluate((selector: string) => {
    const element = document.querySelector(selector);
    return element === null ? null : element.getBoundingClientRect().width / element.parentElement.clientWidth;
  }, fill);
  if (drawn === null) throw new Error(`The page has no bar "${fill}".`);
  return drawn;
}

/** Is a bar drawn as long as its numbers say? (To a hundredth: the page fills a bar in whole percent.) */
function barShows(drawn: number, stored: number, total: number | null): boolean {
  return Math.abs(drawn - Math.round(progressFraction(stored, total) * 100) / 100) < 0.01;
}

/** "42%", for a message. */
function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

async function playTwoPlayers(setup: TestSetup): Promise<void> {
  const crashes: string[] = [];
  const ada = await openPlayer(setup.browser, 'Ada', crashes);
  const ben = await openPlayer(setup.browser, 'Ben', crashes);
  const benSaidHello = watchHellos(ben);

  step('1. Ada opens the page, types her name and creates a game');
  await ada.goto(setup.baseUrl);
  await ada.fill(byTestId(TEST_IDS.homeNameInput), 'Ada');
  await ada.click(byTestId(TEST_IDS.homeCreateButton));
  await ada.waitForSelector(byTestId(TEST_IDS.lobbyCode));
  const code = await textOf(ada, TEST_IDS.lobbyCode);
  const link = await textOf(ada, TEST_IDS.lobbyLink);
  check(/^[A-Z0-9]{5}$/.test(code), `the game code should be five letters or digits, got "${code}"`);
  check(link === `${setup.baseUrl}/?g=${code}`, `the invite link should end in ?g=${code}, got "${link}"`);
  check((await seatCount(ada)) === 1, 'a new game has one taken seat, the host');
  check((await ada.inputValue(byTestId(TEST_IDS.lobbyMapSize))) === 'small', 'a new game starts on the small map');

  step('2. Ben opens the link: it shows the code but takes no seat until he presses Join');
  await ben.goto(link);
  await ben.waitForSelector(byTestId(TEST_IDS.homeJoinButton));
  check((await ben.inputValue(byTestId(TEST_IDS.homeCodeInput))) === code, 'the code from the link is filled in');
  await ben.fill(byTestId(TEST_IDS.homeNameInput), 'Ben');
  // The Join button is switched on once the server has answered Ben's page
  // ("you have no seat in that game"). Up to this moment Ben has only looked.
  await ben.waitForSelector(`${byTestId(TEST_IDS.homeJoinButton)}:enabled`);
  check((await seatCount(ada)) === 1, 'opening the link did not take a seat');
  // One browser is one player. This is the browser's first visit, and Ben
  // holds no seat yet: when another tab of his browser stores a secret, his
  // page becomes that player (a second tab opened in the same instant would
  // otherwise be a second player).
  const benFirst = await storedSecret(ben);
  const benSecret = 'b'.repeat(32);
  check(benFirst !== null && benFirst !== benSecret && isDeepStrictEqual(benSaidHello, [benFirst]), 'Ben\'s page made a secret of its own, stored it, and said hello with it');
  await anotherTabStores(ben, setup.baseUrl, benSecret);
  for (let waited = 0; waited < WAIT_MS && benSaidHello.length < 2; waited += 25) await ben.waitForTimeout(25);
  check(
    isDeepStrictEqual(benSaidHello, [benFirst, benSecret]),
    `a page that holds no seat takes over the secret another tab of its browser stores, and says hello again as that player (it said hello ${benSaidHello.length} times)`,
  );
  await ben.waitForSelector(`${byTestId(TEST_IDS.homeJoinButton)}:enabled`);
  check((await ben.inputValue(byTestId(TEST_IDS.homeCodeInput))) === code && (await ben.inputValue(byTestId(TEST_IDS.homeNameInput))) === 'Ben', 'the code and the name are still filled in');
  await ben.click(byTestId(TEST_IDS.homeJoinButton));
  await ben.waitForSelector(byTestId(TEST_IDS.lobbySeat + 'p2'));
  await ada.waitForSelector(byTestId(TEST_IDS.lobbySeat + 'p2'));
  check((await seatCount(ada)) === 2 && (await seatCount(ben)) === 2, 'both lobbies show two seats');
  check((await textOf(ben, TEST_IDS.lobbyCode)) === code, 'Ben is in the game Ada created');

  step('3. Ben picks Maya, Ada sees it and starts the game');
  await ben.click(byTestId(TEST_IDS.lobbyCiv + 'maya'));
  for (const page of [ada, ben]) {
    await page.waitForFunction(
      (selector: string) => document.querySelector(selector)?.textContent?.includes('Maya') === true,
      byTestId(TEST_IDS.lobbySeat + 'p2'),
      { timeout: WAIT_MS },
    );
  }
  check((await textOf(ada, TEST_IDS.lobbySeat + 'p1')).includes('Rome'), 'Ada kept Rome');
  await ada.click(byTestId(TEST_IDS.lobbyStartButton));
  for (const page of [ada, ben]) {
    await page.waitForSelector(byTestId(TEST_IDS.gameCanvas));
    await waitForTurn(page, 1);
  }
  check((await viewOf(ada)).you === 'p1' && (await viewOf(ben)).you === 'p2', 'Ada sits on seat p1 and Ben on p2');
  check((await textOf(ada, TEST_IDS.topCiv)) === 'Rome', "Ada's top bar says Rome");
  check((await textOf(ben, TEST_IDS.topCiv)) === 'Maya', "Ben's top bar says Maya");

  step('4. Ada selects her Warrior and moves it to a highlighted tile');
  const start = await viewOf(ada);
  const warrior = ownUnit(start, 'warrior');
  const settler = ownUnit(start, 'settler');
  check(await ada.isVisible(byTestId(TEST_IDS.startHint)), 'a new game shows the "First steps" note while nothing is selected');
  await tapTile(ada, warrior.tile);
  await waitForText(ada, TEST_IDS.unitName, 'Warrior');
  check((await textOf(ada, TEST_IDS.unitMoves)) === 'Moves 2/2', 'a fresh Warrior has 2 of 2 moves');
  check(!(await ada.isVisible(byTestId(TEST_IDS.startHint))), 'the "First steps" note makes room for the unit panel');
  check(
    (await textOf(ada, TEST_IDS.unitPanel)).includes('Tap the same tile again to select the Settler.'),
    'the Warrior\'s panel says how to get at the Settler on the same tile',
  );
  check((await textOf(ada, TEST_IDS.unitDescription)) === UNITS.warrior.description, 'the unit panel says what a Warrior is for');
  const tileLine = await textOf(ada, TEST_IDS.unitTile);
  check(
    tileLine === unitTileText(start, warrior) && tileLine.startsWith('Tile: '),
    `the unit panel has a line about the tile the Warrior stands on (it says "${tileLine}")`,
  );
  const reachable: TileIndex[] = await ada.evaluate((id: string) => window.__domination.reachable(id), warrior.id);
  check(reachable.length > 0, 'the Warrior can reach at least one tile');
  check(!reachable.includes(warrior.tile), 'the tile the Warrior stands on is not a place to go');
  const target = reachable[0];
  await tapTile(ada, target);
  await ada.waitForFunction(
    ([id, tile]: [string, number]) => window.__domination.view().units.some((unit: any) => unit.id === id && unit.tile === tile),
    [warrior.id, target],
    { timeout: WAIT_MS },
  );
  check(ownUnit(await viewOf(ada), 'warrior').own?.movesLeft !== 2, 'the move used up movement points');

  step('5. Ada selects her Settler and founds a city; Ben is far away and must not see it');
  await ada.keyboard.press('Escape'); // nothing selected, so the next tap selects instead of ordering the Warrior about
  await tapTile(ada, settler.tile);
  await waitForText(ada, TEST_IDS.unitName, 'Settler');
  await ada.waitForTimeout(SELECTION_PAUSE_MS); // the panel has only just opened: its buttons do nothing yet
  await ada.click(byTestId(TEST_IDS.foundCityButton));
  await ada.waitForFunction(() => window.__domination.view().cities.length === 1, undefined, { timeout: WAIT_MS });
  const afterFounding = await viewOf(ada);
  const city: CityView = afterFounding.cities[0];
  check(city.owner === 'p1' && city.tile === settler.tile, 'the city is Ada\'s and stands where the Settler stood');
  check(city.name === 'Rome' && city.population === 1, 'the first Roman city is called Rome and has one citizen');
  check(!afterFounding.units.some((unit) => unit.id === settler.id), 'the Settler was used up');
  check(afterFounding.tiles[city.tile]?.owner === 'p1', 'the city\'s tile belongs to Ada');
  check(!(await ada.isVisible(byTestId(TEST_IDS.startHint))), 'with a city founded, the "First steps" note is gone for good');

  // THE FOG CHECK. Ben's client must have been sent nothing about the city.
  const benView = await viewOf(ben);
  const cityTileForBen = benView.tiles[city.tile];
  check(
    cityTileForBen === null || !cityTileForBen.visible,
    'with the test seed the two players start far apart, so the city is out of Ben\'s sight ' +
      '(if this fails after a change to the map generator, the fog check below checks nothing: pick another seed)',
  );
  check(benView.cities.length === 0, 'Ben\'s view has no city');
  check(benView.units.every((unit) => unit.owner === 'p2'), 'Ben\'s view has no unit of Ada\'s');
  check(benView.tiles.every((tile) => tile === null || tile.owner === null), 'Ben\'s view shows nobody\'s territory');
  check(!JSON.stringify(benView).includes(city.id), 'the city\'s id appears nowhere in what Ben was sent');
  check((await ben.locator(byTestId(TEST_IDS.toast)).count()) === 0, 'Ben was shown no message about it');

  step('5a. Ada opens her new city: it asks for something to build, and the queue can be edited');
  await tapTile(ada, city.tile);
  await waitForText(ada, TEST_IDS.cityName, 'Rome');
  const romeOpenedAt = Date.now();
  check((await textOf(ada, TEST_IDS.cityProduction)).includes('Nothing to build'), 'the panel of a new city says that it has nothing to build');
  check(
    (await textOf(ada, TEST_IDS.cityProduction)) === `${productionText(ownCity(afterFounding, city.id))} ${productionNoteText(ownCity(afterFounding, city.id))}`,
    `and what that costs: its production is lost every turn (it says "${await textOf(ada, TEST_IDS.cityProduction)}")`,
  );
  const newCity = await cityPanelPrintsItsButtons(ada, city.id, 'a new city');
  check(
    !newCity.queueShown && newCity.hint === null && newCity.rows.length === 0 && newCity.clearDisabled === null,
    'a city with an empty queue shows nothing of a queue: no heading, no rows, no "Empty the queue"',
  );
  check(newCity.adds.length === 4 && newCity.adds.every((add) => !add.disabled), 'and every add button can be pressed');
  check((await textOf(ada, TEST_IDS.endTurnButton)).includes('Rome has nothing to build'), 'the End Turn button names the city that builds nothing');
  await showHoverBox(ada, city.tile);
  check(
    isDeepStrictEqual(linesOf(await shownTile(ada, HOVER_BOX), 'building'), ['Builds nothing']),
    'the hover box on the city says "Builds nothing"',
  );

  await waitUntilSince(ada, romeOpenedAt, SELECTION_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.buildOption + 'warrior'));
  await waitForQueue(ada, city.id, ['warrior']);
  const firstRow = await textOf(ada, TEST_IDS.queueRow + 0);
  check(
    firstRow.includes('Warrior') && firstRow.includes('building now, ready in '),
    `the first row of the queue is the Warrior, being built now, with the turn it will be ready in (it says "${firstRow}")`,
  );
  check((await textOf(ada, TEST_IDS.queueCount)) === 'Queue 1 of 8', 'the head of the panel counts the queue');
  check(!(await textOf(ada, TEST_IDS.endTurnButton)).includes('Rome'), 'the End Turn button no longer names Rome');

  await ada.click(byTestId(TEST_IDS.buildOption + 'scout'));
  await waitForQueue(ada, city.id, ['warrior', 'scout']);
  const secondRow = await textOf(ada, TEST_IDS.queueRow + 1);
  check(
    secondRow.includes('Scout') && secondRow.includes('ready in ') && !secondRow.includes('now'),
    `the second row is the Scout, with the turn it will be ready in (it says "${secondRow}")`,
  );

  // Another row's button counts at once: only a second press on the SAME button is held back for 0.6 s.
  await ada.click(byTestId(TEST_IDS.queueUp + 1));
  await waitForQueue(ada, city.id, ['scout', 'warrior']);
  await ada.click(byTestId(TEST_IDS.queueDown + 0));
  await waitForQueue(ada, city.id, ['warrior', 'scout']);
  check(await ada.isDisabled(byTestId(TEST_IDS.queueUp + 0)), 'the first row cannot go further up: its up arrow is greyed out');
  check(await ada.isDisabled(byTestId(TEST_IDS.queueDown + 1)), 'the last row cannot go further down: its down arrow is greyed out');
  const openQueue = await cityPanelPrintsItsButtons(ada, city.id, 'a queue of two, while orders can be given');
  check(openQueue.note === null && openQueue.hint === REMOVE_HINT, `nothing says that the queue cannot be changed, and a line says what the x does (it says "${openQueue.hint}")`);

  // The row guard. A double-click removes one entry, not two: the row
  // above stays where it is, so nothing slides under the pointer, and a
  // second press on the same button is ignored for 0.6 s.
  await ada.dblclick(byTestId(TEST_IDS.queueRemove + 1));
  await waitForQueue(ada, city.id, ['warrior']);
  await ada.waitForTimeout(GUARD_PAUSE_MS); // the answer to a second removal would be here by now; and the add buttons keep quiet for 0.6 s after a removal
  check(
    isDeepStrictEqual(queueOf(await viewOf(ada), city.id), ['warrior']),
    'a double-click on a remove button took one entry out of the queue, not two',
  );

  await ada.click(byTestId(TEST_IDS.buildOption + 'scout'));
  await waitForQueue(ada, city.id, ['warrior', 'scout']);
  check(
    (await ada.isVisible(byTestId(TEST_IDS.buildOption + 'worker'))) &&
      (await textOf(ada, TEST_IDS.buildOption + 'worker')).includes(UNITS.worker.description),
    'the city can build a Worker, and the button says what a Worker is for',
  );
  check((await toastTexts(ben)).length === 0, `Ben was shown no message about any of it (on his screen: ${(await toastTexts(ben)).join(' | ')})`);
  check(!JSON.stringify(await viewOf(ben)).includes('buildQueue'), 'what Ben was sent holds nobody\'s build queue');
  await ada.keyboard.press('Escape');

  step('6. Ada ends her turn: still turn 1. Ben ends his: turn 2');
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'true');
  for (const page of [ada, ben]) await waitForAttribute(page, TEST_IDS.topPlayer + 'p1', 'data-ended', 'true');
  check((await textOf(ada, TEST_IDS.topTurn)) === 'Turn 1', 'the turn waits for Ben');
  check((await ben.getAttribute(byTestId(TEST_IDS.topPlayer + 'p2'), 'data-ended')) === 'false', 'Ben has not ended yet');
  await ben.click(byTestId(TEST_IDS.endTurnButton));
  for (const page of [ada, ben]) {
    await waitForTurn(page, 2);
    await waitForAttribute(page, TEST_IDS.endTurnButton, 'data-ended', 'false');
    await waitForAttribute(page, TEST_IDS.topPlayer + 'p1', 'data-ended', 'false');
  }
  check(ownUnit(await viewOf(ada), 'warrior').own?.movesLeft === 2, 'a new turn gives the Warrior its moves back');
  const afterOneTurn = await viewOf(ada);
  check(ownCity(afterOneTurn, city.id).productionStored > 0, 'the city has saved production for what it builds');
  check(isDeepStrictEqual(queueOf(afterOneTurn, city.id), ['warrior', 'scout']), 'the queue still has its two entries');

  step('7. Ada reloads the page: same game, same seat, turn 2, and her city is there');
  await ada.reload();
  await waitForTurn(ada, 2);
  const reloaded = await viewOf(ada);
  check(ada.url() === link, 'the address still names the game');
  check(reloaded.you === 'p1', 'Ada is back on seat p1');
  check(reloaded.cities.some((candidate) => candidate.id === city.id && candidate.own !== null), 'Ada still has her city');

  step('8. The server stops and a new one starts on the same saved games: both come back');
  const before = { ada: await viewOf(ada), ben: await viewOf(ben) };
  // Ben's page has not been reloaded since his browser's first visit, and it
  // holds a seat: when another tab stores another secret now, it stays who
  // it is. (His seat would be gone with the secret: nobody else knows it.)
  await anotherTabStores(ben, setup.baseUrl, 'c'.repeat(32));
  check(
    benSaidHello.length === 2 && (await ben.isVisible(byTestId(TEST_IDS.gameCanvas))),
    `a page that is in a game keeps its secret when another tab stores another one (it said hello ${benSaidHello.length} times, and ${(await ben.isVisible(byTestId(TEST_IDS.gameCanvas))) ? 'shows' : 'does not show'} the game)`,
  );
  await setup.stopServer();
  for (const page of [ada, ben]) await waitForText(page, TEST_IDS.topConnection, 'reconnecting');
  await setup.startServer();
  await waitForTurn(ben, 2); // Ben's page finds the new server by itself
  check(
    benSaidHello.length > 2 && benSaidHello.slice(2).every((secret) => secret === benSecret) && (await storedSecret(ben)) === benSecret,
    'Ben came back as himself, and his secret is the stored one again',
  );
  await ada.reload(); // Ada tries her luck with a reload
  await waitForTurn(ada, 2);
  check(isDeepStrictEqual(await viewOf(ada), before.ada), 'Ada sees exactly what she saw before the restart');
  check(isDeepStrictEqual(await viewOf(ben), before.ben), 'Ben sees exactly what he saw before the restart');
  // And the game goes on: both end the turn.
  await ada.waitForTimeout(END_TURN_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  for (const page of [ada, ben]) await waitForAttribute(page, TEST_IDS.topPlayer + 'p1', 'data-ended', 'true');
  await ben.click(byTestId(TEST_IDS.endTurnButton));
  for (const page of [ada, ben]) await waitForTurn(page, 3);

  await checkTheScreenHoldsTogether(setup, crashes, ada, link, city);
  await checkTheSmallThings(setup, crashes);
  await checkTheMapExplainsItself(setup, crashes, ada, ben, city);
  await checkTheQueueRunsEmpty(ada, ben, city);
  await checkAWorkerImprovesTheLand(setup, crashes, ada, ben, city);
  await checkEveryPressCounts(setup, crashes, ada, city);

  check(crashes.length === 0, `no page may crash, but: ${crashes.join('; ')}`);
}

/**
 * Steps 9 to 11: three faults found when the game was first played by hand.
 * They are about what is on the screen (words and sizes), which no unit
 * test can see.
 *
 * @param ada   the page of a player in the running game (she owns `city`)
 * @param link  the invite link of that game
 */
async function checkTheScreenHoldsTogether(setup: TestSetup, crashes: string[], ada: any, link: string, city: CityView): Promise<void> {
  step('9. Cleo opens the link of the running game: she is told it has started, and is not invited to join');
  const cleo = await openPlayer(setup.browser, 'Cleo', crashes);
  await cleo.goto(link);
  await waitForWords(cleo, TEST_IDS.homeCodeHint, 'already started');
  check(!(await textOf(cleo, TEST_IDS.homeIntro)).includes('invited'), 'nobody is invited to a game that can no longer be joined');
  // The red message at the top fades after four seconds; the explanation under the code must still be there.
  await cleo.waitForFunction((selector: string) => document.querySelector(selector) === null, byTestId(TEST_IDS.toast), {
    timeout: WAIT_MS,
  });
  check((await textOf(cleo, TEST_IDS.homeCodeHint)).includes('already started'), 'the reason stays on the page after the toast has gone');
  await cleo.context().close();

  step('10. In a low window (a phone held sideways) the city panel stays on the screen, below the top bar');
  await ada.setViewportSize({ width: 844, height: 390 });
  await ada.keyboard.press('Escape');
  await tapTile(ada, city.tile);
  await waitForText(ada, TEST_IDS.cityName, city.name);
  const lowOpenedAt = Date.now();
  const lowWindow = { bar: await boxOf(ada, '.top-bar'), panel: await boxOf(ada, byTestId(TEST_IDS.cityPanel)) };
  check(
    lowWindow.panel.top >= lowWindow.bar.bottom,
    `the city panel starts below the top bar (the bar ends at ${lowWindow.bar.bottom}, the panel starts at ${lowWindow.panel.top})`,
  );
  check(lowWindow.panel.bottom <= 390, `the city panel ends on the screen (at ${lowWindow.panel.bottom} of 390)`);

  // The queue can be worked in a low window. The Settler's button is far
  // down the panel: the click scrolls it into view first.
  await waitUntilSince(ada, lowOpenedAt, SELECTION_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.buildOption + 'settler'));
  await waitForQueue(ada, city.id, ['warrior', 'scout', 'settler']);
  await waitUntilShown(ada, TEST_IDS.queueRow + 2);
  const scrolledBy: number = await ada.evaluate((selector: string) => document.querySelector(selector).scrollTop, byTestId(TEST_IDS.cityPanel));
  check(scrolledBy > 0, 'the panel had to scroll to reach the Settler\'s button (if not, the checks of its head below check nothing: make the window lower)');
  const scrolled = {
    panel: await boxOf(ada, byTestId(TEST_IDS.cityPanel)),
    close: await boxOf(ada, `${byTestId(TEST_IDS.cityPanel)} .panel-close`),
    count: await boxOf(ada, byTestId(TEST_IDS.queueCount)),
    row: await boxOf(ada, byTestId(TEST_IDS.queueRow + 2)),
    rowEnd: await boxOf(ada, byTestId(TEST_IDS.queueRemove + 2)),
  };
  check(
    scrolled.panel.top >= lowWindow.bar.bottom && scrolled.panel.bottom <= 390,
    `with three entries the city panel is still below the top bar and on the screen (it reaches from ${scrolled.panel.top} to ${scrolled.panel.bottom})`,
  );
  check(isInside(scrolled.close, scrolled.panel), 'the close button stayed in sight while the panel scrolled');
  check(isInside(scrolled.count, scrolled.panel), 'the queue count in the panel\'s head stayed in sight while the panel scrolled');
  check(
    scrolled.row.width <= scrolled.panel.width && scrolled.rowEnd.right <= scrolled.panel.right + 0.5,
    `a queue row is not wider than the panel, and its last button ends inside the panel (the row is ${scrolled.row.width} pixels wide, the panel ${scrolled.panel.width}; the button ends at ${scrolled.rowEnd.right}, the panel at ${scrolled.panel.right})`,
  );
  await ada.click(byTestId(TEST_IDS.queueRemove + 2));
  await waitForQueue(ada, city.id, ['warrior', 'scout']);

  await ada.keyboard.press('Escape');
  await ada.setViewportSize(LAPTOP);

  step('11. Two players with the longest names allowed, in a narrow window: the top bar stays a bar');
  const narrow = { width: 760, height: 600 };
  const max = await openPlayer(setup.browser, 'Maximilian', crashes, narrow);
  const neb = await openPlayer(setup.browser, 'Nebuchadnezzar', crashes, narrow);
  await max.goto(setup.baseUrl);
  await max.fill(byTestId(TEST_IDS.homeNameInput), 'Maximilian the Great'); // 20 characters, the most a name may have
  await max.click(byTestId(TEST_IDS.homeCreateButton));
  await max.waitForSelector(byTestId(TEST_IDS.lobbyLink));
  await neb.goto(await textOf(max, TEST_IDS.lobbyLink));
  await neb.fill(byTestId(TEST_IDS.homeNameInput), 'Nebuchadnezzar the 2');
  await neb.waitForSelector(`${byTestId(TEST_IDS.homeJoinButton)}:enabled`);
  await neb.click(byTestId(TEST_IDS.homeJoinButton));
  await max.waitForSelector(byTestId(TEST_IDS.lobbySeat + 'p2'));
  await max.click(byTestId(TEST_IDS.lobbyStartButton));
  for (const page of [max, neb]) {
    await waitForTurn(page, 1);
    const bar = await boxOf(page, '.top-bar');
    const waiting = await boxOf(page, '.top-waiting');
    // Squeezed between the name chips, "Waiting for you and ..." once broke
    // into a column one word wide, and the bar covered a third of the screen.
    check(waiting.width >= 200, `the "Waiting for ..." sentence has room for its words (it is ${Math.round(waiting.width)} pixels wide)`);
    check(bar.height <= narrow.height / 5, `the top bar leaves the screen to the map (it is ${Math.round(bar.height)} of ${narrow.height} pixels tall)`);
  }
  await max.context().close();
  await neb.context().close();
}

/** The texts of the toasts on the page right now, oldest first. */
async function toastTexts(page: any): Promise<string[]> {
  return page.evaluate(
    (selector: string) => [...document.querySelectorAll(selector)].map((toast: any) => (toast.textContent ?? '').trim()),
    byTestId(TEST_IDS.toast),
  );
}

/** How many red (error) toasts are on the page right now. */
async function errorToastCount(page: any): Promise<number> {
  return page.locator(`${byTestId(TEST_IDS.toast)}.toast-error`).count();
}

/** How far apart two neighboring tiles are drawn, in CSS pixels: it changes with every zoom step. */
async function tilePitch(page: any): Promise<number> {
  return page.evaluate(() => {
    const hook = window.__domination;
    const tile = hook.view().units[0].tile;
    return Math.round(Math.abs(hook.tileToScreen(tile + 1).x - hook.tileToScreen(tile).x));
  });
}

/**
 * Steps 12 to 16: small things that only show on a real page, played by one
 * more player in a game of her own (a game with one player moves on the
 * moment she ends her turn, which is what steps 14 and 15 need).
 */
async function checkTheSmallThings(setup: TestSetup, crashes: string[]): Promise<void> {
  const dora = await openPlayer(setup.browser, 'Dora', crashes);

  step('12. Dora opens a damaged link: she is not invited to anything, nothing of the link is repeated, and the page says the link is damaged');
  await dora.goto(`${setup.baseUrl}/?g=K7QXM%20AND%20SEND%205%20DOLLARS%20TO%20MALLORY%20FIRST`);
  await dora.fill(byTestId(TEST_IDS.homeNameInput), 'Dora');
  // The buttons are switched on once the page is connected: whatever it was going to ask the server, it has asked by now.
  await dora.waitForSelector(`${byTestId(TEST_IDS.homeCreateButton)}:enabled`);
  await dora.waitForTimeout(300);
  check((await textOf(dora, TEST_IDS.homeCodeHint)).includes('damaged'), 'the line under the code field says that the link is damaged');
  check(!(await textOf(dora, TEST_IDS.homeIntro)).includes('invited'), 'a damaged link invites nobody');
  check((await dora.inputValue(byTestId(TEST_IDS.homeCodeInput))) === '', 'the code field is empty');
  check(!((await dora.textContent('body')) ?? '').includes('MALLORY'), 'nothing of the link is printed on the page');
  check((await toastTexts(dora)).length === 0, `the server was not asked about it, so there is no message (got: ${(await toastTexts(dora)).join(' | ')})`);

  step('13. Dora creates a game: the lobby prints the leaders as written and warns about the localhost link; a double-click on Start starts the game without an error message');
  await dora.click(byTestId(TEST_IDS.homeCreateButton));
  await dora.waitForSelector(byTestId(TEST_IDS.lobbyCode));
  check((await textOf(dora, TEST_IDS.lobbyCiv + 'maya')).includes("Yax K'uk' Mo'"), `the Maya leader is printed with his apostrophes (the button says "${await textOf(dora, TEST_IDS.lobbyCiv + 'maya')}")`);
  check((await textOf(dora, TEST_IDS.lobbyCiv + 'china')).includes('Taizong of Tang'), 'the Chinese leader is Taizong of Tang');
  check(await dora.isVisible(byTestId(TEST_IDS.lobbyLocalNote)), 'a lobby opened through localhost says that its link only works on this computer');
  await dora.dblclick(byTestId(TEST_IDS.lobbyStartButton));
  await dora.waitForSelector(byTestId(TEST_IDS.gameCanvas));
  await waitForTurn(dora, 1);
  await dora.waitForTimeout(500); // the answer to a second Start would be here by now
  check((await errorToastCount(dora)) === 0, `the second click of the double-click sent nothing (messages on screen: ${(await toastTexts(dora)).join(' | ')})`);

  step('14. Dora clicks "-" with the mouse and presses Enter: the turn ends, and the map is not zoomed out a second time');
  const pitchBefore = await tilePitch(dora);
  await dora.click('button[aria-label="Zoom out"]');
  const pitchAfterClick = await tilePitch(dora);
  check(pitchAfterClick < pitchBefore, `the click zoomed out (tiles ${pitchBefore} pixels apart before, ${pitchAfterClick} after)`);
  await dora.keyboard.press('Enter');
  await waitForTurn(dora, 2);
  check((await tilePitch(dora)) === pitchAfterClick, 'Enter did not press the zoom button again');

  step('15. Dora ends the next turn at once: "Turn 3 has begun." takes the place of "Turn 2 has begun."');
  check((await toastTexts(dora)).includes('Turn 2 has begun.'), 'the new turn was announced');
  await dora.waitForTimeout(END_TURN_PAUSE_MS);
  await dora.keyboard.press('Enter');
  await waitForTurn(dora, 3);
  const begun = (await toastTexts(dora)).filter((text) => text.includes('has begun'));
  check(isDeepStrictEqual(begun, ['Turn 3 has begun.']), `one announcement, the newest (on screen: ${begun.join(' | ')})`);
  // In a laptop window with a mouse a click on a message closes it. (On a phone it goes through to the map: step 21b.)
  const messages = (await toastTexts(dora)).length;
  const message = await boxOf(dora, byTestId(TEST_IDS.toast));
  await dora.mouse.click((message.left + message.right) / 2, (message.top + message.bottom) / 2);
  check((await toastTexts(dora)).length < messages, 'in a laptop window a click on a message closes it');

  step('15a. A double-click on Dora\'s Settler, where its own Found City comes up, founds nothing; a click 0.6 s after the Settler was selected founds the city');
  const doraLand = await viewOf(dora);
  const doraWarrior = ownUnit(doraLand, 'warrior');
  const doraSettler = ownUnit(doraLand, 'settler');
  // The Warrior walks off first, so that one click on the tile selects the Settler.
  await tapTileUntil(dora, doraWarrior.tile, TEST_IDS.unitName, 'Warrior');
  const off = (await reachableOf(dora, doraWarrior.id))[0];
  check(off !== undefined, 'Dora\'s Warrior can walk off the start tile');
  await tapTile(dora, off);
  await waitForView(dora, 'Dora\'s Warrior to walk off', (now) => unitOf(now, doraWarrior.id).tile === off);
  await dora.keyboard.press('Escape');
  // Where Found City comes up for this Settler. Then nothing is selected,
  // and the Settler is brought to that very spot. While nothing is
  // selected the "First steps" note lies bottom left, over the lower part
  // of where the button will be: the spot is taken from the strip of the
  // button that is above the note.
  await tapTileUntil(dora, doraSettler.tile, TEST_IDS.unitName, 'Settler');
  const foundBox = await boxOf(dora, byTestId(TEST_IDS.foundCityButton));
  await dora.keyboard.press('Escape');
  const noteTop = (await boxOf(dora, byTestId(TEST_IDS.startHint))).top;
  const strip = { top: foundBox.top + 2, bottom: Math.min(foundBox.bottom, noteTop) - 2 };
  check(
    strip.bottom - strip.top >= 4,
    `a strip of the Found City button lies above the "First steps" note (the button starts at ${foundBox.top}, the note at ${noteTop}; if not, this step has no spot to press: do it in a taller panel)`,
  );
  const foundAt = { x: (foundBox.left + foundBox.right) / 2, y: (strip.top + strip.bottom) / 2 };
  await bringTileTo(dora, doraSettler.tile, foundAt);
  check(
    (await onTopAt(dora, foundAt)) === 'map',
    `with nothing selected the map is on top where Found City will come up, at ${at(foundAt)} (if not, the double-click checks nothing)`,
  );
  await pressTwiceAt(dora, foundAt, false);
  await dora.waitForTimeout(SELECTION_PAUSE_MS); // the answer to a Found City would be here by now; and the panel is no longer new
  check((await viewOf(dora)).cities.length === 0, 'a double-click on the Settler founded nothing');
  check(
    (await textOf(dora, TEST_IDS.unitName)) === 'Settler' && (await onTopAt(dora, foundAt)) === TEST_IDS.foundCityButton,
    'the first click selected the Settler, and Found City came up under the pointer (if not, the double-click checked nothing)',
  );
  await dora.mouse.click(foundAt.x, foundAt.y); // 0.6 s after the Settler was selected, a click on the same spot counts
  await waitForView(dora, 'Dora\'s city to be founded', (now) => now.cities.length === 1);

  step('16. Dora makes another game and leaves it with a double-click: no error message, and the first screen does not offer that game again');
  await dora.goto(setup.baseUrl);
  await dora.waitForSelector(`${byTestId(TEST_IDS.homeCreateButton)}:enabled`);
  await dora.click(byTestId(TEST_IDS.homeCreateButton));
  await dora.waitForSelector(byTestId(TEST_IDS.lobbyCode));
  await dora.dblclick(byTestId(TEST_IDS.lobbyLeaveButton));
  await dora.waitForSelector(byTestId(TEST_IDS.homeCreateButton));
  await dora.waitForTimeout(500); // the answer to a second Leave would be here by now
  check((await errorToastCount(dora)) === 0, `the second click of the double-click sent nothing (messages on screen: ${(await toastTexts(dora)).join(' | ')})`);
  check((await dora.inputValue(byTestId(TEST_IDS.homeCodeInput))) === '', 'the code of the game she left is not filled in');
  const gold = async (id: string): Promise<boolean> => dora.evaluate((selector: string) => document.querySelector(selector).classList.contains('primary'), byTestId(id));
  check((await gold(TEST_IDS.homeCreateButton)) && !(await gold(TEST_IDS.homeJoinButton)), 'the gold button, the one Enter presses, is "Create private game" again');
  check(!dora.url().includes('g='), 'the address no longer names the game');

  await dora.context().close();
}

/**
 * Steps 17 to 21: the words about tiles. A box beside the tile under a
 * resting mouse, a card in the corner for a tile that was clicked, and the
 * card again under a finger on a phone. Both print what describeTile
 * (packages/client/src/game/tileInfo.ts) makes of the player's own view, so
 * the test compares the page with that function instead of repeating its
 * sentences.
 *
 * @param ada   the page of the player who owns `city`
 * @param ben   the page of the other player, who has never seen that city
 */
async function checkTheMapExplainsItself(setup: TestSetup, crashes: string[], ada: any, ben: any, city: CityView): Promise<void> {
  step('17. Ada rests the mouse on a tile of her own land: a box beside the tile says what it is');
  await ada.keyboard.press('Escape');
  const view = await viewOf(ada);
  const spot = view.tiles.findIndex(
    (tile, index) =>
      tile !== null &&
      tile.owner === view.you &&
      tile.visible &&
      !view.units.some((unit) => unit.tile === index) &&
      !view.cities.some((other) => other.tile === index),
  );
  check(spot !== -1, 'Ada has a tile of her own land with no unit and no city on it');
  const next = neighbors(spot, view).find((tile) => view.tiles[tile] !== null);
  if (next === undefined) throw new Error(`Check failed: Ada has seen a neighbor of tile ${spot}`);
  await showHoverBox(ada, spot);
  const box = await shownTile(ada, HOVER_BOX);
  const words = describeTile(view, spot);
  check(box.tile === spot, `the box says which tile it is about (tile ${spot}; it says ${box.tile})`);
  check(saysTheSame(box, words), `the box prints what describeTile says about the tile (the box: "${wordsOf(box)}"; describeTile: "${wordsOf(words)}")`);
  check(isDeepStrictEqual(linesOf(box, 'owner'), ['Belongs to you']), 'the box says that the land is Ada\'s own');
  check(
    linesOf(box, 'worked').length === 1,
    'the box says whether a citizen works the tile (if this fails after a change to the map generator, the first tile of Ada\'s land cannot be worked: pick another seed)',
  );
  const boxAt = await boxOf(ada, byTestId(TEST_IDS.hoverBox));
  check(!overlap(boxAt, await tileRectOf(ada, spot)), 'the box lies beside the tile, never on it');
  check(boxAt.top >= (await boxOf(ada, '.top-bar')).bottom, 'the box starts below the top bar');
  check(
    boxAt.left >= 0 && boxAt.top >= 0 && boxAt.right <= LAPTOP.width && boxAt.bottom <= LAPTOP.height,
    `the box lies inside the window (it reaches from ${at({ x: boxAt.left, y: boxAt.top })} to ${at({ x: boxAt.right, y: boxAt.bottom })})`,
  );

  // The next tile. The box of the tile the mouse has left goes away at
  // once; the next one comes when the mouse has rested again.
  await watchHoverBox(ada);
  const nextPoint = await screenOf(ada, next);
  await ada.mouse.move(nextPoint.x, nextPoint.y);
  const onTheWay = await hoverBoxStory(ada, 'the mouse moved to the next tile');
  check(onTheWay[0] === null, `the box goes away the moment the mouse is on another tile (what it did: ${JSON.stringify(onTheWay)})`);
  await waitForHoverBox(ada, next);

  // Escape closes only the box. (With a unit selected the box takes its
  // time, so that it does not hop about over the tiles the unit is sent to.)
  const warrior = ownUnit(view, 'warrior');
  await tapTile(ada, warrior.tile);
  await waitForText(ada, TEST_IDS.unitName, 'Warrior');
  const reach = await reachableOf(ada, warrior.id);
  check(reach.length > 0, 'the Warrior can go somewhere, so there is a tile to aim at');
  await showHoverBox(ada, reach[0]);
  // The Warrior can be sent somewhere, and a box is showing. Without a unit
  // the box of the next tile would come 0.15 s after the mouse (as above);
  // now it takes the full 0.4 s, so that no box hops along over the tiles
  // the mouse crosses on its way to where the Warrior is sent.
  const onTheWayTo = neighbors(reach[0], view).find((tile) => view.tiles[tile] !== null && tile !== warrior.tile);
  if (onTheWayTo === undefined) throw new Error(`Check failed: Ada has seen a neighbor of tile ${reach[0]}`);
  const tookMs = await timeToHoverBox(ada, onTheWayTo);
  check(
    tookMs >= 300,
    `while a unit is selected that can be sent somewhere, the hover box of the next tile takes its full time, 0.4 s (it came ${Math.round(tookMs)} ms after the mouse moved onto the tile)`,
  );
  await ada.keyboard.press('Escape');
  check(await hoverBoxIsAway(ada), 'Escape closes the hover box');
  check(await ada.isVisible(byTestId(TEST_IDS.unitPanel)), 'and nothing else: the Warrior is still selected');
  await ada.keyboard.press('Escape');
  check(!(await ada.isVisible(byTestId(TEST_IDS.unitPanel))), 'Escape without a hover box clears the selection, as before');

  // A drag. Nothing is shown from the press on; when the map has come to
  // rest, the tile under the mouse gets its box.
  await showHoverBox(ada, spot);
  const grip = await screenOf(ada, spot);
  await ada.mouse.down();
  check(await hoverBoxIsAway(ada), 'the box goes away when the mouse button goes down');
  for (let dragged = 10; dragged <= 40; dragged += 10) {
    await ada.mouse.move(grip.x + dragged, grip.y);
    check(await hoverBoxIsAway(ada), `no box is shown while the map is dragged (${dragged} pixels so far)`);
  }
  await ada.mouse.up();
  check((await screenOf(ada, spot)).x > grip.x + 20, 'the map went along with the mouse');
  check(
    !(await ada.isVisible(byTestId(TEST_IDS.tileCard))) &&
      !(await ada.isVisible(byTestId(TEST_IDS.unitPanel))) &&
      !(await ada.isVisible(byTestId(TEST_IDS.cityPanel))),
    'a drag is not a click: no card opened and nothing was selected',
  );
  await waitForHoverBox(ada);

  // The wheel. Gone at once; back when the map has come to rest, and again
  // beside its tile.
  await watchHoverBox(ada);
  await ada.mouse.wheel(0, -100);
  const whileZooming = await hoverBoxStory(ada, 'the wheel turned');
  check(whileZooming[0] === null, `the box goes away the moment the wheel turns (what it did: ${JSON.stringify(whileZooming)})`);
  const zoomedOn = await waitForHoverBox(ada);
  check(
    !overlap(await boxOf(ada, byTestId(TEST_IDS.hoverBox)), await tileRectOf(ada, zoomedOn)),
    'after the zoom step the box is again beside its tile, not on it',
  );
  await ada.waitForTimeout(500); // for 0.4 s the wheel counts as still turning; after that a notch is a step again
  await watchHoverBox(ada);
  await ada.mouse.wheel(0, 100);
  await hoverBoxStory(ada, 'the wheel turned back');

  // The keyboard. The map moves and the mouse does not: the box goes away
  // and stays away until the mouse itself moves.
  await ada.keyboard.press('+');
  check(await hoverBoxIsAway(ada), 'the box goes away when a key zooms the map');
  await ada.waitForTimeout(700);
  check(await hoverBoxIsAway(ada), 'and it stays away while the mouse rests');
  await ada.keyboard.press('-');
  await ada.mouse.move(grip.x + 42, grip.y);
  await waitForHoverBox(ada);

  // Off the map.
  await ada.hover(byTestId(TEST_IDS.endTurnButton));
  check(await hoverBoxIsAway(ada), 'the box goes away when the mouse leaves the map');

  step('18. Ada clicks tiles: the card in the corner says the same, also after End Turn and in a low window');
  // Her city's panel is open when she clicks the first tile, so that the card has something to take the place of.
  await tapTile(ada, city.tile);
  await waitForText(ada, TEST_IDS.cityName, city.name);
  await tapTile(ada, spot);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  const card = await shownTile(ada, TILE_CARD);
  check(card.tile === spot, `the card says which tile it is about (tile ${spot}; it says ${card.tile})`);
  check(saysTheSame(card, words), `the card prints what describeTile says about the tile, as the hover box did (the card: "${wordsOf(card)}"; describeTile: "${wordsOf(words)}")`);
  check(
    !(await ada.isVisible(byTestId(TEST_IDS.unitPanel))) && !(await ada.isVisible(byTestId(TEST_IDS.cityPanel))),
    'the card is the only thing bottom left: the city panel made room for it',
  );
  await tapTile(ada, spot);
  check(await ada.isVisible(byTestId(TEST_IDS.tileCard)), 'a second click on the same tile leaves the card open');
  // With the card open, the mouse rests on a tile right above it: the hover box may not lie on the card.
  await theHoverBoxKeepsOffThePanel(ada, next, TEST_IDS.tileCard);
  await ada.click(byTestId(TEST_IDS.tileCardClose));
  check(!(await ada.isVisible(byTestId(TEST_IDS.tileCard))), 'the x button closes the card');

  const unseen = view.tiles.findIndex((tile) => tile === null);
  check(unseen !== -1, 'Ada has not seen the whole map yet');
  await tapTile(ada, unseen);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  const blank = await shownTile(ada, TILE_CARD);
  check(blank.tile === unseen && blank.title === 'Unexplored', `the card of a tile Ada has never seen is headed "Unexplored" (it says "${blank.title}")`);
  check(blank.lines.length === 0, `and has no lines (it says "${wordsOf(blank)}")`);
  await ada.keyboard.press('Escape');
  check(!(await ada.isVisible(byTestId(TEST_IDS.tileCard))), 'Escape closes the card');
  // A card is open again when she clicks her own city, so that there is a card that has to go.
  await tapTile(ada, spot);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  await tapTile(ada, city.tile);
  await waitForText(ada, TEST_IDS.cityName, city.name);
  check(
    (await ada.isVisible(byTestId(TEST_IDS.cityPanel))) && !(await ada.isVisible(byTestId(TEST_IDS.tileCard))),
    'a click on Ada\'s own city opens the city panel and closes the card',
  );
  await ada.keyboard.press('Escape');

  // After End Turn every tile answers a tap. (A tile the selected unit
  // could reach used to swallow the tap while the turn was ended.)
  await tapTile(ada, warrior.tile);
  await waitForText(ada, TEST_IDS.unitName, 'Warrior');
  const target = (await reachableOf(ada, warrior.id)).find((tile) => !holdsOwnThing(view, tile)); // nothing has moved since `view`
  if (target === undefined) throw new Error('Check failed: the Warrior can reach a tile that holds nothing of Ada\'s');
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'true');
  await tapTile(ada, target);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  check((await shownTile(ada, TILE_CARD)).tile === target, 'after End Turn a tap on a tile the Warrior could reach opens that tile\'s card');
  await ada.waitForTimeout(END_TURN_PAUSE_MS); // the answer to an order would be here by now; and the pause before End Turn is pressed again
  check(unitOf(await viewOf(ada), warrior.id).tile === warrior.tile, 'and the Warrior has not moved');
  await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  check(
    (await ada.isVisible(byTestId(TEST_IDS.queueClear))) && (await ada.isDisabled(byTestId(TEST_IDS.queueClear))),
    'after End Turn "Empty the queue" is there, greyed out',
  );
  const endedQueue = await cityPanelPrintsItsButtons(ada, city.id, 'after End Turn');
  check(
    endedQueue.rows.length === 2 && endedQueue.rows.every((row) => row.upDisabled && row.downDisabled && row.removeDisabled),
    'after End Turn every arrow and every x of the queue is greyed out',
  );
  check(endedQueue.adds.length === 4 && endedQueue.adds.every((add) => add.disabled), 'and so is every add button');
  check(
    endedQueue.note !== null && endedQueue.note.includes('ended your turn') && (await isInSight(ada, TEST_IDS.queueNote)),
    `the head of the panel says why (it says "${endedQueue.note}")`,
  );
  // The two bars of the city are as long as the numbers of the view say.
  const growing = ownCity(await viewOf(ada), city.id);
  const firstCost = growing.buildQueue[0]?.cost ?? null;
  check(
    growing.foodStored > 0 && growing.productionStored > 0 && growing.foodStored * (firstCost ?? 0) !== growing.productionStored * growing.foodToGrow,
    `Rome has stored food and production, and not the same share of each (${growing.foodStored} of ${growing.foodToGrow}, ${growing.productionStored} of ${firstCost}; if not, the two checks after this one check less: look at the bars in another turn)`,
  );
  const foodBar = await barFraction(ada, `${byTestId(TEST_IDS.cityPanel)} .bar-fill.food`);
  const productionBar = await barFraction(ada, `${byTestId(TEST_IDS.cityPanel)} .bar-fill.production`);
  check(
    barShows(foodBar, growing.foodStored, growing.foodToGrow),
    `the food bar is as long as the food stored, ${growing.foodStored} of ${growing.foodToGrow} (it is at ${percent(foodBar)})`,
  );
  check(
    barShows(productionBar, growing.productionStored, firstCost),
    `the production bar is as long as the production stored, ${growing.productionStored} of ${firstCost} (it is at ${percent(productionBar)})`,
  );
  await ada.keyboard.press('Escape');
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'false');
  await ada.keyboard.press('Escape');

  // The low window. The card opens bottom left, so the tile is brought
  // there first: the map then has to step out from under the card.
  await ada.setViewportSize(LOW_WINDOW);
  await settled(ada); // the page takes a new window size in with its next frames; nobody clicks sooner
  const under = await bringTileNear(ada, spot, PANEL_CORNER);
  check(
    isNear(under, PANEL_CORNER),
    `the tile did not arrive in the bottom-left corner (the camera stops at the map's edge): pick another tile for this step (it is at ${at(under)})`,
  );
  await ada.mouse.click(under.x, under.y);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  const lowCard = await boxOf(ada, byTestId(TEST_IDS.tileCard));
  check((await shownTile(ada, TILE_CARD)).tile === spot, 'the click in the corner opened the card of the tile that was brought there');
  check(lowCard.top >= (await boxOf(ada, '.top-bar')).bottom, 'in a low window the card starts below the top bar');
  check(lowCard.bottom <= LOW_WINDOW.height, `the card ends on the screen (at ${lowCard.bottom} of ${LOW_WINDOW.height})`);
  check(lowCard.height <= 150, `the card is at most 150 pixels tall (it is ${lowCard.height})`);
  check(holds(lowCard, under), `the card opened on top of its own tile (if not, the next check checks nothing: move the corner; the tile was at ${at(under)})`);
  check(await comesOutFromUnder(ada, spot, byTestId(TEST_IDS.tileCard)), 'within a second the map has stepped aside, and the tile is no longer under its card');
  const steppedAsideAt = Date.now();
  await ada.keyboard.press('Escape');
  await ada.setViewportSize(LAPTOP);

  step('19. A tile Ada has seen and left says so');
  await waitUntilSince(ada, steppedAsideAt, MAP_MOVE_PAUSE_MS); // the map has just stepped aside: a tap on it gives no order yet
  await tapTile(ada, warrior.tile);
  await waitForText(ada, TEST_IDS.unitName, 'Warrior');
  const fromCity = (tile: TileIndex): number => distance(tile, city.tile, view);
  const wayOut = await reachableOf(ada, warrior.id);
  check(wayOut.length > 0, 'the Warrior can walk away from the city');
  const away = wayOut.reduce((far, tile) => (fromCity(tile) > fromCity(far) ? tile : far));
  await tapTile(ada, away);
  await waitForView(ada, 'the Warrior to walk away from the city', (now) => unitOf(now, warrior.id).tile === away);
  await bothEndTheTurn(ada, ben);
  const wayBack = (await reachableOf(ada, warrior.id)).filter((tile) => tile !== city.tile);
  check(wayBack.length > 0, 'the Warrior can walk back towards the city');
  const back = wayBack.reduce((near, tile) => (fromCity(tile) < fromCity(near) ? tile : near));
  await tapTile(ada, back);
  const walked = await waitForView(ada, 'the Warrior to walk back towards the city', (now) => unitOf(now, warrior.id).tile === back);
  const fogged = walked.tiles.findIndex((tile) => tile !== null && !tile.visible);
  check(fogged !== -1, 'no tile is out of sight after the walk: pick another seed or walk further');
  await ada.keyboard.press('Escape');
  await tapTile(ada, fogged);
  await waitUntilShown(ada, TEST_IDS.tileCard);
  const remembered = await shownTile(ada, TILE_CARD);
  check(remembered.tile === fogged && remembered.knowledge === 'remembered', `the card of a tile out of sight is marked as remembered (it is marked "${remembered.knowledge}")`);
  check(linesOf(remembered, 'remembered').length === 1, 'its first words are that the tile is shown as Ada last saw it');
  check(linesOf(remembered, 'unit').length === 0, 'and it names no unit');
  await ada.keyboard.press('Escape');

  step('20. The boxes keep the fog: Ben reads nothing about the tile of Ada\'s city');
  check(
    (await viewOf(ben)).tiles[city.tile] === null,
    'Ben has never seen the tile of Ada\'s city (if this fails after a change to the map generator, this step checks nothing: pick another seed)',
  );
  await tapTile(ben, city.tile);
  await waitUntilShown(ben, TEST_IDS.tileCard);
  const benCard = await shownTile(ben, TILE_CARD);
  check(benCard.tile === city.tile && benCard.title === 'Unexplored' && benCard.lines.length === 0, `Ben's card of that tile says "Unexplored" and nothing else (it says "${wordsOf(benCard)}")`);
  check(!(await textOf(ben, TEST_IDS.tileCard)).includes(city.name), 'the city\'s name is nowhere on Ben\'s card');
  await showHoverBox(ben, city.tile);
  const benBox = await shownTile(ben, HOVER_BOX);
  check(benBox.title === 'Unexplored' && benBox.lines.length === 0, `Ben's hover box on that tile says the same (it says "${wordsOf(benBox)}")`);
  check(!(await textOf(ben, TEST_IDS.hoverBox)).includes(city.name), 'the city\'s name is nowhere in Ben\'s hover box');
  await ben.keyboard.press('Escape'); // the box
  await ben.keyboard.press('Escape'); // the card

  step('21. On a phone, a finger does it all: Eve taps units and tiles, founds a city and queues a Warrior');
  const eve = await openPlayer(setup.browser, 'Eve', crashes, PHONE, true);
  await eve.goto(setup.baseUrl);
  await eve.fill(byTestId(TEST_IDS.homeNameInput), 'Eve');
  await eve.waitForSelector(`${byTestId(TEST_IDS.homeCreateButton)}:enabled`);
  await eve.tap(byTestId(TEST_IDS.homeCreateButton));
  await eve.waitForSelector(byTestId(TEST_IDS.lobbyCode));
  await eve.tap(byTestId(TEST_IDS.lobbyStartButton));
  await eve.waitForSelector(byTestId(TEST_IDS.gameCanvas));
  await waitForTurn(eve, 1);
  check(
    await eve.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    'the page takes this browser for one with a touch screen (if not, this step checks nothing: start the browser with a touch screen another way)',
  );
  const eveStart = await viewOf(eve);
  const eveWarrior = ownUnit(eveStart, 'warrior');
  const home = eveWarrior.tile;
  const phoneScreen = { left: 0, top: 0, right: PHONE.width, bottom: PHONE.height, width: PHONE.width, height: PHONE.height };

  await fingerTile(eve, home);
  await waitForText(eve, TEST_IDS.unitName, 'Warrior');
  check(
    (await eve.isVisible(byTestId(TEST_IDS.unitTile))) && (await textOf(eve, TEST_IDS.unitTile)).startsWith('Tile: '),
    'a tap on a unit opens its panel, with the line about its tile',
  );
  await eve.tap(`${byTestId(TEST_IDS.unitPanel)} .panel-close`);
  check(!(await eve.isVisible(byTestId(TEST_IDS.unitPanel))), 'the x button closes the unit panel');

  const beside = neighbors(home, eveStart).find((tile) => !eveStart.units.some((unit) => unit.tile === tile));
  if (beside === undefined) throw new Error('Check failed: a tile next to Eve\'s start has nothing on it');
  await fingerTile(eve, beside);
  await waitUntilShown(eve, TEST_IDS.tileCard);
  await settled(eve);
  const deckCard = await boxOf(eve, byTestId(TEST_IDS.tileCard));
  const phoneMap = await boxOf(eve, byTestId(TEST_IDS.gameCanvas));
  check((await shownTile(eve, TILE_CARD)).tile === beside, 'a tap on a tile with nothing on it opens that tile\'s card');
  check(deckCard.top >= phoneMap.bottom - 0.5, `on a phone held upright the card lies in the deck below the map (the map ends at ${phoneMap.bottom}, the card starts at ${deckCard.top})`);
  check(isInside(deckCard, phoneScreen), `the card is wholly on the screen (it reaches from ${at({ x: deckCard.left, y: deckCard.top })} to ${at({ x: deckCard.right, y: deckCard.bottom })})`);
  check(!(await eve.isVisible(byTestId(TEST_IDS.startHint))), 'the "First steps" note makes room for the card');
  await eve.waitForTimeout(1000);
  check(await hoverBoxIsAway(eve), 'a finger never brings up a hover box');

  await fingerTile(eve, home);
  await waitForText(eve, TEST_IDS.unitName, 'Warrior');
  const eveReach = await reachableOf(eve, eveWarrior.id);
  check(eveReach.length > 0, 'Eve\'s Warrior can go somewhere');
  await fingerTile(eve, eveReach[0]);
  await waitForView(eve, 'Eve\'s Warrior to walk to the tapped tile', (now) => unitOf(now, eveWarrior.id).tile === eveReach[0]);
  check(!(await eve.isVisible(byTestId(TEST_IDS.tileCard))), 'a tap on a highlighted tile is an order: no card opens');

  // No Escape key on a phone: the x button clears the selection, so that
  // the next tap on the start tile selects instead of calling the Warrior back.
  await eve.tap(`${byTestId(TEST_IDS.unitPanel)} .panel-close`);
  await fingerTileUntil(eve, home, TEST_IDS.unitName, 'Settler');

  await eve.waitForTimeout(SELECTION_PAUSE_MS); // the panel has only just opened: its buttons do nothing yet
  await eve.tap(byTestId(TEST_IDS.foundCityButton));
  const eveCity = (await waitForView(eve, 'Eve\'s city to be founded', (now) => now.cities.length === 1)).cities[0];
  await fingerTileUntil(eve, eveCity.tile, TEST_IDS.cityName, eveCity.name);
  await eve.waitForTimeout(SELECTION_PAUSE_MS);
  await eve.tap(byTestId(TEST_IDS.buildOption + 'warrior'));
  await waitForQueue(eve, eveCity.id, ['warrior']);
  await waitUntilShown(eve, TEST_IDS.queueRemove + 0);
  const removeButton = await boxOf(eve, byTestId(TEST_IDS.queueRemove + 0));
  check(
    removeButton.width >= 44 && removeButton.height >= 44,
    `a row button is big enough for a finger, 44 by 44 pixels (it is ${removeButton.width} by ${removeButton.height})`,
  );
  await eve.locator(byTestId(TEST_IDS.buildOption + 'worker')).scrollIntoViewIfNeeded();
  const eveScrolledBy: number = await eve.evaluate((selector: string) => document.querySelector(selector).scrollTop, byTestId(TEST_IDS.cityPanel));
  check(eveScrolledBy > 0, 'the panel had to scroll to show the Worker\'s button (if not, the two checks after this one check nothing)');
  const evePanel = await boxOf(eve, byTestId(TEST_IDS.cityPanel));
  check(isInside(await boxOf(eve, `${byTestId(TEST_IDS.cityPanel)} .panel-close`), evePanel), 'the close button stays in sight while the panel is scrolled down');
  check(isInside(await boxOf(eve, byTestId(TEST_IDS.queueCount)), evePanel), 'the queue count stays in sight while the panel is scrolled down');

  // The phone is turned on its side: the panels float bottom left again.
  await eve.setViewportSize(LOW_WINDOW);
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  const turned = await viewOf(eve);
  const empty = neighbors(eveCity.tile, turned).find((tile) => !turned.units.some((unit) => unit.tile === tile));
  if (empty === undefined) throw new Error('Check failed: a tile next to Eve\'s city has nothing on it');
  await fingerTile(eve, empty);
  await waitUntilShown(eve, TEST_IDS.tileCard);
  const sideCard = await boxOf(eve, byTestId(TEST_IDS.tileCard));
  check((await shownTile(eve, TILE_CARD)).tile === empty, 'with the phone on its side a tap on an empty tile opens that tile\'s card');
  check(
    isInside(sideCard, await boxOf(eve, byTestId(TEST_IDS.gameCanvas))) && sideCard.right <= LOW_WINDOW.width / 2,
    `the card floats over the map, bottom left (it reaches from ${at({ x: sideCard.left, y: sideCard.top })} to ${at({ x: sideCard.right, y: sideCard.bottom })})`,
  );
  check(sideCard.height <= 150, `the card is at most 150 pixels tall (it is ${sideCard.height})`);
  check(sideCard.top >= (await boxOf(eve, '.top-bar')).bottom, 'the card starts below the top bar');

  await turningThePhoneKeepsTheCityOnTheMap(eve, eveCity);
  await checkAPhoneTakesEveryTap(eve, eveCity, eveWarrior.id);
  await checkAFullQueueSaysSo(eve, eveCity);
  await checkASlowFingerTakesNeighbours(eve, eveCity);
  await aTapGoesThroughTheNews(eve, eveCity);
  await eve.context().close();
}

/**
 * Step 22: a build queue that runs empty. The city says so in every place
 * the player may be looking: a message, the End Turn button, "Show me".
 *
 * @param ada   the page of the player who owns `city`; its queue is Warrior, Scout
 * @param ben   the page of the other player, who must be shown nothing of it
 */
async function checkTheQueueRunsEmpty(ada: any, ben: any, city: CityView): Promise<void> {
  step('22. Ada\'s city completes a unit, its queue runs empty, and the game says so');
  await ada.keyboard.press('Escape');
  await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  const saved = ownCity(await viewOf(ada), city.id).productionStored;
  await ada.waitForTimeout(SELECTION_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.queueRemove + 0));
  const stopped = await waitForQueue(ada, city.id, ['scout']);
  check(ownCity(stopped, city.id).productionStored === saved, 'stopping the Warrior kept what the city had saved');
  const building = await textOf(ada, TEST_IDS.cityProduction);
  check(
    building.startsWith(`${UNITS.scout.name} ${saved}/${UNITS.scout.cost} `),
    `the Scout starts with everything the city had saved, ${saved} production (the panel says "${building}")`,
  );

  let scoutIsThere = false;
  for (let turns = 0; turns < 12 && !scoutIsThere; turns++) {
    await bothEndTheTurnWithACardOpen(ada, ben, city);
    scoutIsThere = (await viewOf(ada)).units.some((unit) => unit.owner === 'p1' && unit.type === 'scout');
  }
  check(scoutIsThere, 'Rome completed its Scout within twelve turns');
  const news = await toastTexts(ada);
  check(queueOf(await viewOf(ada), city.id).length === 0, 'the Scout has left the queue, which is empty now: the city does not build the same unit again');
  check(
    news.some((text) => text.includes('Rome has nothing left to build')),
    `the message about the Scout says that Rome has nothing left to build (on Ada's screen: ${news.join(' | ')})`,
  );
  check((await textOf(ada, TEST_IDS.endTurnButton)).includes('Rome has nothing to build'), 'the End Turn button names the city that builds nothing');
  await ada.keyboard.press('Escape');
  check(!(await ada.isVisible(byTestId(TEST_IDS.cityPanel))), 'Escape closed the city panel');
  await theMapBesideShowMeTakesATap(ada, city);
  await ada.click('.show-next');
  await waitUntilShown(ada, TEST_IDS.cityPanel);
  await waitForText(ada, TEST_IDS.cityName, city.name);
  const idleRome = ownCity(await viewOf(ada), city.id);
  check(
    (await textOf(ada, TEST_IDS.cityProduction)) === `${productionText(idleRome)} ${productionNoteText(idleRome)}`,
    `the panel says that Rome has nothing to build, and what becomes of its production: what is saved is kept, what it makes meanwhile is lost (${idleRome.productionStored} saved; it says "${await textOf(ada, TEST_IDS.cityProduction)}")`,
  );
  await ada.waitForTimeout(SELECTION_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.buildOption + 'warrior'));
  await waitForQueue(ada, city.id, ['warrior']);
  check(await onlyTurnNews(ben), `Ben was shown nothing about it (on his screen: ${(await toastTexts(ben)).join(' | ')})`);
}

/**
 * Steps 23 to 31: a Worker is built, walks to a tile of Ada's land and
 * builds what fits there. Which tile that is, and so whether it becomes a
 * farm or a mine, is up to the map; the numbers come from the tables.
 *
 * @param ada   the page of the player who owns `city`; a Scout may stand in it
 * @param ben   the page of the other player, who must learn nothing of it
 */
async function checkAWorkerImprovesTheLand(setup: TestSetup, crashes: string[], ada: any, ben: any, city: CityView): Promise<void> {
  step('23. Ada queues a Worker and puts it first');
  await ada.keyboard.press('Escape');
  await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  await ada.waitForTimeout(SELECTION_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.buildOption + 'worker'));
  await waitForQueue(ada, city.id, ['warrior', 'worker']);
  await ada.click(byTestId(TEST_IDS.queueUp + 1));
  await waitForQueue(ada, city.id, ['worker', 'warrior']);
  check((await textOf(ada, TEST_IDS.queueRow + 0)).includes(UNITS.worker.name), 'the first row of the queue is the Worker');

  step('24. The Worker is built');
  let built: UnitView | undefined;
  for (let turns = 0; turns < 15 && built === undefined; turns++) {
    await bothEndTheTurnWithACardOpen(ada, ben, city);
    built = (await viewOf(ada)).units.find((unit) => unit.owner === 'p1' && unit.type === 'worker');
  }
  check(
    cardLookMade,
    `in one of the turns of steps 22 and 24 ${city.name} grew onto a tile with nothing of Ada's on it, so that the look "a card left open across End Turn" was made (if not, nothing checks that a tile card is rewritten from a new view: end more turns here, or keep Ada's units off the city's best tiles)`,
  );
  if (built === undefined) {
    const rome = ownCity(await viewOf(ada), city.id);
    throw new Error(
      `Check failed: Rome completed its Worker within 15 turns (it makes ${rome.productionPerTurn} production a turn and has ${rome.productionStored} of ${UNITS.worker.cost})`,
    );
  }
  const worker = built;
  const workerNews = await toastTexts(ada);
  check(workerNews.some((text) => text.includes('Worker completed')), `a message says that the Worker is completed (on Ada's screen: ${workerNews.join(' | ')})`);

  step('25. In the city nothing can be built');
  check(worker.tile === city.tile, 'the new Worker stands in the city (if this fails, the city tile was taken: this step needs it there)');
  await ada.keyboard.press('Escape');
  await tapTileUntil(ada, worker.tile, TEST_IDS.unitName, UNITS.worker.name);
  const workerSelectedAt = Date.now();
  check(await ada.isVisible(byTestId(TEST_IDS.unitJobs)), 'the Worker\'s panel has the block with its jobs');
  for (const improvement of IMPROVEMENT_IDS) {
    check(
      (await ada.isVisible(byTestId(TEST_IDS.jobStart + improvement))) && (await ada.isDisabled(byTestId(TEST_IDS.jobStart + improvement))),
      `in the city the button for a ${IMPROVEMENTS[improvement].name} is there, greyed out`,
    );
  }
  check(
    (await ada.isVisible(byTestId(TEST_IDS.unitJobsReason))) && (await textOf(ada, TEST_IDS.unitJobsReason)) === RULE_ERROR_MESSAGES.cityOnTile,
    `one line says why for all of them (it says "${await textOf(ada, TEST_IDS.unitJobsReason)}")`,
  );
  check(
    !(await ada.isVisible(byTestId(TEST_IDS.unitJob))) && !(await ada.isVisible(byTestId(TEST_IDS.jobStop))),
    'a Worker without a job shows no progress and no "Stop work"',
  );

  step('26. The Worker walks to a tile it can improve');
  const land = await viewOf(ada);
  let site: TileIndex = -1;
  let job: ImprovementId = IMPROVEMENT_IDS[0];
  for (const tile of await reachableOf(ada, worker.id)) {
    const ground = land.tiles[tile];
    // A tile with nothing else of Ada's on it, so that one tap selects the Worker there (step 29).
    if (ground === null || ground.owner !== land.you || ground.improvement !== null || holdsOwnThing(land, tile)) continue;
    const fitting = IMPROVEMENT_IDS.find((improvement) => improvementFits(improvement, ground));
    if (fitting === undefined) continue;
    site = tile;
    job = fitting;
    break;
  }
  check(site !== -1, 'no tile to improve within one move of Rome: pick another seed');
  const other = IMPROVEMENT_IDS.find((improvement) => improvement !== job);
  if (other === undefined) throw new Error('Check failed: there is a second kind of improvement');
  await showHoverBox(ada, site);
  const before = linesOf(await shownTile(ada, HOVER_BOX), 'canBuild');
  check(
    before.some((line) => line.includes(IMPROVEMENTS[job].name)),
    `before the Worker walks, the hover box on the tile says that a ${IMPROVEMENTS[job].name} can be built there (it says "${before.join(' / ')}")`,
  );
  await tapTile(ada, site);
  await waitForView(ada, 'the Worker to walk to the tile', (now) => unitOf(now, worker.id).tile === site);

  step(`27. Ada starts the job: a ${IMPROVEMENTS[job].name}`);
  const startButton = byTestId(TEST_IDS.jobStart + job);
  const buttonWords = await textOf(ada, TEST_IDS.jobStart + job);
  check(await ada.isEnabled(startButton), `on a tile that fits, the button for a ${IMPROVEMENTS[job].name} can be pressed`);
  check(
    buttonWords.includes('Build') && buttonWords.includes(IMPROVEMENTS[job].name) && buttonWords.includes(String(IMPROVEMENTS[job].turns)),
    `the button says what it builds and how many turns that takes (it says "${buttonWords}")`,
  );
  check(await ada.isDisabled(byTestId(TEST_IDS.jobStart + other)), `the button for a ${IMPROVEMENTS[other].name} is greyed out`);
  check(
    (await ada.isVisible(byTestId(TEST_IDS.jobReason + other))) && (await textOf(ada, TEST_IDS.jobReason + other)) !== '',
    `and a line under it says why a ${IMPROVEMENTS[other].name} cannot be built here`,
  );

  // The job guard. A double-click starts the job and does not stop it
  // again; and "Stop work", which appears where the pointer is, does
  // nothing for the rest of the guard's 0.6 s.
  await waitUntilSince(ada, workerSelectedAt, SELECTION_PAUSE_MS);
  await ada.dblclick(startButton);
  await waitForView(ada, 'the Worker to have a job', (now) => unitOf(now, worker.id).own?.job != null);
  await ada.click(byTestId(TEST_IDS.jobStop));
  await ada.waitForTimeout(400); // the answer to "Stop work" would be here by now
  const atWork = await viewOf(ada);
  const started = unitOf(atWork, worker.id).own?.job ?? null;
  check(
    started !== null && started.improvement === job && started.turnsLeft === IMPROVEMENTS[job].turns,
    'a double-click on the job button, and a press of "Stop work" right after it, started the job and did not stop it again',
  );
  check((await textOf(ada, TEST_IDS.unitJob)).includes('Building a'), `the panel says what is being built (it says "${await textOf(ada, TEST_IDS.unitJob)}")`);
  check(await ada.isVisible(byTestId(TEST_IDS.jobStop)), '"Stop work" is there');
  for (const improvement of IMPROVEMENT_IDS) {
    check(!(await ada.isVisible(byTestId(TEST_IDS.jobStart + improvement))), `the button for a ${IMPROVEMENTS[improvement].name} is gone while the Worker is at work`);
  }
  check((await reachableOf(ada, worker.id)).length === 0, 'a Worker at work cannot be sent anywhere');
  const endTurnWords = await textOf(ada, TEST_IDS.endTurnButton);
  for (const sentence of todoHints(atWork)) {
    check(endTurnWords.includes(sentence), `the End Turn button says "${sentence}" (it says "${endTurnWords}")`);
  }
  check(!idleUnits(atWork).some((unit) => unit.id === worker.id), 'the Worker at work is not counted among the units that can still move');

  step('28. Stop and start again');
  await ada.waitForTimeout(GUARD_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.jobStop));
  await waitForView(ada, 'the Worker to have stopped its work', (now) => unitOf(now, worker.id).own?.job === null);
  check((await ada.isVisible(startButton)) && (await ada.isEnabled(startButton)), 'after "Stop work" the job button is back and can be pressed');
  const stoppedAt = Date.now();
  await unitPanelPrintsItsButtons(ada, worker.id, 'the Worker without a job');
  // While Ada has ended her turn, the job buttons are greyed out and the first line of their block says why.
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'true');
  const endedAt = Date.now();
  const idle = await unitPanelPrintsItsButtons(ada, worker.id, 'the Worker without a job, after End Turn');
  check(
    idle.jobs !== null && idle.jobs.start.length === IMPROVEMENT_IDS.length && idle.jobs.start.every((button) => button.disabled),
    'after End Turn every job button is greyed out, the one that could be pressed a moment ago too',
  );
  check(
    idle.jobs?.closed === ordersClosedText('turnEnded') && (await isInSight(ada, TEST_IDS.unitJobsClosed)),
    `the first line of the job block says why (it says "${idle.jobs?.closed}")`,
  );
  check(
    (await boxOf(ada, byTestId(TEST_IDS.unitJobsClosed))).bottom <= (await boxOf(ada, byTestId(TEST_IDS.jobStart + IMPROVEMENT_IDS[0]))).top + 0.5,
    'that line stands above the buttons it is about, so that it is read first and is the last thing to scroll away',
  );
  check(
    (await textOf(ada, TEST_IDS.unitPanel)).split(ordersClosedText('turnEnded')).length === 2,
    'and the panel says it once, not a second time at its bottom',
  );
  // The same moment on Ada's phone, held on its side: the sentence takes two
  // lines there, in a panel 220 pixels tall, and both greyed job buttons
  // must still be in view under it. (The second one used to be cut.)
  const phone = await openSecondDevice(setup.browser, 'Ada\'s phone', crashes, ada, LOW_WINDOW, true);
  check(
    await phone.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    'the page takes the second browser for one with a touch screen (if not, this checks nothing: start it with a touch screen another way)',
  );
  await fingerTileUntil(phone, site, TEST_IDS.unitName, UNITS.worker.name);
  await settled(phone);
  const lowScrolledBy: number = await phone.evaluate((selector: string) => document.querySelector(selector).scrollTop, byTestId(TEST_IDS.unitPanel));
  const jobButtonsInSight: boolean[] = [];
  for (const improvement of IMPROVEMENT_IDS) jobButtonsInSight.push(await isInSight(phone, TEST_IDS.jobStart + improvement));
  check(
    lowScrolledBy === 0 && jobButtonsInSight.every((inSight) => inSight) && (await isInSight(phone, TEST_IDS.unitJobsClosed)),
    `with a phone on its side, after End Turn: every greyed job button and the sentence that says why are in view without scrolling the panel (in view: ${IMPROVEMENT_IDS.map((improvement, index) => `${improvement} ${jobButtonsInSight[index]}`).join(', ')}; scrolled by ${lowScrolledBy})`,
  );
  await phone.setViewportSize(PHONE);
  await settled(phone);
  await waitUntilSince(ada, endedAt, END_TURN_PAUSE_MS);
  await ada.click(byTestId(TEST_IDS.endTurnButton));
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'false');
  check(await ada.isEnabled(startButton), 'with the turn taken back, the job button can be pressed again');
  await waitUntilSince(ada, stoppedAt, GUARD_PAUSE_MS);
  await ada.click(startButton);
  await waitForView(ada, 'the Worker to have its job again', (now) => unitOf(now, worker.id).own?.job?.improvement === job);

  step('28a. A double-click on the Worker, where its own "Stop work" comes up, does not stop its work; nor does a double tap on a phone');
  await doublePressOnTheWorker(ada, false, site, worker.id);
  // The same with a finger: Ada's phone (opened in step 28), held upright.
  // The deck with the Worker's panel comes up where the lower part of the map was.
  await fingerTileUntil(phone, site, TEST_IDS.unitName, UNITS.worker.name);
  await doublePressOnTheWorker(phone, true, site, worker.id);
  await checkThePanelsWhileTheTurnIsEnded(ada, phone, city, worker.id);
  await checkTheStripAboveEndTurn(setup, crashes, ada, city);
  await phone.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await checkADoublePressAtTheEdge(ada, phone);
  await phone.context().close();

  step('29. In a low window "Stop work" is in view, and the Worker is not under its own panel');
  await ada.keyboard.press('Escape');
  await ada.setViewportSize(LOW_WINDOW);
  await settled(ada); // as in step 18
  const under = await bringTileNear(ada, site, PANEL_CORNER);
  check(
    isNear(under, PANEL_CORNER),
    `the tile did not arrive in the bottom-left corner (the camera stops at the map's edge): pick another tile for this step (it is at ${at(under)})`,
  );
  await ada.mouse.click(under.x, under.y);
  await waitUntilShown(ada, TEST_IDS.unitPanel);
  await waitForText(ada, TEST_IDS.unitName, UNITS.worker.name);
  const lowPanel = await boxOf(ada, byTestId(TEST_IDS.unitPanel));
  check(lowPanel.top >= (await boxOf(ada, '.top-bar')).bottom, 'in a low window the unit panel starts below the top bar');
  check(lowPanel.bottom <= LOW_WINDOW.height, `the unit panel ends on the screen (at ${lowPanel.bottom} of ${LOW_WINDOW.height})`);
  check(lowPanel.height <= 220, `the unit panel is at most 220 pixels tall (it is ${lowPanel.height})`);
  const panelScrolledBy: number = await ada.evaluate((selector: string) => document.querySelector(selector).scrollTop, byTestId(TEST_IDS.unitPanel));
  check(
    panelScrolledBy === 0 && isInside(await boxOf(ada, byTestId(TEST_IDS.jobStop)), lowPanel),
    '"Stop work" is in view without scrolling the panel',
  );
  check(!(await ada.isVisible(byTestId(TEST_IDS.unitDescription))), 'the unit\'s description is left out in a low window');
  check(holds(lowPanel, under), `the panel opened on top of the Worker (if not, the next check checks nothing: move the corner; the Worker was at ${at(under)})`);
  check(await comesOutFromUnder(ada, site, byTestId(TEST_IDS.unitPanel)), 'within a second the map has stepped aside, and the Worker is no longer under its own panel');
  await ada.keyboard.press('Escape');
  await ada.setViewportSize(LAPTOP);

  step('30. Ben learns nothing');
  const benView = await viewOf(ben);
  check(benView.units.every((unit) => unit.owner === 'p2'), 'every unit in Ben\'s view is his own');
  check(!JSON.stringify(benView).includes(worker.id), 'the Worker\'s id appears nowhere in what Ben was sent');
  check(benView.tiles.every((tile) => tile === null || tile.improvement === null), 'no tile Ben knows has anything built on it');
  check(await onlyTurnNews(ben), `Ben was shown nothing about it (on his screen: ${(await toastTexts(ben)).join(' | ')})`);

  step('31. The improvement is finished, and is still there after a reload');
  // One turn first. When the job began, the Worker may have used up its
  // moves on the way, and a unit without moves is passed by anyway. Now it
  // has its moves back and is still at work: it must still be passed by.
  let turn = await bothEndTheTurn(ada, ben);
  const turnLater = await viewOf(ada);
  const working = unitOf(turnLater, worker.id).own;
  check(
    working !== null && working.movesLeft === UNITS.worker.moves && working.job?.turnsLeft === IMPROVEMENTS[job].turns - 1,
    'a turn later the Worker has its moves back, is still at work, and has one turn less to go',
  );
  check((await reachableOf(ada, worker.id)).length === 0, 'with all its moves a Worker at work still cannot be sent anywhere');
  check(!idleUnits(turnLater).some((unit) => unit.id === worker.id), 'and it is still not counted among the units that can still move');
  await tapTileUntil(ada, site, TEST_IDS.unitName, UNITS.worker.name);
  const jobBar = await barFraction(ada, `${byTestId(TEST_IDS.unitPanel)} .bar-fill`);
  check(
    working?.job != null && working.job.turnsWorked > 0 && barShows(jobBar, working.job.turnsWorked, working.job.turnsTotal),
    `the bar of the job is as long as the work done, ${working?.job?.turnsWorked} of ${working?.job?.turnsTotal} turns (it is at ${percent(jobBar)})`,
  );
  await ada.keyboard.press('Escape');
  const hintLater = await textOf(ada, TEST_IDS.endTurnButton);
  for (const sentence of todoHints(turnLater)) {
    check(hintLater.includes(sentence), `the End Turn button says "${sentence}" (it says "${hintLater}")`);
  }
  for (let turns = 1; turns < IMPROVEMENTS[job].turns; turns++) turn = await bothEndTheTurn(ada, ben);
  const finishedNews = await toastTexts(ada);
  check(
    finishedNews.some((text) => text.includes('finished a') && text.includes(`near ${city.name}`)),
    `a message says that the Worker finished its work near Rome (on Ada's screen: ${finishedNews.join(' | ')})`,
  );
  const finished = await viewOf(ada);
  const rested = unitOf(finished, worker.id);
  check(finished.tiles[site]?.improvement === job, `the tile has its ${IMPROVEMENTS[job].name}`);
  check(rested.own?.job === null && rested.own.movesLeft === UNITS.worker.moves, 'the Worker has no job any more, and all its moves');
  await ada.keyboard.press('Escape');
  await tapTileUntil(ada, site, TEST_IDS.unitName, UNITS.worker.name);
  check(
    (await ada.isVisible(byTestId(TEST_IDS.jobReason + job))) && (await textOf(ada, TEST_IDS.jobReason + job)).includes(`already has a ${IMPROVEMENTS[job].name}`),
    `the Worker's panel says that the tile already has a ${IMPROVEMENTS[job].name} (it says "${await textOf(ada, TEST_IDS.jobReason + job)}")`,
  );
  check((await textOf(ada, TEST_IDS.unitTile)).includes(IMPROVEMENTS[job].name), `the line about the tile names the ${IMPROVEMENTS[job].name} (it says "${await textOf(ada, TEST_IDS.unitTile)}")`);
  await showHoverBox(ada, site);
  const improved = await shownTile(ada, HOVER_BOX);
  const improvedWords = describeTile(await viewOf(ada), site);
  check(
    linesOf(improved, 'improvement').some((line) => line.includes(IMPROVEMENTS[job].name)),
    `the hover box on the tile names the ${IMPROVEMENTS[job].name} (it says "${wordsOf(improved)}")`,
  );
  check(
    saysTheSame(improved, improvedWords),
    `and prints what describeTile says, so also whether a citizen works the tile (the box: "${wordsOf(improved)}"; describeTile: "${wordsOf(improvedWords)}")`,
  );
  await ada.reload();
  await waitForTurn(ada, turn);
  check((await viewOf(ada)).tiles[site]?.improvement === job, `after a reload the ${IMPROVEMENTS[job].name} is still there`);
  const benTile = (await viewOf(ben)).tiles[site];
  check(benTile === null || benTile.improvement === null, 'Ben\'s view of the tile shows nothing built on it');
  check(await onlyTurnNews(ben), `Ben was shown nothing about it (on his screen: ${(await toastTexts(ben)).join(' | ')})`);
}

// ---------------------------------------------------------------------------
// Looks that came with the repair after the review of round 2: the hover box
// beside a panel (step 18), the phone turned (step 21), a tap on the news of
// a turn (step 21b). (Two more are with the helpers further up:
// timeToHoverBox for step 17, bothEndTheTurnWithACardOpen for steps 22 and 24.)
// ---------------------------------------------------------------------------

/**
 * A look in step 18: the hover box of a tile right above an open panel.
 * Right of its tile, where the box goes when nothing is in the way, it
 * would lie on the panel; it must find another place beside its tile.
 *
 * @param page     the panel with this test id is open, bottom left, and
 *                 leaves room above it (the tile card does; a city panel
 *                 with a queue is as tall as the map)
 * @param tile     a tile the player has seen, and not the one the panel is about
 */
async function theHoverBoxKeepsOffThePanel(page: any, tile: TileIndex, panelId: string): Promise<void> {
  const panel = await boxOf(page, byTestId(panelId));
  // The tile is brought to just above the panel's top edge, over the panel's middle.
  const zoomedIn = await bringTileTo(page, tile, { x: (panel.left + panel.right) / 2, y: panel.top - 46 });
  const view = await viewOf(page);
  // A box comes only for a mouse that has MOVED onto its tile: the mouse comes from the neighbor that lies highest, well clear of the panel.
  const around: { tile: TileIndex; point: Point }[] = [];
  for (const neighbor of neighbors(tile, view)) around.push({ tile: neighbor, point: await screenOf(page, neighbor) });
  const from = around.reduce((highest, candidate) => (candidate.point.y < highest.point.y ? candidate : highest));
  const onTile = await screenOf(page, tile);
  await page.mouse.move(from.point.x, from.point.y);
  await page.mouse.move(onTile.x, onTile.y);
  await waitForHoverBox(page, tile);

  const box = await boxOf(page, byTestId(TEST_IDS.hoverBox));
  const tileRect = await tileRectOf(page, tile);
  const rightOfTile = {
    left: tileRect.right + HOVER_BOX_GAP,
    top: tileRect.top,
    right: tileRect.right + HOVER_BOX_GAP + box.width,
    bottom: tileRect.top + box.height,
  };
  check(
    overlap(rightOfTile, panel),
    `right of its tile, its first choice, the hover box would lie on the panel (the box is ${Math.round(box.height)} pixels tall and the tile's top is ${Math.round(panel.top - tileRect.top)} above the panel; if not, this look checks nothing: bring the tile lower)`,
  );
  check(
    !overlap(box, panel),
    `the hover box of a tile next to an open panel does not lie on the panel (the box reaches from ${at({ x: box.left, y: box.top })} to ${at({ x: box.right, y: box.bottom })}, the panel begins at ${at({ x: panel.left, y: panel.top })})`,
  );
  check(!overlap(box, tileRect), 'and it lies beside its tile, not on it');
  await zoomBackOut(page, zoomedIn);
}

/**
 * A look at the end of step 21: the phone is turned. Eve's city is
 * selected with the phone on its side, where it stands in the middle of a
 * map 844 pixels wide. Held upright the map is 390 wide: the city used to
 * be left beyond its right edge, with its panel still open.
 *
 * @param eve   a touch screen on its side (844 x 390) with a tile card open; left upright, with nothing selected
 */
async function turningThePhoneKeepsTheCityOnTheMap(eve: any, city: CityView): Promise<void> {
  await eve.tap(byTestId(TEST_IDS.tileCardClose));
  await fingerTileUntil(eve, city.tile, TEST_IDS.cityName, city.name);
  await settled(eve); // the map steps aside if the panel that has just opened lies on the city
  const onItsSide = await screenOf(eve, city.tile);
  check(
    onItsSide.x > PHONE.width,
    `with the phone on its side the selected city stands at x ${Math.round(onItsSide.x)}, beyond where the upright screen ends (if not, turning the phone moves nothing and this look checks nothing)`,
  );

  await eve.setViewportSize(PHONE);
  // The map steps aside a frame or two after the window has changed its size.
  let cameBack = true;
  try {
    await eve.waitForFunction(
      ([tile, selector]: [number, string]) => {
        const rect = window.__domination.tileScreenRect(tile);
        const map = document.querySelector(selector).getBoundingClientRect();
        return rect.left >= map.left && rect.right <= map.right && rect.top >= map.top && rect.bottom <= map.bottom;
      },
      [city.tile, byTestId(TEST_IDS.gameCanvas)],
      { timeout: 2000 },
    );
  } catch {
    cameBack = false;
  }
  const rect = await tileRectOf(eve, city.tile);
  const map = await boxOf(eve, byTestId(TEST_IDS.gameCanvas));
  check(
    cameBack,
    `with the phone turned upright the selected city's tile lies inside the map (the tile reaches from ${at({ x: rect.left, y: rect.top })} to ${at({ x: rect.right, y: rect.bottom })}, the map from ${at({ x: map.left, y: map.top })} to ${at({ x: map.right, y: map.bottom })})`,
  );
  check(await eve.isVisible(byTestId(TEST_IDS.cityPanel)), 'and the city\'s panel is still open');
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
}

/**
 * A look at the end of step 21b: the news of a turn does not swallow a tap.
 * On a phone the messages lie on the upper middle of a small map. A tile is
 * brought to where "Turn N has begun." will lie; Eve ends her turn (she
 * plays alone, so the next turn begins at once) and taps the message: the
 * tap goes through to the tile under it.
 *
 * @param eve   a phone held upright (a touch screen); the panel of `city` is open
 */
async function aTapGoesThroughTheNews(eve: any, city: CityView): Promise<void> {
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  const view = await viewOf(eve);
  const tile = neighbors(city.tile, view).find((candidate) => view.tiles[candidate] !== null && !holdsOwnThing(view, candidate));
  if (tile === undefined) throw new Error('Check failed: a tile next to Eve\'s city holds nothing of hers');
  // The messages begin 12 pixels under the top bar, in the middle of the screen; one is about 40 pixels tall.
  const spot: Point = { x: PHONE.width / 2, y: (await boxOf(eve, '.top-bar')).bottom + 32 };
  const zoomedIn = await bringTileTo(eve, tile, spot);

  await eve.tap(byTestId(TEST_IDS.endTurnButton));
  await waitForTurn(eve, view.turn + 1);
  // One look by the page itself, so that no message can come or go between its two halves.
  const under: { messages: number; map: boolean } = await eve.evaluate(
    ([x, y, toast, canvas]: [number, number, string, string]) => {
      const onTop = document.elementFromPoint(x, y);
      return {
        messages: [...document.querySelectorAll(toast)].filter((message: any) => {
          const box = message.getBoundingClientRect();
          return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
        }).length,
        map: onTop !== null && onTop.matches(canvas),
      };
    },
    [spot.x, spot.y, byTestId(TEST_IDS.toast), byTestId(TEST_IDS.gameCanvas)],
  );
  check(under.messages > 0, `the news of the new turn lies on the spot at ${at(spot)} (if not, this look checks nothing: move the spot)`);
  check(under.map, 'on a phone a press on the news of a turn goes through to the map under it');
  await eve.touchscreen.tap(spot.x, spot.y);
  await waitUntilShown(eve, TEST_IDS.tileCard);
  check((await shownTile(eve, TILE_CARD)).tile === tile, 'right after a turn began, a tap on a tile that lies under the news opens that tile\'s card');
  await zoomBackOut(eve, zoomedIn);
}

// ---------------------------------------------------------------------------
// What the panels grey out and say (steps 21b and 28b, and looks in steps
// 22 and 33)
// ---------------------------------------------------------------------------

/**
 * Step 21b: a full queue under a finger. Every add button is greyed out,
 * and the sentence that says why is in sight wherever the panel is
 * scrolled; on the narrowest phone no line of the panel is cut.
 *
 * @param eve   the phone of step 21a, held upright; the panel of `city` is open and its queue is empty
 */
async function checkAFullQueueSaysSo(eve: any, city: CityView): Promise<void> {
  step('21b. On the phone, a queue of eight: every add button is grey and "The build queue is full." stays in sight; on a small phone no line of the panel is cut');
  await eve.waitForTimeout(GUARD_PAUSE_MS - 400); // the add buttons keep quiet for 0.6 s after a removal, and 0.4 s of that are over
  const eight: UnitTypeId[] = ['warrior', 'scout', 'worker', 'settler', 'warrior', 'scout', 'worker', 'settler'];
  for (let count = 1; count <= eight.length; count++) {
    await eve.tap(byTestId(TEST_IDS.buildOption + eight[count - 1]));
    await waitForQueue(eve, city.id, eight.slice(0, count));
  }
  const where = 'on the phone, with a full queue';
  const full = await cityPanelPrintsItsButtons(eve, city.id, where);
  check(full.adds.length === 4 && full.adds.every((add) => add.disabled), `${where}: every add button is greyed out`);
  check(full.note === RULE_ERROR_MESSAGES.queueFull, `${where}: the head of the panel says "${RULE_ERROR_MESSAGES.queueFull}" (it says "${full.note}")`);
  check((await textOf(eve, TEST_IDS.queueCount)) === 'Queue 8 of 8', `${where}: the head counts eight of eight`);
  check(
    full.rows.length === 8 && !full.rows[3].upDisabled && !full.rows[3].downDisabled && !full.rows[3].removeDisabled && full.clearDisabled === false,
    `${where}: the rows and "Empty the queue" can still be pressed`,
  );

  // The last add button is brought into view: the queue is then scrolled
  // away, and the sentence must still be there, with the grey buttons.
  const lastAdd = TEST_IDS.buildOption + full.adds[full.adds.length - 1].unitType;
  await pointOf(eve, lastAdd);
  check(
    (await isInSight(eve, lastAdd)) && !(await isInSight(eve, TEST_IDS.queueRow + 0)),
    `${where}: a greyed add button is in view and the queue is scrolled away (if not, the next check checks nothing: make the window lower)`,
  );
  check(await isInSight(eve, TEST_IDS.queueNote), `${where}: while a greyed add button is in view, the sentence that says why is in view`);

  // The narrowest phone: the line about the x is one line, and nothing is cut.
  await eve.setViewportSize(SMALL_PHONE);
  await settled(eve);
  const small = await eve.evaluate(
    ([panelSelector, hintSelector]: string[]) => {
      const panel = document.querySelector(panelSelector);
      const frame = panel.getBoundingClientRect();
      const hint = document.querySelector(hintSelector);
      const cut: string[] = [];
      for (const line of panel.querySelectorAll('.queue-name, .queue-when, .queue-hint, .build-name, .build-detail, .build-about, .panel-reason, .panel-stat')) {
        if (line.getClientRects().length === 0) continue;
        const box = line.getBoundingClientRect();
        if (line.scrollWidth > line.clientWidth + 1 || box.left < frame.left - 0.5 || box.right > frame.right + 0.5) cut.push(`"${line.textContent}"`);
      }
      return { cut, hintHeight: hint.getBoundingClientRect().height, lineHeight: parseFloat(window.getComputedStyle(hint).lineHeight), hint: hint.textContent };
    },
    [byTestId(TEST_IDS.cityPanel), byTestId(TEST_IDS.queueHint)],
  );
  check(small.hint === REMOVE_HINT, `the line under the queue's title says what the x does (it says "${small.hint}")`);
  check(
    small.hintHeight > 0 && small.hintHeight < small.lineHeight * 1.5,
    `on a phone 360 pixels wide that line is one line (it is ${small.hintHeight} pixels tall; a line is ${small.lineHeight})`,
  );
  check(small.cut.length === 0, `on a phone 360 pixels wide no line of the city panel is cut or sticks out of it (cut: ${small.cut.join(', ')})`);
  await eve.setViewportSize(PHONE);
}

/**
 * A look in step 22: the map beside "Show me" is map. The box around "Show
 * me" and End Turn is as wide as End Turn, and it used to take every press
 * for itself: a strip of the map, two thirds of that width, answered no tap.
 *
 * @param page  nothing is selected, and "Show me" is on the screen
 */
async function theMapBesideShowMeTakesATap(page: any, city: CityView, finger = false): Promise<void> {
  const show = await boxOf(page, '.show-next');
  const endTurn = await boxOf(page, byTestId(TEST_IDS.endTurnButton));
  const beside: Point = { x: endTurn.left + 24, y: (show.top + show.bottom) / 2 };
  check(
    beside.x < show.left - 24,
    `"Show me" is narrower than End Turn, so there is map beside it (it begins at ${show.left}, End Turn at ${endTurn.left}; if not, this look checks nothing)`,
  );
  const view = await viewOf(page);
  const tile = neighbors(city.tile, view).find((candidate) => view.tiles[candidate] !== null && !holdsOwnThing(view, candidate));
  if (tile === undefined) throw new Error('Check failed: a tile next to the city holds nothing of the player\'s');
  const zoomedIn = await bringTileTo(page, tile, beside);
  const onTop = await onTopAt(page, beside);
  check(onTop === 'map', `the map is on top beside "Show me", at ${at(beside)} (on top there: "${onTop}")`);
  await pressAt(page, beside, finger);
  await waitUntilShown(page, TEST_IDS.tileCard);
  check((await shownTile(page, TILE_CARD)).tile === tile, 'a tap on the map beside "Show me" opens the card of the tile that lies there');
  await zoomBackOut(page, zoomedIn);
}

/**
 * Step 28b: what the two panels grey out and say while the player has ended
 * the turn and the other player has not. On the phone the sentence that
 * says why must be in sight together with the greyed buttons.
 *
 * @param ada    Ada's laptop page; the Worker at work is selected
 * @param phone  Ada's phone, held upright (a touch screen); the Worker at work is selected
 */
async function checkThePanelsWhileTheTurnIsEnded(ada: any, phone: any, city: CityView, workerId: UnitId): Promise<void> {
  step('28b. While Ada has ended her turn: "Stop work" and every button of the queue are grey, the sentence that says why is in sight with them, and the bars are as long as the numbers say');
  const why = ordersClosedText('turnEnded');
  await phone.tap(byTestId(TEST_IDS.endTurnButton));
  for (const page of [phone, ada]) await waitForAttribute(page, TEST_IDS.endTurnButton, 'data-ended', 'true');
  const endedAt = Date.now();

  // The Worker at work, on both of Ada's screens.
  for (const [page, where] of [[phone, 'on the phone'], [ada, 'on the laptop']] as const) {
    const unit = await unitPanelPrintsItsButtons(page, workerId, `${where}, the Worker at work after End Turn`);
    check(unit.jobs?.stop?.disabled === true, `${where}: after End Turn "Stop work" is greyed out`);
    check(
      unit.jobs?.stop?.warning === null && !(await page.isVisible(byTestId(TEST_IDS.jobStopWarning))),
      `${where}: beside a "Stop work" that cannot be pressed nothing speaks of lost work`,
    );
    check(unit.jobs?.closed === why, `${where}: the first line of the job block says why (it says "${unit.jobs?.closed}")`);
    check(
      (await boxOf(page, byTestId(TEST_IDS.unitJobsClosed))).bottom <= (await boxOf(page, byTestId(TEST_IDS.unitJob))).top + 0.5,
      `${where}: that line stands above the work and its "Stop work"`,
    );
    check(
      (await isInSight(page, TEST_IDS.jobStop)) && (await isInSight(page, TEST_IDS.unitJobsClosed)),
      `${where}: while the greyed "Stop work" is in view, the sentence that says why is in view`,
    );
  }
  // The phone on its side: the panel is low there, and the hint at its bottom, where the sentence used to be, is out of sight.
  await phone.setViewportSize(LOW_WINDOW);
  await settled(phone);
  check(
    (await isInSight(phone, TEST_IDS.jobStop)) && (await isInSight(phone, TEST_IDS.unitJobsClosed)),
    'with the phone on its side: while the greyed "Stop work" is in view, the sentence that says why is in view',
  );
  await phone.setViewportSize(PHONE);
  await settled(phone);

  // The city, on the phone.
  await phone.tap(`${byTestId(TEST_IDS.unitPanel)} .panel-close`);
  await fingerTileUntil(phone, city.tile, TEST_IDS.cityName, city.name);
  const where = 'on the phone, after End Turn';
  const queue = await cityPanelPrintsItsButtons(phone, city.id, where);
  check(
    queue.rows.length > 0 && queue.rows.every((row) => row.upDisabled && row.downDisabled && row.removeDisabled) && queue.clearDisabled === true,
    `${where}: every button of the queue's rows and "Empty the queue" are greyed out (the queue has ${queue.rows.length} entries; it needs one for this check)`,
  );
  check(queue.adds.length === 4 && queue.adds.every((add) => add.disabled), `${where}: every add button is greyed out`);
  check(queue.note !== null && queue.note.includes('ended your turn'), `${where}: the head of the panel says why (it says "${queue.note}")`);
  const lastAdd = TEST_IDS.buildOption + queue.adds[queue.adds.length - 1].unitType;
  await pointOf(phone, lastAdd);
  check(
    (await isInSight(phone, lastAdd)) && !(await isInSight(phone, TEST_IDS.queueRow + 0)),
    `${where}: a greyed add button is in view and the queue is scrolled away (if not, the next check checks nothing: make the window lower)`,
  );
  check(await isInSight(phone, TEST_IDS.queueNote), `${where}: while a greyed add button is in view, the sentence that says why is in view`);

  // The two bars of the city against the numbers of the view.
  const rome = ownCity(await viewOf(phone), city.id);
  const foodBar = await barFraction(phone, `${byTestId(TEST_IDS.cityPanel)} .bar-fill.food`);
  const productionBar = await barFraction(phone, `${byTestId(TEST_IDS.cityPanel)} .bar-fill.production`);
  check(
    barShows(foodBar, rome.foodStored, rome.foodToGrow),
    `the food bar is as long as the food stored, ${rome.foodStored} of ${rome.foodToGrow} (it is at ${percent(foodBar)})`,
  );
  const cost = rome.buildQueue[0]?.cost ?? null;
  check(
    barShows(productionBar, rome.productionStored, cost),
    `the production bar is as long as the production stored, ${rome.productionStored} of ${cost} (it is at ${percent(productionBar)})`,
  );

  await waitUntilSince(phone, endedAt, END_TURN_PAUSE_MS);
  await phone.tap(byTestId(TEST_IDS.endTurnButton));
  for (const page of [phone, ada]) await waitForAttribute(page, TEST_IDS.endTurnButton, 'data-ended', 'false');
}

/**
 * A look at the end of step 28b: the ten pixels between "Show me" and End
 * Turn. A finger that came down there, a few pixels above End Turn, was
 * handed to the nearest button by the browser, and the turn was ended. The
 * strip takes the press now and does nothing; the map beside "Show me",
 * above the strip, still takes taps.
 *
 * A phone aims a finger's tap at the nearest thing that can be pressed. The
 * browser of this test does that only when it is told to behave as a phone
 * in every way, so this look opens a device of its own: Ada's phone held on
 * its side.
 *
 * @param ada   Ada's laptop page; the turn is not ended, and a unit of hers can still move
 */
async function checkTheStripAboveEndTurn(setup: TestSetup, crashes: string[], ada: any, city: CityView): Promise<void> {
  const phone = await openSecondDevice(setup.browser, 'Ada\'s phone on its side', crashes, ada, LOW_WINDOW, true, ada.url(), null, true);
  await settled(phone);
  // End Turn ignores presses for 0.6 s after the page's first view came in
  // (its meaning changed then). A tap inside that time would not end the
  // turn wherever it landed, and this look would check nothing.
  await phone.waitForTimeout(END_TURN_PAUSE_MS);
  check(
    (await phone.isVisible('.show-next')) && !(await hasEndedTurn(phone)),
    'with the phone on its side "Show me" stands above End Turn, and the turn is not ended (if not, this look checks nothing: it needs a unit that can still move)',
  );
  const endTurn = await boxOf(phone, byTestId(TEST_IDS.endTurnButton));
  const above: Point = { x: endTurn.left + 40, y: endTurn.top - 3 };
  const onTop: string = await phone.evaluate(([x, y]: number[]) => document.elementFromPoint(x, y)?.className ?? '', [above.x, above.y]);
  check(onTop === 'end-turn-gap', `3 pixels above End Turn lies the strip between the two buttons, not the map (on top at ${at(above)}: "${onTop}")`);
  await phone.touchscreen.tap(above.x, above.y);
  await phone.waitForTimeout(400); // the answer to End Turn would be here by now
  check(!(await hasEndedTurn(phone)), 'with a phone on its side, a tap 3 pixels above End Turn does not end the turn');
  check(
    !(await phone.isVisible(byTestId(TEST_IDS.tileCard))) && !(await phone.isVisible(byTestId(TEST_IDS.unitPanel))) && !(await phone.isVisible(byTestId(TEST_IDS.cityPanel))),
    'and it does nothing else either: no card and no panel opens',
  );
  await theMapBesideShowMeTakesATap(phone, city, true);
  await phone.context().close();
}

/**
 * Step 28c for one page: a unit is brought to a side edge of the map, its
 * middle about 10 pixels from the edge, and one spot on it is pressed
 * twice. The first press selects the unit, and the map steps aside to bring
 * it into the open; the second press then lies on the tile BESIDE the unit
 * (east of it at the right edge, west of it at the left edge), which it
 * could walk to. That press must do nothing at all.
 *
 * @param thenSend  true: press the spot a third time, 0.7 s after the map
 *                  stepped aside: that one is an order, and the unit walks
 */
async function pressTwiceAtTheEdge(page: any, finger: boolean, thenSend: boolean): Promise<void> {
  const how = finger ? 'double tap' : 'double-click';
  const view = await viewOf(page);
  // A unit that stands alone outside every city and can walk to the empty tile east or west of it.
  let found: { unit: UnitView; beside: TileIndex; edge: 'right' | 'left' } | null = null;
  for (const candidate of view.units) {
    if (found !== null || candidate.owner !== view.you || candidate.own === null || candidate.own.movesLeft === 0 || candidate.own.job !== null) continue;
    if (view.cities.some((city) => city.tile === candidate.tile) || view.units.some((other) => other.id !== candidate.id && other.tile === candidate.tile)) continue;
    const reach = await reachableOf(page, candidate.id);
    for (const edge of ['right', 'left'] as const) {
      const beside = edge === 'right' ? candidate.tile + 1 : candidate.tile - 1;
      const empty = !view.units.some((other) => other.tile === beside) && !view.cities.some((city) => city.tile === beside);
      if (found === null && empty && neighbors(candidate.tile, view).includes(beside) && reach.includes(beside)) found = { unit: candidate, beside, edge };
    }
  }
  if (found === null) {
    throw new Error(
      'Check failed: one of the player\'s units stands alone, outside every city, and can walk to the empty tile east or west of it ' +
        '(if not, step 28c checks nothing: let a unit walk somewhere first, or pick another seed)',
    );
  }
  const { unit, beside, edge } = found;
  const canvas = await boxOf(page, byTestId(TEST_IDS.gameCanvas));
  const y = canvas.top + 150;
  const zoomedIn = await bringTileTo(page, unit.tile, { x: edge === 'right' ? canvas.right - 10 : canvas.left + 10, y });
  const spot: Point = { x: edge === 'right' ? canvas.right - 2 : canvas.left + 2, y };
  check((await onTopAt(page, spot)) === 'map', `the map is on top at its ${edge} edge, at ${at(spot)}`);
  const before = await screenOf(page, unit.tile);

  const pressedAt = Date.now();
  await pressAt(page, spot, finger);
  await settled(page); // the map steps aside a frame or two after the selection
  const steppedAt = Date.now();
  // The guard runs for half a second from the moment the map moved. A computer too busy to press again in time skips the second press.
  const inTime = steppedAt - pressedAt < 400;
  if (inTime) await pressAt(page, spot, finger);
  await page.waitForTimeout(400); // the answer to an order would be here by now
  const stepped = await screenOf(page, unit.tile);
  const besideAt = await screenOf(page, beside);
  const after = unitOf(await viewOf(page), unit.id);
  check(
    after.tile === unit.tile && after.own?.movesLeft === unit.own?.movesLeft,
    `a ${how} on a unit at the edge of the map did not send it to the tile beside it (it stood on tile ${unit.tile}, it stands on ${after.tile})`,
  );
  check(
    Math.abs(before.x - stepped.x) > 20 && Math.hypot(spot.x - besideAt.x, spot.y - besideAt.y) < Math.hypot(spot.x - stepped.x, spot.y - stepped.y),
    `after the first press the map had stepped aside, and the tile beside the unit lay under the pointer (the unit's middle was at x ${Math.round(before.x)}, it is at ${Math.round(stepped.x)}; the tile beside it at ${at(besideAt)}; the pointer at ${at(spot)}; if not, the ${how} checks nothing)`,
  );
  check(
    (await page.isVisible(byTestId(TEST_IDS.unitPanel))) && (await textOf(page, TEST_IDS.unitName)) === UNITS[unit.type].name && !(await page.isVisible(byTestId(TEST_IDS.tileCard))),
    `after the ${how} the unit is still selected: the second press did nothing at all`,
  );

  if (thenSend) {
    await waitUntilSince(page, steppedAt, 700);
    await pressAt(page, spot, finger);
    try {
      await waitForView(page, 'the unit to walk to the tile beside it', (now) => unitOf(now, unit.id).tile === beside);
    } catch (error) {
      throw new Error(`Check failed: a press on the tile beside the unit 0.7 s after the map stepped aside is an order, and the unit walks. ${String(error)}`);
    }
  }
  await zoomBackOut(page, zoomedIn);
}

/**
 * Step 28c: a double press on a unit at the edge of the map. When the map
 * moves by itself, another tile lies under the pointer; for half a second
 * after that a press on the map gives no order.
 *
 * @param ada    Ada's laptop page (a mouse)
 * @param phone  Ada's phone, held upright (a touch screen), with nothing selected
 */
async function checkADoublePressAtTheEdge(ada: any, phone: any): Promise<void> {
  step('28c. A double-click on a unit at the edge of the map does not send it to the tile beside it, nor does a double tap on a phone; a press 0.7 s later does');
  await ada.keyboard.press('Escape');
  await pressTwiceAtTheEdge(ada, false, false);
  await ada.keyboard.press('Escape');
  await pressTwiceAtTheEdge(phone, true, true);
  await phone.tap(`${byTestId(TEST_IDS.unitPanel)} .panel-close`);
}

/**
 * A look in step 33: the city panel in a browser that SHOWS its scroll
 * bars. With five entries the panel scrolls; beside its scroll bar no line
 * is cut, the description under every add button is ONE line (the table of
 * units promises that, and with the bar's room kept free the Warrior's took
 * two), and a panel that does not scroll keeps the same room free, so that
 * nothing gets narrower the moment a queue grows long.
 *
 * @param ada   Ada's laptop page; the queue of `city` holds five entries
 */
async function checkThePanelBesideAScrollBar(setup: TestSetup, crashes: string[], ada: any, city: CityView): Promise<void> {
  const page = await openSecondDevice(setup.scrollBarBrowser, 'Ada, with scroll bars', crashes, ada, LAPTOP, false);
  await tapTileUntil(page, city.tile, TEST_IDS.cityName, city.name);
  const measure = (
    selector: string,
  ): Promise<{ bar: number; inner: number; scrolls: boolean; thin: boolean; lines: number; cut: string[]; abouts: number; tall: string[]; spare: number }> =>
    page.evaluate((wanted: string) => {
      const panel = document.querySelector(wanted);
      const style = window.getComputedStyle(panel);
      const lines = [...panel.querySelectorAll('.queue-name, .queue-when, .queue-hint, .build-name, .build-detail, .build-about')].filter(
        (line: any) => line.getClientRects().length > 0,
      );
      // The descriptions under the add buttons: on how many lines the words of each stand, and how much room is left beside them.
      const abouts = [...panel.querySelectorAll('.build-menu .build-about')].map((about: any) => {
        const words = document.createRange();
        words.selectNodeContents(about);
        const tops = new Set([...words.getClientRects()].map((box: any) => Math.round(box.top)));
        return { text: about.textContent, lines: tops.size, spare: about.clientWidth - words.getBoundingClientRect().width };
      });
      return {
        abouts: abouts.length,
        tall: abouts.filter((about) => about.lines !== 1).map((about) => `"${about.text}" (${about.lines} lines)`),
        spare: Math.floor(Math.min(...abouts.map((about) => about.spare))),
        bar: panel.offsetWidth - panel.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
        inner: panel.clientWidth,
        scrolls: panel.scrollHeight > panel.clientHeight,
        thin: style.scrollbarWidth === 'thin' && style.scrollbarColor !== 'auto',
        lines: lines.length,
        cut: lines.filter((line: any) => line.scrollWidth > line.clientWidth + 1).map((line: any) => `"${line.textContent}"`),
      };
    }, selector);
  const cityPanel = await measure(byTestId(TEST_IDS.cityPanel));
  check(
    cityPanel.scrolls && cityPanel.bar > 0,
    `with five entries the city panel scrolls, and its scroll bar takes room (${cityPanel.bar} pixels; if not, this look checks nothing: the second browser does not show its scroll bars)`,
  );
  check(cityPanel.thin, 'the panel\'s scroll bar is a thin one in the panel\'s colours, not the browser\'s own');
  check(
    cityPanel.lines >= 5 * 2 + 4 * 3 && cityPanel.cut.length === 0,
    `beside the scroll bar no line of the queue or of the add buttons is cut (${cityPanel.lines} lines looked at; cut: ${cityPanel.cut.join(', ')})`,
  );
  check(
    cityPanel.abouts === UNIT_TYPE_IDS.length && cityPanel.tall.length === 0,
    `beside the scroll bar the description under every add button is one line, as the table of units promises (${cityPanel.abouts} looked at, the longest with ${cityPanel.spare} pixels to spare; not one line: ${cityPanel.tall.join(', ')}; ` +
      'the limit of 42 characters was measured with the font Inter, so on a computer whose own font is much wider a line may take a second one, which the page allows)',
  );
  // A panel that does not scroll: one of Ada's units.
  await page.keyboard.press('Escape');
  const unit = (await viewOf(page)).units.find((candidate) => candidate.owner === 'p1');
  if (unit === undefined) throw new Error('Check failed: Ada has a unit');
  await tapTileUntil(page, unit.tile, TEST_IDS.unitName, UNITS[unit.type].name);
  const unitPanel = await measure(byTestId(TEST_IDS.unitPanel));
  check(
    !unitPanel.scrolls && unitPanel.inner === cityPanel.inner,
    `a panel that does not scroll keeps the room of the scroll bar free: both panels are as wide inside (the unit panel ${unitPanel.inner} pixels, the city panel ${cityPanel.inner})`,
  );
  await page.context().close();
}

// ---------------------------------------------------------------------------
// The presses that could go wrong (steps 21a, 28a and 32 to 35)
// ---------------------------------------------------------------------------

/**
 * pointOf for several buttons that must all be in the open at once (two
 * rows of the queue): the points of all of them, read again after the last
 * scroll.
 */
async function pointsOf(page: any, ids: string[]): Promise<Point[]> {
  for (const id of ids) await pointOf(page, id);
  const points: Point[] = [];
  for (const id of ids) {
    const box = await boxOf(page, byTestId(id));
    const point = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    const onTop = await onTopAt(page, point);
    check(onTop === id, `"${id}" is in the open together with ${ids.join(', ')} (on top at ${at(point)}: "${onTop}"; if not, make the window taller)`);
    points.push(point);
  }
  return points;
}

/**
 * "Empty the queue", pressed as it wants to be pressed: once to be asked,
 * and again after the time a double-click takes. Leaves the queue empty.
 */
async function emptyTheQueue(page: any, cityId: CityId, finger: boolean): Promise<void> {
  await pressAt(page, await pointOf(page, TEST_IDS.queueClear), finger);
  await waitForText(page, TEST_IDS.queueClear, 'Tap again to empty the queue');
  await page.waitForTimeout(GUARD_PAUSE_MS);
  await pressAt(page, await pointOf(page, TEST_IDS.queueClear), finger);
  await waitForQueue(page, cityId, []);
}

/**
 * The arrows of a queue of three, [a, b, c]. "Up" on row 3 and, the moment
 * the entry has moved, "up" on row 2: the entry is first, however soon the
 * second press comes (it is another button). A second press on the SAME
 * arrow right away moves nothing more. Leaves the queue as [a, c, b].
 */
async function arrowsTakeEveryPress(page: any, cityId: CityId, finger: boolean, where: string): Promise<void> {
  const [a, b, c] = queueOf(await viewOf(page), cityId);
  const [upRow2, upRow3] = await pointsOf(page, [TEST_IDS.queueUp + 1, TEST_IDS.queueUp + 2]);
  await pressAt(page, upRow3, finger);
  await waitForQueue(page, cityId, [a, c, b]);
  await pressAt(page, upRow2, finger);
  try {
    await waitForQueue(page, cityId, [c, a, b]);
  } catch (error) {
    throw new Error(`Check failed: ${where}: "up" on row 3 and at once "up" on row 2 bring the entry to the top. ${String(error)}`);
  }

  const downRow1 = await pointOf(page, TEST_IDS.queueDown + 0);
  await pressAt(page, downRow1, finger);
  await waitForQueue(page, cityId, [a, c, b]);
  await pressAt(page, downRow1, finger); // the second click of a double-click: the same button, which now holds the other entry
  await page.waitForTimeout(400); // the answer to a second move would be here by now
  check(
    isDeepStrictEqual(queueOf(await viewOf(page), cityId), [a, c, b]),
    `${where}: two presses in a row on one arrow move the entry one place, not there and back (the queue is [${queueOf(await viewOf(page), cityId).join(', ')}])`,
  );
}

/**
 * A queue of five; three presses on ONE spot, the x of row 3, each after
 * the time a double-click takes. After the first, the rows above have not
 * moved and the x of the entry that followed is under the pointer; the
 * three presses take out entries 3, 4 and 5 and leave the first two.
 */
async function threePressesOnOneSpot(page: any, cityId: CityId, finger: boolean, where: string): Promise<void> {
  const queue = queueOf(await viewOf(page), cityId);
  check(queue.length === 5, `${where}: the queue has five entries for this step (it has ${queue.length})`);
  const spot = await pointOf(page, TEST_IDS.queueRemove + 2);
  const rowsAbove = [await boxOf(page, byTestId(TEST_IDS.queueRow + 0)), await boxOf(page, byTestId(TEST_IDS.queueRow + 1))];

  await pressAt(page, spot, finger);
  await waitForQueue(page, cityId, [queue[0], queue[1], queue[3], queue[4]]);
  await settled(page);
  const onTop = await onTopAt(page, spot);
  check(
    onTop === TEST_IDS.queueRemove + 2,
    `${where}: after a press on the x of row 3, the x of the entry that followed is under the pointer, not the entry above (on top at ${at(spot)}: "${onTop}")`,
  );
  const rowsNow = [await boxOf(page, byTestId(TEST_IDS.queueRow + 0)), await boxOf(page, byTestId(TEST_IDS.queueRow + 1))];
  check(
    rowsNow.every((row, index) => Math.abs(row.top - rowsAbove[index].top) < 1),
    `${where}: the rows above the removed one did not move (they were at ${rowsAbove.map((row) => row.top).join(' and ')}, they are at ${rowsNow.map((row) => row.top).join(' and ')})`,
  );

  await page.waitForTimeout(GUARD_PAUSE_MS);
  await pressAt(page, spot, finger);
  await waitForQueue(page, cityId, [queue[0], queue[1], queue[4]]);
  await page.waitForTimeout(GUARD_PAUSE_MS);
  await pressAt(page, spot, finger);
  await waitForQueue(page, cityId, [queue[0], queue[1]]);
}

/**
 * Step 28a, for one page: nothing is selected, the Worker at work is
 * brought to the spot where its own "Stop work" comes up, and that spot is
 * pressed twice. The first press selects the Worker; the second lands on
 * "Stop work" and must do nothing.
 *
 * @param page  shows the Worker's panel when called (the Worker is selected)
 */
async function doublePressOnTheWorker(page: any, finger: boolean, site: TileIndex, workerId: UnitId): Promise<void> {
  const how = finger ? 'double tap' : 'double-click';
  const jobBefore = unitOf(await viewOf(page), workerId).own?.job ?? null;
  check(jobBefore !== null, 'the Worker is at work for this step');
  const stopAt = await pointOf(page, TEST_IDS.jobStop);
  if (finger) await page.tap(`${byTestId(TEST_IDS.unitPanel)} .panel-close`);
  else await page.keyboard.press('Escape');
  const zoomedIn = await bringTileTo(page, site, stopAt);
  check(
    (await onTopAt(page, stopAt)) === 'map',
    `with nothing selected the map is on top where "Stop work" will come up, at ${at(stopAt)} (if not, the ${how} checks nothing)`,
  );

  await pressTwiceAt(page, stopAt, finger);
  await page.waitForTimeout(400); // the answer to "Stop work" would be here by now
  check(
    isDeepStrictEqual(unitOf(await viewOf(page), workerId).own?.job ?? null, jobBefore),
    `a ${how} on the Worker did not stop its work`,
  );
  check(
    (await textOf(page, TEST_IDS.unitName)) === UNITS.worker.name && (await onTopAt(page, stopAt)) === TEST_IDS.jobStop,
    `the first press selected the Worker, and "Stop work" came up under the pointer (if not, the ${how} checked nothing)`,
  );
  await zoomBackOut(page, zoomedIn);
}

/**
 * The first item of an idle city, on a phone held upright: "Show me" opens
 * the city, and two taps on one spot of an add button are two of its item.
 * The first one takes the city's name off the End Turn button and "Show me"
 * away; neither the panel nor the add button may move for that. (The row
 * under the panel has one height, whatever End Turn says. With the Worker's
 * button, the last of the list, nothing else can hide a row that grows: the
 * panel is scrolled to its end and cannot put the button back by scrolling.)
 *
 * @param page  nothing is selected, the city's queue is empty and no unit can still move
 */
async function twoTapsOnAnAddButton(page: any, city: CityView, unitType: UnitTypeId, where: string): Promise<void> {
  const name = UNITS[unitType].name;
  check(
    (await textOf(page, TEST_IDS.endTurnButton)).includes(`${city.name} has nothing to build`) && (await page.isVisible('.show-next')),
    `${where}: the End Turn button names the idle city, and "Show me" is there`,
  );
  await page.tap('.show-next');
  await waitForText(page, TEST_IDS.cityName, city.name);
  await page.waitForTimeout(SELECTION_PAUSE_MS); // the panel has only just opened (and the queue was emptied before that: the add buttons' quiet time is over sooner)
  const addAt = await pointOf(page, TEST_IDS.buildOption + unitType);
  const before = await boxOf(page, byTestId(TEST_IDS.buildOption + unitType));
  const panelBefore = await boxOf(page, byTestId(TEST_IDS.cityPanel));

  await page.touchscreen.tap(addAt.x, addAt.y);
  await waitForQueue(page, city.id, [unitType]);
  await settled(page);
  check(
    !(await page.isVisible('.show-next')) && !(await textOf(page, TEST_IDS.endTurnButton)).includes(city.name),
    `${where}: the first ${name} took "Show me" and the city's name off the End Turn button (if not, the next check checks nothing: a unit can still move)`,
  );
  const after = await boxOf(page, byTestId(TEST_IDS.buildOption + unitType));
  const panelAfter = await boxOf(page, byTestId(TEST_IDS.cityPanel));
  check(
    Math.abs(panelAfter.top - panelBefore.top) < 1 && Math.abs(panelAfter.bottom - panelBefore.bottom) < 1,
    `${where}: the panel stayed where it was when the End Turn button changed (it reached from ${panelBefore.top} to ${panelBefore.bottom}, it reaches from ${panelAfter.top} to ${panelAfter.bottom})`,
  );
  check(
    Math.abs(after.top - before.top) < 1,
    `${where}: the ${name}'s add button stayed where it was when the End Turn button changed (its top was at ${before.top}, it is at ${after.top})`,
  );
  await page.touchscreen.tap(addAt.x, addAt.y);
  await waitForQueue(page, city.id, [unitType, unitType]);
}

/**
 * Step 21a: the build queue under a finger, on a phone held upright.
 *
 * @param eve        the page of step 21: a phone-sized touch screen, held upright, with nothing selected
 * @param city       Eve's city; its queue holds one Warrior
 * @param warriorId  her Warrior, the only unit she has left
 */
async function checkAPhoneTakesEveryTap(eve: any, city: CityView, warriorId: UnitId): Promise<void> {
  step('21a. On the phone: two taps on "Scout" are two Scouts; the arrows and the x take every tap for what it was aimed at; stopping the only construction adds nothing');

  // No unit may be left that can still move: only then does the first item
  // of the idle city take "Show me" away, which is what used to make the
  // add buttons jump.
  for (let walks = 0; walks < 3; walks++) {
    const warrior = unitOf(await viewOf(eve), warriorId);
    if ((warrior.own?.movesLeft ?? 0) === 0) break;
    await fingerTileUntil(eve, warrior.tile, TEST_IDS.unitName, UNITS.warrior.name);
    const reach = await reachableOf(eve, warriorId);
    if (reach.length === 0) break;
    await fingerTile(eve, reach[reach.length - 1]);
    await waitForView(eve, 'Eve\'s Warrior to walk on', (now) => unitOf(now, warriorId).tile !== warrior.tile);
  }
  check(idleUnits(await viewOf(eve)).length === 0, 'no unit of Eve\'s can still move (if this fails, let the Warrior walk further)');

  // The city's queue is emptied, with a finger: an idle city.
  await fingerTileUntil(eve, city.tile, TEST_IDS.cityName, city.name);
  await eve.waitForTimeout(SELECTION_PAUSE_MS);
  await emptyTheQueue(eve, city.id, true);
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await twoTapsOnAnAddButton(eve, city, 'scout', 'at 390 x 844');

  // The same with the last button of the add list, the Worker's.
  const lastOfTheList = UNIT_TYPE_IDS[UNIT_TYPE_IDS.length - 1];
  check(lastOfTheList === 'worker', `the Worker's button is the last of the add list (the last unit of the table is "${lastOfTheList}")`);
  await emptyTheQueue(eve, city.id, true);
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await twoTapsOnAnAddButton(eve, city, lastOfTheList, 'at 390 x 844');

  // The same on a small phone.
  await eve.setViewportSize(SMALL_PHONE);
  await emptyTheQueue(eve, city.id, true);
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await twoTapsOnAnAddButton(eve, city, 'scout', 'at 360 x 640');
  await eve.setViewportSize(PHONE);

  // The arrows: the queue is Scout, Scout; a Worker joins and is brought to the top.
  await pressAt(eve, await pointOf(eve, TEST_IDS.buildOption + 'worker'), true);
  await waitForQueue(eve, city.id, ['scout', 'scout', 'worker']);
  await arrowsTakeEveryPress(eve, city.id, true, 'on the phone');

  // The x: a queue of five, three taps on one spot.
  for (const item of ['warrior', 'settler'] as const) await pressAt(eve, await pointOf(eve, TEST_IDS.buildOption + item), true);
  await waitForQueue(eve, city.id, ['scout', 'worker', 'scout', 'warrior', 'settler']);
  await threePressesOnOneSpot(eve, city.id, true, 'on the phone');

  // Stopping the only construction. One row is left, and the panel is
  // opened afresh, at its top: then the add list moves up to where the row
  // was, and a second tap on the spot of the x lands on an add button.
  await pressAt(eve, await pointOf(eve, TEST_IDS.queueRemove + 1), true);
  await waitForQueue(eve, city.id, ['scout']);
  await eve.tap(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await fingerTileUntil(eve, city.tile, TEST_IDS.cityName, city.name);
  await eve.waitForTimeout(SELECTION_PAUSE_MS); // the panel has only just opened
  const stopAt = await pointOf(eve, TEST_IDS.queueRemove + 0);
  await eve.touchscreen.tap(stopAt.x, stopAt.y);
  await waitForQueue(eve, city.id, []);
  const cameUp = await onTopAt(eve, stopAt);
  check(
    cameUp.startsWith(TEST_IDS.buildOption),
    `on the phone: when the only construction was stopped, an add button came up under the finger (on top at ${at(stopAt)}: "${cameUp}"; if not, the next check checks nothing)`,
  );
  await eve.touchscreen.tap(stopAt.x, stopAt.y);
  await eve.waitForTimeout(400); // the answer to an added item would be here by now
  check(queueOf(await viewOf(eve), city.id).length === 0, 'on the phone: a second tap on the spot of the x added nothing to the queue');
}

/** A tablet held upright: a touch screen on which the city panel floats and does not scroll. */
const TABLET = { width: 768, height: 1024 };

/**
 * Step 21c: a finger that takes its time, on a tablet. In a panel that is
 * not scrolled the rows above a removed one would slide down under the
 * finger the moment the panel is let go; it used to be let go 1.5 s after
 * the last tap, sooner than a thoughtful finger taps again. The rows are
 * held until a press lands outside them (and has been handled).
 *
 * @param eve   the phone of step 21b, held upright; the panel of `city` is open and its queue is full
 *              (the step leaves the queue with four entries and the phone as it was)
 */
async function checkASlowFingerTakesNeighbours(eve: any, city: CityView): Promise<void> {
  step('21c. On a tablet, two taps on one x 1.8 s apart take two neighbours, and a tap on an add button after that adds that very item');
  await eve.setViewportSize(TABLET);
  await settled(eve);
  const full = queueOf(await viewOf(eve), city.id);
  check(full.length === 8, `the queue is full for this step (it has ${full.length} entries)`);
  // Eight rows are more than the panel shows without scrolling. The last
  // three are taken out, bottom-up, and a tap on the panel's head (a press
  // outside the rows) lets the rows settle.
  for (const row of [7, 6, 5]) {
    await pressAt(eve, await pointOf(eve, TEST_IDS.queueRemove + row), true);
    await waitForQueue(eve, city.id, full.slice(0, row));
  }
  await eve.tap(byTestId(TEST_IDS.cityName));
  await settled(eve);
  const queue = full.slice(0, 5);
  const fits: boolean = await eve.evaluate((selector: string) => {
    const panel = document.querySelector(selector);
    return panel.scrollTop === 0 && panel.scrollHeight <= panel.clientHeight;
  }, byTestId(TEST_IDS.cityPanel));
  check(fits, 'on the tablet the city panel shows a queue of five without scrolling (if not, the rows above a removed one cannot slide and this step checks nothing: make the window taller)');

  const spot = await pointOf(eve, TEST_IDS.queueRemove + 2);
  await eve.touchscreen.tap(spot.x, spot.y);
  await waitForQueue(eve, city.id, [...queue.slice(0, 2), ...queue.slice(3)]);
  await eve.waitForTimeout(1800); // a finger that takes its time
  const onTop = await onTopAt(eve, spot);
  check(
    onTop === TEST_IDS.queueRemove + 2,
    `1.8 s after a tap on the x of row 3, the x of the entry that followed is still under the finger: the rows above have not slid down (on top at ${at(spot)}: "${onTop}")`,
  );
  await eve.touchscreen.tap(spot.x, spot.y);
  await waitForQueue(eve, city.id, [...queue.slice(0, 2), ...queue.slice(4)]);

  // A tap outside the rows: an add button. It adds its own item, and only then the rows settle.
  await eve.waitForTimeout(GUARD_PAUSE_MS); // the add buttons keep quiet for 0.6 s after a removal
  const gap = `${byTestId(TEST_IDS.cityPanel)} .queue-spacer`;
  check(await eve.isVisible(gap), 'the rows are still held 0.7 s after the second tap: the room of the removed rows is kept under them');
  const item: UnitTypeId = 'scout';
  const addBox = await boxOf(eve, byTestId(TEST_IDS.buildOption + item));
  const addAt: Point = { x: (addBox.left + addBox.right) / 2, y: (addBox.top + addBox.bottom) / 2 };
  check((await onTopAt(eve, addAt)) === TEST_IDS.buildOption + item, `the ${UNITS[item].name}'s add button is in the open at ${at(addAt)}`);
  await eve.touchscreen.tap(addAt.x, addAt.y);
  try {
    await waitForQueue(eve, city.id, [...queue.slice(0, 2), ...queue.slice(4), item]);
  } catch (error) {
    throw new Error(`Check failed: a tap on an add button while the rows are held adds that button's item. ${String(error)}`);
  }
  await settled(eve);
  check(!(await eve.isVisible(gap)), 'a tap outside the rows lets them settle: the kept room is gone');

  await eve.setViewportSize(PHONE);
  await settled(eve);
}

/**
 * Steps 32 to 35: the presses of the build queue that used to go wrong,
 * with a mouse and with the keyboard, and once through a link with delay.
 *
 * @param ada   the page of the player who owns `city`, in the laptop window
 */
async function checkEveryPressCounts(setup: TestSetup, crashes: string[], ada: any, city: CityView): Promise<void> {
  step('32. "Empty the queue" asks once; quick clicks on the add buttons and on the arrows all count, and End Turn does not go grey meanwhile');
  await ada.keyboard.press('Escape');
  await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  await ada.waitForTimeout(SELECTION_PAUSE_MS);
  // Whatever the queue holds by now, it gets one entry more: something to empty.
  const leftOver = queueOf(await viewOf(ada), city.id);
  await ada.click(byTestId(TEST_IDS.buildOption + 'scout'));
  await waitForQueue(ada, city.id, [...leftOver, 'scout']);

  const clear = byTestId(TEST_IDS.queueClear);
  await ada.click(clear);
  await waitForText(ada, TEST_IDS.queueClear, 'Tap again to empty the queue');
  await ada.dblclick(clear);
  await ada.waitForTimeout(300); // the answer to an emptying would be here by now
  check(
    isDeepStrictEqual(queueOf(await viewOf(ada), city.id), [...leftOver, 'scout']) && (await textOf(ada, TEST_IDS.queueClear)) === 'Tap again to empty the queue',
    'the first press on "Empty the queue" only asks, and a double-click right after it is no answer: the queue is as it was',
  );
  await ada.waitForTimeout(GUARD_PAUSE_MS - 300);
  await ada.click(clear);
  await waitForQueue(ada, city.id, []);
  check(!(await ada.isVisible(clear)), 'the queue is empty, and the button is gone with it');

  // Three clicks on add buttons, each as soon as the one before is done,
  // without waiting for the server in between. End Turn is watched: it may
  // not go grey for the blink of an answer.
  await ada.waitForTimeout(GUARD_PAUSE_MS); // the add buttons keep quiet for 0.6 s after a removal
  await watchEndTurnGreying(ada);
  for (const item of ['warrior', 'scout', 'worker'] as const) await ada.click(byTestId(TEST_IDS.buildOption + item));
  await waitForQueue(ada, city.id, ['warrior', 'scout', 'worker']);
  check(
    (await endTurnGreyings(ada)) === 0 && (await ada.isEnabled(byTestId(TEST_IDS.endTurnButton))),
    `the End Turn button did not go grey while items were added (it changed ${await endTurnGreyings(ada)} times)`,
  );
  await arrowsTakeEveryPress(ada, city.id, false, 'with a mouse');

  step('33. After a removal the entry that followed comes under the pointer: three presses on one spot take three neighbours, in a laptop window and in a large one');
  for (const size of [LAPTOP, LARGE_WINDOW]) {
    await ada.setViewportSize(size);
    await settled(ada);
    const five: UnitTypeId[] = ['warrior', 'worker', 'scout', 'settler', 'warrior'];
    const held = queueOf(await viewOf(ada), city.id);
    check(isDeepStrictEqual(held, five.slice(0, held.length)), `the queue is the beginning of [${five.join(', ')}] (it is [${held.join(', ')}])`);
    for (const item of five.slice(held.length)) await ada.click(byTestId(TEST_IDS.buildOption + item));
    await waitForQueue(ada, city.id, five);
    if (size === LAPTOP) await checkThePanelBesideAScrollBar(setup, crashes, ada, city);
    await threePressesOnOneSpot(ada, city.id, false, `in a window of ${size.width} x ${size.height}`);
    // The hand leaves the queue, and the panel takes its own size again.
    await ada.mouse.move(size.width / 2, 200);
    await ada.waitForTimeout(GUARD_PAUSE_MS); // the add buttons keep quiet for 0.6 s after a removal
  }
  await ada.setViewportSize(LAPTOP);
  await settled(ada);

  step('34. With the keyboard: Enter twice on the x of the last row removes one entry, and does not end the turn; nor do three Enters on the x of the only row');
  await ada.focus(byTestId(TEST_IDS.queueRemove + 1));
  await ada.keyboard.press('Enter');
  await waitForQueue(ada, city.id, ['warrior']);
  const focused: string = await ada.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '');
  check(focused === TEST_IDS.queueRemove + 0, `when the last row went, the keyboard focus moved to the x of the new last row (it is on "${focused}")`);
  await ada.keyboard.press('Enter');
  await ada.waitForTimeout(400); // the answer to a removal, or to End Turn, would be here by now
  check(isDeepStrictEqual(queueOf(await viewOf(ada), city.id), ['warrior']), 'the second Enter removed nothing more');
  check(!(await hasEndedTurn(ada)), 'and it did not end the turn');

  // The x of the ONLY row, three Enters 150 ms apart. The first removes the
  // row and the focus goes to the panel's close button; the second closes
  // the panel and the focus falls back to the page, where Enter means End
  // Turn; the third was meant for the queue like the first two.
  await ada.waitForTimeout(GUARD_PAUSE_MS - 400); // the guard of the first Enter covers this button for 0.6 s, and 0.4 s of that are over
  const firstEnterAt = Date.now();
  await ada.keyboard.press('Enter');
  await waitForQueue(ada, city.id, []);
  const closeFocused: boolean = await ada.evaluate(() => document.activeElement?.classList.contains('panel-close') === true);
  check(closeFocused, 'when the only row went, the keyboard focus moved to the panel\'s close button');
  await waitUntilSince(ada, firstEnterAt, 150);
  const secondEnterAt = Date.now();
  await ada.keyboard.press('Enter');
  await ada.waitForSelector(byTestId(TEST_IDS.cityPanel), { state: 'hidden' });
  await waitUntilSince(ada, secondEnterAt, 150);
  // The key keeps quiet for 0.6 s. A computer too busy to press in that time skips the third Enter.
  if (Date.now() - secondEnterAt < 450) await ada.keyboard.press('Enter');
  await ada.waitForTimeout(400); // the answer to End Turn would be here by now
  check(
    !(await hasEndedTurn(ada)) && queueOf(await viewOf(ada), city.id).length === 0 && !(await ada.isVisible(byTestId(TEST_IDS.cityPanel))),
    'three Enters on the x of the only row: the row is gone, the panel is closed, and the turn is not ended',
  );
  // The two halves of that rule, each alone. First, a key that pressed a
  // button: Enter on "+" (which stays where it is), the focus given up by
  // the page itself, and Enter again at once.
  await waitUntilSince(ada, secondEnterAt, 650); // the quiet time of the three Enters is over
  const zoomIn = 'button[aria-label="Zoom in"]';
  await ada.focus(zoomIn);
  const buttonEnterAt = Date.now();
  await ada.keyboard.press('Enter');
  await ada.evaluate(() => document.activeElement.blur());
  if (Date.now() - buttonEnterAt < 450) await ada.keyboard.press('Enter');
  await ada.waitForTimeout(400); // the answer to End Turn would be here by now
  check(!(await hasEndedTurn(ada)), 'an Enter right after an Enter that pressed a button does not end the turn, wherever the focus is by then');
  await ada.keyboard.press('-'); // the map as it was

  // An Enter a second later is meant: it ends the turn. (And one more takes that back.)
  await waitUntilSince(ada, buttonEnterAt, 1000);
  await ada.keyboard.press('Enter');
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'true');
  await ada.waitForTimeout(END_TURN_PAUSE_MS);
  await ada.keyboard.press('Enter');
  await waitForAttribute(ada, TEST_IDS.endTurnButton, 'data-ended', 'false');

  // Second, a button that is greyed out while it has the focus. The queue
  // gets three entries, the focus is put on the "down" arrow of the second
  // row, and the third row is removed by the page's own click (no key):
  // the second row is the last now, its arrow goes grey and hands the
  // focus back to the page.
  await tapTileUntil(ada, city.tile, TEST_IDS.cityName, city.name);
  await ada.waitForTimeout(SELECTION_PAUSE_MS);
  for (const item of ['warrior', 'scout', 'worker'] as const) await ada.click(byTestId(TEST_IDS.buildOption + item));
  await waitForQueue(ada, city.id, ['warrior', 'scout', 'worker']);
  await settled(ada); // every answer is in
  await ada.focus(byTestId(TEST_IDS.queueDown + 1));
  await ada.evaluate((selector: string) => document.querySelector(selector).click(), byTestId(TEST_IDS.queueRemove + 2));
  await waitForQueue(ada, city.id, ['warrior', 'scout']);
  const greyedAt = Date.now();
  const fellBack: boolean = await ada.evaluate(
    (selector: string) => document.querySelector(selector).disabled === true && document.activeElement === document.body,
    byTestId(TEST_IDS.queueDown + 1),
  );
  check(fellBack, 'the arrow that had the focus is greyed out, and the focus is back on the page (if not, the next check checks nothing)');
  if (Date.now() - greyedAt < 450) await ada.keyboard.press('Enter');
  await ada.waitForTimeout(400); // the answer to End Turn would be here by now
  check(!(await hasEndedTurn(ada)), 'an Enter right after the button that had the focus was greyed out does not end the turn');
  // The queue as the next step wants it: one Warrior.
  await ada.click(byTestId(TEST_IDS.queueRemove + 1));
  await waitForQueue(ada, city.id, ['warrior']);

  // And a control that goes away while it has the focus: the panel's close
  // button has it, and Escape (no button's key) closes the panel. First the
  // quiet time of the greyed arrow must be over, or this look checks nothing.
  await waitUntilSince(ada, greyedAt, 650);
  await ada.focus(`${byTestId(TEST_IDS.cityPanel)} .panel-close`);
  await ada.keyboard.press('Escape');
  const closedAt = Date.now();
  await ada.waitForSelector(byTestId(TEST_IDS.cityPanel), { state: 'hidden' });
  // The browser takes the focus off the hidden button with its next frame; only then does Enter reach the page.
  await ada.waitForFunction(() => document.activeElement === document.body, undefined, { timeout: WAIT_MS });
  if (Date.now() - closedAt < 450) await ada.keyboard.press('Enter');
  await ada.waitForTimeout(400); // the answer to End Turn would be here by now
  check(!(await hasEndedTurn(ada)), 'an Enter right after the panel whose button had the focus was closed does not end the turn');

  step('35. Through a link with delay, two quick clicks on an add button are two items');
  const link = await startSlowLink(Number(new URL(setup.baseUrl).port), 100);
  try {
    const slowOrigin = `http://localhost:${link.port}`;
    const far = await openSecondDevice(setup.browser, 'Ada, far away', crashes, ada, LAPTOP, false, `${slowOrigin}/${new URL(ada.url()).search}`, slowOrigin);
    await tapTileUntil(far, city.tile, TEST_IDS.cityName, city.name);
    await far.waitForTimeout(SELECTION_PAUSE_MS);
    const scoutAt = await pointOf(far, TEST_IDS.buildOption + 'scout');
    // The answer to the first click is 0.2 s away: the second click comes while it is on its way.
    await far.mouse.click(scoutAt.x, scoutAt.y);
    await far.mouse.click(scoutAt.x, scoutAt.y);
    try {
      await waitForQueue(far, city.id, ['warrior', 'scout', 'scout']);
    } catch (error) {
      throw new Error(`Check failed: with 0.1 s of delay each way, two quick clicks on "Scout" add two Scouts. ${String(error)}`);
    }

    // End Turn pressed while the answer to an add is on its way: the press
    // waits for the answer, and the turn is ended after the add, by that one press.
    const endTurnBox = await boxOf(far, byTestId(TEST_IDS.endTurnButton));
    await far.mouse.click(scoutAt.x, scoutAt.y);
    await far.mouse.click((endTurnBox.left + endTurnBox.right) / 2, (endTurnBox.top + endTurnBox.bottom) / 2);
    try {
      await waitForView(
        far,
        'the third Scout to be in the queue and the turn to be ended',
        (now) => isDeepStrictEqual(queueOf(now, city.id), ['warrior', 'scout', 'scout', 'scout']) && now.players.some((player) => player.id === now.you && player.endedTurn),
      );
    } catch (error) {
      throw new Error(`Check failed: with 0.1 s of delay each way, End Turn pressed right after an add button ends the turn once the add has been answered. ${String(error)}`);
    }
    await far.waitForTimeout(END_TURN_PAUSE_MS);
    await far.click(byTestId(TEST_IDS.endTurnButton));
    await waitForAttribute(far, TEST_IDS.endTurnButton, 'data-ended', 'false');

    // A tap "to make sure" on the x of a row, later than the 0.6 s that are
    // counted from the first press, and sooner than 0.6 s after the row has
    // gone from the screen (the answer takes at least 0.2 s): it removes
    // nothing more. The entry that followed came under the pointer only
    // when the answer arrived, and the time counts from there.
    const removeAt = await pointOf(far, TEST_IDS.queueRemove + 1);
    await far.mouse.click(removeAt.x, removeAt.y);
    const removedAt = Date.now(); // the press is out; its answer cannot show before 0.2 s from here
    await waitForQueue(far, city.id, ['warrior', 'scout', 'scout']);
    await waitUntilSince(far, removedAt, 650);
    // 0.6 s from the moment the row went, at the earliest 0.2 s after the press. A computer too busy to press in that time skips the press.
    if (Date.now() - removedAt < 700) await far.mouse.click(removeAt.x, removeAt.y);
    await far.waitForTimeout(500); // the answer to a second removal would be here by now
    check(
      isDeepStrictEqual(queueOf(await viewOf(far), city.id), ['warrior', 'scout', 'scout']),
      `with 0.1 s of delay each way, a second press on the x of a row, 0.65 s after the first, removes nothing more (the queue is [${queueOf(await viewOf(far), city.id).join(', ')}])`,
    );
    await far.context().close();
  } finally {
    await link.close();
  }
}

// ---------------------------------------------------------------------------
// The frame: a private server, a browser, and cleaning up
// ---------------------------------------------------------------------------

/** Loads Playwright, with a helpful message if it is not where we look for it. */
function loadPlaywright(): any {
  try {
    return createRequire(import.meta.url)(PLAYWRIGHT_PATH);
  } catch {
    throw new Error(
      `Playwright was not found at "${PLAYWRIGHT_PATH}". It is not installed by "npm install". ` +
        'Install it once ("npm install -g playwright", then "npx playwright install chromium") ' +
        'and set the PLAYWRIGHT_PATH environment variable to its folder (see "npm root -g").',
    );
  }
}

async function main(): Promise<void> {
  // Everything that is started below is stopped in the `finally`, also when
  // a later start or a test step fails: no server, browser or temporary
  // folder is ever left behind.
  let dataDir: string | null = null;
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  let browser: any = null;
  let scrollBarBrowser: any = null;
  try {
    // The browser first: if Playwright is missing, nothing else has been started yet.
    const { chromium } = loadPlaywright();
    browser = await chromium.launch();
    scrollBarBrowser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

    dataDir = mkdtempSync(join(tmpdir(), 'domination-e2e-'));
    const settings = { ...process.env, DOMINATION_DATA_DIR: dataDir, DOMINATION_SEED: 'end-to-end-test-seed' };
    const firstConfig = loadConfig({ ...settings, PORT: '0' }); // 0 = any free port
    if (!existsSync(join(firstConfig.clientDir, 'index.html'))) {
      throw new Error(`The game page has not been built (${firstConfig.clientDir} has no index.html). Run "npm run build" first.`);
    }
    server = await startServer({ config: firstConfig, log: () => {} });
    const port = server.port;

    await playTwoPlayers({
      browser,
      scrollBarBrowser,
      baseUrl: `http://localhost:${port}`,
      stopServer: async () => {
        await server?.close();
        server = null;
      },
      startServer: async () => {
        // The same port, so the pages that are open find the new server
        // where the old one was; the same folder, so it finds their game.
        server = await startServer({ config: loadConfig({ ...settings, PORT: String(port) }), log: () => {} });
      },
    });
    console.log('End-to-end test passed.');
  } finally {
    await browser?.close();
    await scrollBarBrowser?.close();
    await server?.close();
    if (dataDir !== null) rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
