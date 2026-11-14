/**
 * Serving the built client (plain files) over HTTP. No framework: node:http
 * is enough for a handful of static files.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

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
 *  - Other methods answer 405.
 *  - index.html is sent with "Cache-Control: no-cache" so players get new
 *    versions; files under /assets/ (their names contain a content hash)
 *    may be cached for a long time.
 *  - If `clientDir` does not exist (the client was not built), GET / answers
 *    a short plain-text hint: run "npm run build" first.
 *
 * @param clientDir  absolute path of the built client (ServerConfig.clientDir)
 */
export function createStaticHandler(clientDir: string): (request: IncomingMessage, response: ServerResponse) => void {
  throw new Error('not implemented: createStaticHandler');
}
