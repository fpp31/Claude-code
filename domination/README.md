# Domination

An original, multiplayer-first, turn-based strategy game on a hex map: explore, found cities, grow an empire, and play it with friends in a web browser. Everybody takes their turn at the same time, and a game can be played live in an evening or slowly over days.

**Where the project stands:** this is the *scaffold* of phase 1. The structure, the rules of how the parts talk to each other, the data tables and the foundations (hex-grid maths, seeded random numbers) are finished and tested. The game itself (map generation, rules, server, screens, map drawing) is being filled in next, in five work packages. Until then, starting the game shows a "not implemented" message.

## What you need

- [Node.js](https://nodejs.org) version 22 or newer (it includes `npm`).
- A terminal opened in this folder.

## Install

```
npm install
```

Do this once, and again whenever `package.json` changes. It downloads the tools the project uses into `node_modules/`.

## Run it while developing

```
npm run dev
```

Then open <http://localhost:5173>. This starts the game server and a development web server together; the page reloads by itself when a file changes. Stop it with `Ctrl+C`.

Open <http://localhost:5173/?demo> to see the game screen with sample data and no server (once the client is built). <http://localhost:5173/dev-map.html> shows only the map with sample data, for working on how it is drawn.

**Trying several players on one computer.** All tabs of one browser are the same player (the browser remembers who you are). To be a second player, open the page in another tab with `?profile=2` in the address, for example `http://localhost:5173/?profile=2` (then `?profile=3`, and so on). A private window or a second browser works too.

**Two people developing on one machine** can use different ports: `PORT=8801 DEV_PORT=5201 npm run dev` (`PORT` is the game server, `DEV_PORT` the development page).

## Run it to play with friends

```
npm run build
npm start
```

Then open <http://localhost:8787>. One program serves both the web page and the game. Create a game, and send your friends the link it shows (it ends in `?g=` and a five-letter code).

- On a hosting service, install with the plain `npm install` (not `--omit=dev` or "production only"): `npm run build` needs the development tools.
- Friends on the same network use your computer's address instead of `localhost`, for example `http://192.168.1.20:8787/?g=K7QXM`.
- To play over the internet, put the server behind something that adds HTTPS (for example the Caddy web server). Without it, the secret that identifies each player travels unprotected.

## Test it

| Command | What it does |
|---|---|
| `npm test` | Runs all unit tests. Entries marked "todo" are tests still to be written by the work packages. |
| `npm run typecheck` | Checks the whole code base for type mistakes without running it. |
| `npm run e2e` | Runs the end-to-end test: two real browsers play a first turn together. Needs `npm run build` first, and [Playwright](https://playwright.dev), which `npm install` does not fetch: install it separately and set the `PLAYWRIGHT_PATH` environment variable to its folder. |

## Saved games

The server saves every game to disk after every accepted action, so closing the browser, losing the connection or restarting the server loses nothing.

- Saves live in the `data/` folder next to this file, one file per game: `data/rooms/K7QXM.json`.
- **Back up** by copying the `data/` folder. **Restore** by copying it back while the server is stopped.
- A save that cannot be read is moved aside (`.corrupt`), never deleted, and the server still starts.
- A save made by a newer version of the game than the one running (or by one so old that it cannot be converted) is left untouched and not loaded; the server says so when it starts. Run the matching version of the code and the game is back.

**A player lost their seat** (new phone, cleared browser data, another browser): the game cannot tell them apart from a stranger, and a running game waits for that seat every turn. The person who runs the server can free the seat:

1. Stop the server.
2. Open the game's file, for example `data/rooms/K7QXM.json`, in a text editor. Find the player under `"seats"` (by `"name"`) and change that seat's `"tokenHash": "..."` to `"tokenHash": null`.
3. Start the server. The player opens the game's link, types a name and presses Join: they are back on their old seat. (Until they do, the first person without a seat who joins gets it, so tell them promptly.)

## Settings

Settings are environment variables, given when starting the server, for example `PORT=9000 npm start`.

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Port of the web page and the game | `8787` |
| `HOST` | Network interface to listen on | all |
| `DOMINATION_DATA_DIR` | Folder for saved games | `data/` in this folder |
| `DOMINATION_FULL_SYNC` | Set to `1` to send whole views instead of small updates (a safety switch) | off |
| `DOMINATION_SEED` | Same map every time; **for tests only**. Never set it on a real server: every game would have the same map, and whoever has played once knows it all | random |

## Where things live

```
domination/
  README.md            this file
  ARCHITECTURE.md      how the project is designed, and who builds what
  package.json         the list of tools and the commands above
  docs/art/            the approved art style (reference picture)
  scripts/dev.mjs      what "npm run dev" runs
  e2e/                 the end-to-end test
  packages/
    shared/            THE RULES OF THE GAME. Used by both server and client.
      src/data/          every number of the game: terrain, units, civilizations, balance
      src/hex.ts         hex-grid maths
      src/rng.ts         seeded random numbers
      src/mapgen/        map generation
      src/rules/         moving, cities, turns
      src/view/          fog of war: what each player is allowed to see
      src/protocol.ts    the messages between browser and server
    server/            the game server (keeps the truth, saves games)
    client/            the web page (map drawing, panels, input)
  data/                saved games (created by the server; not in git)
```

**Changing the game's numbers:** movement costs, yields, unit costs, city rules, map sizes, colours and city names are plain tables in `packages/shared/src/data/`. Edit a number, run `npm test`, restart the server. Running games use the new numbers too.

## Good to know (phase 1 limits)

- **Up to 6 players** for now: civilizations are unique per game and there are six. The game is laid out for 8.
- **Everybody is waited for.** A turn ends when every player has pressed End Turn; an absent player holds the game up. Turn timers come in a later phase.
- **Check the lobby before you start.** Every seat in the lobby becomes a player, also one whose owner has closed the page ("not connected"), and the game then waits for that seat every turn. The host is warned before starting. A seat can only be given up by its own player (the Leave button); if a seat is stuck in the lobby, make a new game.
- **Opening an invite link does not join.** It shows the game's code with a Join button; only pressing Join takes a seat. Coming back to a game you are already in needs no button.
- **Your seat lives in your browser.** There are no accounts: the browser remembers a secret that identifies you. Clearing the browser's site data, or switching to another browser or device, loses the seat (see "A player lost their seat" above for the rescue).
- **Moving this folder is fine.** Nothing inside refers to where the folder is; move or rename it, then run `npm install` again if the tools complain.
