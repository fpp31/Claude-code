/**
 * Serving the built client (plain files) over HTTP. No framework: node:http
 * is enough for a handful of static files.
 */

import { existsSync, readFile, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { isInside, realPath } from './paths';

/** The only file types that are ever served, with the Content-Type each one is sent as. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const PLAIN_TEXT = 'text/plain; charset=utf-8';

/** Shown instead of the page while packages/client/dist does not exist. */
const NOT_BUILT_HINT =
  'The game page has not been built yet. Run "npm run build" first, then reload this page.\n';

/**
 * Returns a request handler for http.createServer.
 *
 *  - GET /healthz answers 200 "ok" (used by tests and by people checking
 *    that the server is up).
 *  - GET / (with or without a query such as /?g=K7QXM) serves index.html.
 *  - Any other GET serves the matching file under `clientDir` with a
 *    sensible Content-Type, or answers 404. ONLY these file types are ever
 *    served: .html .js .css .json .svg .png .ico .woff2 .map. Everything
 *    else is 404, and so is any path with a part that starts with a dot
 *    (.env, .git/...).
 *  - PATH TRAVERSAL GUARD: decode the URL path, resolve it against
 *    `clientDir`, and refuse (404) anything that ends up outside it.
 *  - Other methods answer 405 (HEAD included).
 *  - index.html is sent with "Cache-Control: no-cache" so players get new
 *    versions; files under /assets/ (their names contain a content hash)
 *    may be cached for a long time.
 *  - If `clientDir` does not exist (the client was not built), GET / answers
 *    a short plain-text hint: run "npm run build" first (status 503).
 *  - Every answer carries "X-Content-Type-Options: nosniff", and a link
 *    inside `clientDir` that points to a file outside it is answered 404.
 *
 * @param clientDir  absolute path of the built client (ServerConfig.clientDir)
 */
export function createStaticHandler(clientDir: string): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    try {
      handle(clientDir, request, response);
    } catch {
      // Whatever went wrong, the visitor learns nothing about it.
      respond(response, 500, 'Internal server error\n');
    }
  };
}

function handle(clientDir: string, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    respond(response, 405, 'Method not allowed\n');
    return;
  }

  const urlPath = decodedPath(request.url ?? '/');
  if (urlPath === null) {
    respond(response, 404, 'Not found\n');
    return;
  }
  if (urlPath === '/healthz') {
    respond(response, 200, 'ok');
    return;
  }

  const isIndex = urlPath === '/';
  const file = isIndex ? join(clientDir, 'index.html') : fileFor(clientDir, urlPath);
  if (file === null || !isFileInside(clientDir, file)) {
    if (isIndex) respond(response, 503, NOT_BUILT_HINT);
    else respond(response, 404, 'Not found\n');
    return;
  }

  readFile(file, (error, content) => {
    if (error) {
      respond(response, 404, 'Not found\n');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()],
      'Content-Length': content.length,
      'Cache-Control': cacheControlFor(urlPath),
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  });
}

/**
 * The path part of a request URL, decoded ("%20" -> " "), or null if it is
 * not something this server answers: an address that does not start with
 * "/", a broken %-code, or a NUL character.
 */
function decodedPath(url: string): string | null {
  if (!url.startsWith('/')) return null;
  const rawPath = url.split(/[?#]/, 1)[0];
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  return path.includes('\0') ? null : path;
}

/**
 * The file under `clientDir` that a URL path names, or null if that path is
 * never served. This is the PATH TRAVERSAL GUARD, in three layers:
 *  1. the decoded path is cut into its parts, and a part that is empty,
 *     starts with a dot (which covers ".." and dot-files) or contains a
 *     backslash or a colon (path separators and drive letters on Windows)
 *     refuses the whole request;
 *  2. only the listed file types are served;
 *  3. the joined result must still lie inside `clientDir`.
 * (isFileInside adds a fourth: a link inside the folder must not point out of it.)
 */
function fileFor(clientDir: string, urlPath: string): string | null {
  const parts = urlPath.slice(1).split('/');
  for (const part of parts) {
    if (part === '' || part.startsWith('.') || part.includes('\\') || part.includes(':')) return null;
  }
  if (CONTENT_TYPES[extname(urlPath).toLowerCase()] === undefined) return null;

  const file = join(clientDir, ...parts);
  return isInside(clientDir, file) ? file : null;
}

/** True if `file` exists, is a plain file, and really (links followed) lies inside `clientDir`. */
function isFileInside(clientDir: string, file: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  return isInside(realPath(clientDir), realPath(file));
}

function cacheControlFor(urlPath: string): string {
  // Vite puts a hash of the contents into every file name under /assets/,
  // so such a file never changes and may be kept for a year.
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // Everything else (above all index.html) is checked with the server each time.
  return 'no-cache';
}

function respond(response: ServerResponse, status: number, text: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, {
    'Content-Type': PLAIN_TEXT,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}
