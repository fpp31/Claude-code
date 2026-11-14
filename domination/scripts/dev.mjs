// Development mode: `npm run dev` runs this file.
//
// It starts two programs side by side and stops both together:
//   1. the game server (restarts by itself when a server or shared file changes),
//   2. Vite, which serves the client with live reload on http://localhost:5173
//      and passes the WebSocket on to the game server (see packages/client/vite.config.ts).
//
// Ports can be changed with environment variables, for example when two
// people work on one machine:  PORT=8801 DEV_PORT=5201 npm run dev
//   PORT       the game server (default 8787)
//   DEV_PORT   the Vite page (default 5173)
// Both programs inherit the variables from this one, plus one: the games of
// the development server are saved in data-dev/, not in data/ where
// `npm start` keeps the real ones (see devEnv.mjs for why). Setting
// DOMINATION_DATA_DIR yourself overrides that.
//
// Stop with Ctrl+C.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devEnvironment } from './devEnv.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Both tools are started as "node <the tool's own JavaScript file>", not
// through the little launcher scripts in node_modules/.bin. That works the
// same on Windows, macOS and Linux, and it does not break when the project
// folder has a space in its path (C:\Users\First Last\...).
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const env = devEnvironment(process.env, projectRoot);

const children = [];
let stopping = false;

function start(label, script, args, cwd) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: 'inherit' });
  child.on('error', (error) => {
    console.log(`[dev] could not start the ${label}: ${error.message}. Did you run "npm install"?`);
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`[dev] ${label} stopped (exit code ${code ?? 'none'}); stopping the rest.`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  // Give the children a moment to shut down, then leave.
  setTimeout(() => process.exit(exitCode), 300);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('server', tsxCli, ['watch', join('packages', 'server', 'src', 'main.ts')], projectRoot);
start('client', viteCli, [], join(projectRoot, 'packages', 'client'));
