// The environment variables `npm run dev` gives to the two programs it starts.
// Kept apart from dev.mjs, which starts programs the moment it is loaded, so
// that a test can ask this question without starting anything.

import { join } from 'node:path';

/** The folder, inside the project, where the development server keeps its saved games. */
export const DEV_DATA_FOLDER = 'data-dev';

/**
 * Everything is passed on as it is, with one addition: unless
 * DOMINATION_DATA_DIR is set, the development server saves its games in
 * `data-dev/` and not in `data/`, the folder of `npm start`.
 *
 * Two servers must never share a data folder. Each keeps its games in
 * memory and writes whole files, so each would silently write over what the
 * other saved. With one folder for both commands, trying out a change with
 * `npm run dev` on the machine that hosts the real games would destroy them.
 *
 * @param {Record<string, string | undefined>} env  the variables this program was started with
 * @param {string} projectRoot                      absolute path of the project folder
 * @returns {Record<string, string | undefined>}
 */
export function devEnvironment(env, projectRoot) {
  const given = env.DOMINATION_DATA_DIR;
  if (given !== undefined && given !== '') return { ...env };
  return { ...env, DOMINATION_DATA_DIR: join(projectRoot, DEV_DATA_FOLDER) };
}
