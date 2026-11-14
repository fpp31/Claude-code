/**
 * Entry point of the server: `npm start` (or `npm run dev`) runs this file.
 *
 * It only wires things together: read the settings, start the server, and
 * shut down cleanly when asked to stop (Ctrl+C).
 */

import { loadConfig } from './config';
import { startServer } from './server';

const config = loadConfig(process.env);
const server = await startServer({ config });

console.log(`Domination server running: http://localhost:${server.port}`);
console.log(`Saved games are kept in: ${config.dataDir}`);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  console.log('Stopping the server...');
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
