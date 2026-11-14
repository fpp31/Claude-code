/**
 * Two small questions about folders, asked wherever the server must be sure
 * that one thing does not lie inside another: the web server never hands out
 * a file from outside the client folder, and the saved games never live
 * inside it.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** True if `path` is `folder` itself or lies inside it. Both must be absolute paths. */
export function isInside(folder: string, path: string): boolean {
  const fromFolder = relative(folder, path);
  if (fromFolder === '') return true;
  // Outside means: the way from the folder to the path starts by going up,
  // or (on Windows) the path is on another drive altogether.
  return !isAbsolute(fromFolder) && fromFolder !== '..' && !fromFolder.startsWith(`..${sep}`);
}

/**
 * The real location of a path, with links followed. A path that does not
 * exist (yet) is returned as it is, made absolute.
 */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
