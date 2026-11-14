import { defineConfig } from 'vite';

/**
 * Vite builds the client and runs it during development.
 *
 * Development (`npm run dev` at the project root): Vite serves the page on
 * http://localhost:5173 with live reload, and passes the WebSocket path /ws
 * on to the game server, so the client code can always connect to "/ws on
 * the host the page came from", in development and in production.
 *
 * Production (`npm run build`): the finished static files land in ./dist
 * and the game server itself serves them.
 *
 * Ports. Both come from environment variables, so that several people (or
 * several copies of the project) can run a development setup on one machine
 * without editing this file:
 *   PORT       the game server's port, default 8787 (the server reads the same variable)
 *   DEV_PORT   the port of this development web server, default 5173
 * For example: PORT=8801 DEV_PORT=5201 npm run dev
 * `strictPort` makes Vite stop with a clear message if the port is taken,
 * instead of quietly moving to another one.
 */
const serverPort = process.env.PORT ?? '8787';
const devPort = Number(process.env.DEV_PORT ?? '5173');

export default defineConfig({
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
