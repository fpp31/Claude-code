import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig, projectRoot } from '../src/config';

/**
 * `npm run dev` and `npm start` must not share a folder of saved games: two
 * servers on one folder silently write over each other's games. This checks
 * the environment scripts/dev.mjs gives its server against what the server
 * makes of it (loadConfig).
 */

interface DevEnv {
  DEV_DATA_FOLDER: string;
  devEnvironment(env: Record<string, string | undefined>, root: string): Record<string, string | undefined>;
}

/** scripts/devEnv.mjs is plain JavaScript outside the packages, so it is loaded by its path. */
async function loadDevEnv(): Promise<DevEnv> {
  return (await import(pathToFileURL(join(projectRoot(), 'scripts', 'devEnv.mjs')).href)) as DevEnv;
}

describe('npm run dev (scripts/devEnv.mjs)', () => {
  it('the development server saves its games in a folder of its own, not in the one "npm start" uses', async () => {
    const { devEnvironment, DEV_DATA_FOLDER } = await loadDevEnv();
    const hosting = loadConfig({});
    const developing = loadConfig(devEnvironment({}, projectRoot()));

    expect(developing.dataDir).not.toBe(hosting.dataDir);
    expect(developing.dataDir).toBe(join(projectRoot(), DEV_DATA_FOLDER));
    expect(hosting.dataDir).toBe(join(projectRoot(), 'data'));
    // An empty variable counts as "not set", as it does for the server.
    expect(loadConfig(devEnvironment({ DOMINATION_DATA_DIR: '' }, projectRoot())).dataDir).toBe(developing.dataDir);
  });

  it('a folder the developer chose is kept, and everything else is passed on untouched', async () => {
    const { devEnvironment } = await loadDevEnv();
    const given = { DOMINATION_DATA_DIR: join(projectRoot(), 'elsewhere'), PORT: '8801', DEV_PORT: '5201' };
    const env = devEnvironment(given, projectRoot());

    expect(env).toEqual(given);
    expect(env).not.toBe(given);
    expect(devEnvironment({ PORT: '8801' }, projectRoot()).PORT).toBe('8801');
  });

  it('the development folder is not put under version control', async () => {
    const { DEV_DATA_FOLDER } = await loadDevEnv();
    const { readFileSync } = await import('node:fs');
    const ignored = readFileSync(join(projectRoot(), '.gitignore'), 'utf8').split('\n');
    expect(ignored).toContain(`/${DEV_DATA_FOLDER}/`);
  });
});
