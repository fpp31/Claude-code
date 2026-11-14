/**
 * End-to-end test: two real browsers play the first turn of a game together.
 *
 *   npm run build      (the test uses the built client)
 *   npm run e2e
 *
 * OWNER: the integrator, once work packages WP1-WP5 are merged. The frame
 * below (start a private server, open a browser, clean up) is written; the
 * steps in `playTwoPlayers` are still to do.
 *
 * It starts its own server inside this process, on a free port, with a
 * throw-away data folder and a fixed seed, so it never touches real saved
 * games, always gets the same map, and leaves nothing running.
 *
 * Playwright is NOT a dependency of this project and `npm install` does not
 * fetch it. It is loaded from a global install; the default path below only
 * fits the machine this was first written on, so on your own computer set
 * the PLAYWRIGHT_PATH environment variable to where yours lives.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/server/src/config';
import { startServer } from '../packages/server/src/server';

const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH ?? '/opt/node-tools/node_modules/playwright';

/**
 * The steps, for the integrator. Find elements by the data-testid names in
 * packages/client/src/ui/testIds.ts; click map tiles at
 * `window.__domination.tileToScreen(tile)` (packages/client/src/debugHook.ts)
 * after `window.__domination.centerOn(tile)`.
 *
 *  1. Browser A opens baseUrl, types a name, presses Create. Read the game
 *     code and the link from the lobby.
 *  2. Browser B (a separate browser context, so it has its own token) opens
 *     the link. Opening the link takes no seat: B sees the home screen with
 *     the code filled in, types a name and presses Join. Both lobbies show
 *     two seats.
 *  3. B picks another civilization; A sees the change. A starts the game.
 *     Both see the game screen at "Turn 1" with status "online".
 *  4. A selects its Warrior (tap its tile), checks that reachable tiles are
 *     reported, taps one, and waits until the view shows the Warrior there.
 *  5. A selects its Settler and presses Found City; the view shows a city
 *     and the Settler is gone. B's view does NOT contain that city unless it
 *     is in B's sight.
 *  6. A presses End Turn: still "Turn 1", A's chip shows ended. B presses
 *     End Turn: both show "Turn 2". (Press each End Turn button ONCE: the
 *     client ignores a second press within 0.6 s of the button changing its
 *     meaning, see Controller.toggleEndTurn.)
 *  7. A reloads the page: it comes back to the same game, same seat, "Turn 2",
 *     with its city.
 */
async function playTwoPlayers(browser: any, baseUrl: string): Promise<void> {
  throw new Error('not implemented: the end-to-end steps (see the comment above playTwoPlayers)');
}

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
    const config = loadConfig({
      ...process.env,
      PORT: '0',
      DOMINATION_DATA_DIR: dataDir,
      DOMINATION_SEED: 'end-to-end-test-seed',
    });
    server = await startServer({ config, log: () => {} });

    await playTwoPlayers(browser, `http://localhost:${server.port}`);
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
