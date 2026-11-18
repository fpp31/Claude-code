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

describe('folders of saved games and version control (.gitignore)', () => {
  /**
   * The lines of .gitignore that name a folder in the project root (a
   * slash, a name, a slash: "/data/"), as tests for a folder's name: a "*"
   * in the name stands for any run of characters, everything else for itself.
   */
  async function rootFolderPatterns(): Promise<RegExp[]> {
    const { readFileSync } = await import('node:fs');
    return readFileSync(join(projectRoot(), '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\/[^/]+\/$/.test(line))
      .map((line) => {
        const parts = line.slice(1, -1).split('*');
        return new RegExp(`^${parts.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
      });
  }

  it('every folder of saved games the README names is kept out of version control: data/, the development folders and the copies made around an update', async () => {
    // A saved game holds the map, the seed and the hashes of the players'
    // secrets. "Updating the game" tells whoever runs the server to copy
    // data/ before an update; a copy that git lists as "untracked" is one
    // "commit everything" away from a public repository.
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(join(projectRoot(), 'README.md'), 'utf8');
    const named = [...new Set(readme.match(/\bdata-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])];
    // What the README names today. A name it gains later is checked as well (the loop below reads the README).
    // (The copies of older versions carry the version's short name; these two are the README's examples.)
    for (const folder of ['data-dev', 'data-dev-2', 'data-before-update', 'data-of-the-new-version', 'data-of-6bc093c', 'data-of-ee70e85']) {
      expect(named, 'README.md no longer names this folder: correct this list').toContain(folder);
    }
    const patterns = await rootFolderPatterns();
    for (const folder of ['data', ...named]) {
      expect(
        patterns.some((pattern) => pattern.test(folder)),
        `README.md names the folder ${folder}/, and no line of .gitignore covers it: git would list saved games as files to add`,
      ).toBe(true);
    }

    // And the patterns take nothing the project needs.
    for (const needed of ['packages', 'scripts', 'docs', 'e2e', 'package.json', 'package-lock.json', 'README.md', 'ARCHITECTURE.md', 'tsconfig.base.json', 'vitest.config.ts']) {
      expect(patterns.some((pattern) => pattern.test(needed)), needed).toBe(false);
    }
  });
});
