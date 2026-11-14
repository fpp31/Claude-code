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
 * Playwright is NOT a dependency of this project and `npm install` does not
 * fetch it. It is loaded from a global install; the default path below only
 * fits the machine this was first written on, so on your own computer set
 * the PLAYWRIGHT_PATH environment variable to where yours lives.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { TEST_IDS } from '../packages/client/src/ui/testIds';
import { loadConfig } from '../packages/server/src/config';
import { startServer } from '../packages/server/src/server';
import type { CityView, PlayerView, TileIndex, UnitView } from '../packages/shared/src/index';

const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH ?? '/opt/node-tools/node_modules/playwright';

/** The longest any single wait may take, in milliseconds. A step that takes longer fails the test. */
const WAIT_MS = 20_000;

/**
 * The client ignores a press of End Turn for 0.6 s after the button changed
 * its meaning (Controller.toggleEndTurn). Before pressing it again in a new
 * turn the test waits a little longer than that, as a person would.
 */
const END_TURN_PAUSE_MS = 800;

// The small functions handed to `page.evaluate` and `page.waitForFunction`
// run inside the browser, where `window` and `document` exist. This file
// itself runs in Node, so they are only declared here.
declare const window: any;
declare const document: any;

/** What the steps need from the outside: a browser, and a server they can stop and start. */
interface TestSetup {
  /** A Playwright browser (not typed: Playwright is not a dependency of the project). */
  browser: any;
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

/** Where an element is on the screen, in CSS pixels; fails if the page has no such element. */
async function boxOf(page: any, selector: string): Promise<{ top: number; bottom: number; width: number; height: number }> {
  const box = await page.evaluate((wanted: string) => {
    const rect = document.querySelector(wanted)?.getBoundingClientRect();
    return rect === undefined ? null : { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, selector);
  if (box === null) throw new Error(`The page has no element "${selector}".`);
  return box;
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

/** Opens a page in a browser of its own (its own storage, so its own player), and watches it for crashes. */
async function openPlayer(browser: any, name: string, crashes: string[], viewport = LAPTOP): Promise<any> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  // An exception nobody caught inside the page is a bug, whatever the test was looking at.
  page.on('pageerror', (error: Error) => crashes.push(`${name}'s page: ${error.message}`));
  return page;
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

async function playTwoPlayers(setup: TestSetup): Promise<void> {
  const crashes: string[] = [];
  const ada = await openPlayer(setup.browser, 'Ada', crashes);
  const ben = await openPlayer(setup.browser, 'Ben', crashes);

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

  step('2. Ben opens the link: it shows the code but takes no seat until he presses Join');
  await ben.goto(link);
  await ben.waitForSelector(byTestId(TEST_IDS.homeJoinButton));
  check((await ben.inputValue(byTestId(TEST_IDS.homeCodeInput))) === code, 'the code from the link is filled in');
  await ben.fill(byTestId(TEST_IDS.homeNameInput), 'Ben');
  // The Join button is switched on once the server has answered Ben's page
  // ("you have no seat in that game"). Up to this moment Ben has only looked.
  await ben.waitForSelector(`${byTestId(TEST_IDS.homeJoinButton)}:enabled`);
  check((await seatCount(ada)) === 1, 'opening the link did not take a seat');
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

  step('7. Ada reloads the page: same game, same seat, turn 2, and her city is there');
  await ada.reload();
  await waitForTurn(ada, 2);
  const reloaded = await viewOf(ada);
  check(ada.url() === link, 'the address still names the game');
  check(reloaded.you === 'p1', 'Ada is back on seat p1');
  check(reloaded.cities.some((candidate) => candidate.id === city.id && candidate.own !== null), 'Ada still has her city');

  step('8. The server stops and a new one starts on the same saved games: both come back');
  const before = { ada: await viewOf(ada), ben: await viewOf(ben) };
  await setup.stopServer();
  for (const page of [ada, ben]) await waitForText(page, TEST_IDS.topConnection, 'reconnecting');
  await setup.startServer();
  await waitForTurn(ben, 2); // Ben's page finds the new server by itself
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
  const lowWindow = { bar: await boxOf(ada, '.top-bar'), panel: await boxOf(ada, byTestId(TEST_IDS.cityPanel)) };
  check(
    lowWindow.panel.top >= lowWindow.bar.bottom,
    `the city panel starts below the top bar (the bar ends at ${lowWindow.bar.bottom}, the panel starts at ${lowWindow.panel.top})`,
  );
  check(lowWindow.panel.bottom <= 390, `the city panel ends on the screen (at ${lowWindow.panel.bottom} of 390)`);
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
  try {
    // The browser first: if Playwright is missing, nothing else has been started yet.
    const { chromium } = loadPlaywright();
    browser = await chromium.launch();

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
    await server?.close();
    if (dataDir !== null) rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
