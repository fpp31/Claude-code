# Domination

An original, multiplayer-first, turn-based strategy game on a hex map: explore, found cities, grow an empire, and play it with friends in a web browser. Everybody takes their turn at the same time, and a game can be played live in an evening or slowly over days.

![The game screen: a hex map with cities, borders, units and fog of war](docs/screenshots/game.png)

*Turn 23 of a three-player game, as the Maya player sees it: her cities Copan and Tikal, Rome and Egypt next door, and darker land she has explored but cannot see right now.*

**Where the project stands:** phase 1 is finished and playable. You can create a private game, invite friends with a link, pick one of six civilizations, and play on a freshly generated map: move Warriors, Scouts and Settlers, found cities, choose what each city builds, and watch cities grow. Everybody sees only what their own units and cities can see (fog of war). Games are saved after every move and survive a closed browser or a restarted server. There is no fighting, research or winning yet: those come in later phases (see "Good to know" at the end).

## What you need

- [Node.js](https://nodejs.org) version 22.12 or newer (it includes `npm`).
- A terminal opened in this folder.

## Install

```
npm install
```

Do this once, and again whenever `package.json` changes. It downloads the tools the project uses into `node_modules/`.

## Run it to play with friends

```
npm run build
npm start
```

Then open <http://localhost:8787> to try it yourself. One program serves both the web page and the game. Type your name and press "Create private game"; the lobby shows a link for your friends (it ends in `?g=` and a five-character code). When everyone is in the lobby, the player who created the game presses "Start game". Stop the server with `Ctrl+C`; the games are kept (see "Saved games").

![The lobby: the link to send, the players, the six civilizations and the map size](docs/screenshots/lobby.png)

*The lobby of a game with three players, opened through the computer's network address, so the link it shows is ready to send.*

- **Before you send the link, open the page through an address your friends can reach.** `localhost` means "this computer" on every computer, so a link that starts with `http://localhost` only works on yours (the lobby warns you when it shows such a link). On the same network, use your computer's address instead, for example `http://192.168.1.20:8787`; on a hosting service, the server's address. The link the lobby shows is built from the address you opened the page with, so opened that way it is ready to send, for example `http://192.168.1.20:8787/?g=K7QXM`.
- Run `npm run build` again whenever the code has changed. `npm start` serves what the last build made.
- On a hosting service, install with the plain `npm install` (not `--omit=dev` or "production only"): `npm run build` needs the development tools.
- To play over the internet, put the server behind something that adds HTTPS (for example the Caddy web server). Without it, the secret that identifies each player travels unprotected.
- **Keeping it running on a server.** `npm start` is meant for a terminal that stays open and is stopped with `Ctrl+C`. To leave the server running in the background, start it without npm, from this folder: `node --import tsx packages/server/src/main.ts`. That is one program, and stopping it (`kill` and its process number) stops the server cleanly. Started as `npm start` in the background, stopping npm leaves the real server running. A service manager that stops the whole group of processes is fine too. After stopping, the address should no longer answer; if the next start says the port is in use (`EADDRINUSE`), an old server is still running.

**How to play, in short.** Tap one of your units to select it; the tiles it can reach light up; tap one to go there. When two of your units share a tile (as at the start), tap the tile again for the other one; the same goes for a city with a unit standing in it (the unit's panel says so). Select your Settler and press "Found City". Tap a city to choose what it builds. A new game shows a short "First steps" note until you have founded your first city. While a unit is selected, a tap on a highlighted tile always sends it there, also when one of your cities or other units is on that tile: close the unit's panel first (the × button, or `Esc`) if you meant to select that instead. Drag the map to scroll; zoom with the mouse wheel, the + and - buttons, or two fingers on a touch screen. When you are done, press "End Turn"; the next turn starts when every player has. The button says how many units can still move, and "Show me" takes you to the next one. Keys: `Enter` end turn, `N` next unit, `F` found city, `Esc` close a panel, arrow keys or `W` `A` `S` `D` scroll, `+` and `-` zoom.

## Run it while developing

```
npm run dev
```

Then open <http://localhost:5173>. This starts the game server and a development web server together; the page reloads by itself when a file changes. Stop it with `Ctrl+C`.

The development server keeps its games in `data-dev/`, not in `data/`, so trying something out never touches the games you host with `npm start`, even on the same computer.

Pages that only exist in this mode, for looking at one thing at a time:

| Address | What it shows |
|---|---|
| <http://localhost:5173/?demo> | The game screen with sample data and no server. `?demo=lobby` shows the lobby, `?demo=home` the first screen. (This one also works on the built game.) |
| <http://localhost:5173/dev-map.html> | Only the map, with sample data: for working on how it is drawn. |
| <http://localhost:5173/sprites.html> | Every picture of the game, enlarged. |
| <http://localhost:5173/src/dev/big-map.html> | A made-up map of the largest size with a read-out of how long a frame takes. |

**Trying several players on one computer.** All tabs of one browser are the same player (the browser remembers who you are). To be a second player, open the page in another tab with `?profile=2` in the address, for example `http://localhost:5173/?profile=2` (then `?profile=3`, and so on). A private window or a second browser works too.

**Two people developing on one machine** give the second setup its own ports and its own folder for saved games: `PORT=8801 DEV_PORT=5201 DOMINATION_DATA_DIR=data-dev-2 npm run dev` (`PORT` is the game server, `DEV_PORT` the development page).

## Test it

| Command | What it does |
|---|---|
| `npm test` | Runs all unit tests (about 870; it takes well under a minute). None is skipped. |
| `npm run typecheck` | Checks the whole code base for type mistakes without running it. |
| `npm run e2e` | Runs the end-to-end test: two real browsers create a game, join, play a first turn, reload, and come back after the server was restarted. It then checks three things about the screen that once went wrong (what a stranger sees who opens the link of a running game, the city panel in a low window as on a phone held sideways, and the top bar with very long player names) and five small ones: a damaged link, the lobby's warning about a `localhost` link, a double-click on Start or Leave, the Enter key after a click on a zoom button, and the "Turn 3 has begun." message. It uses its own server and its own throw-away folder for saved games. Needs `npm run build` first, and [Playwright](https://playwright.dev), which `npm install` does not fetch: install it separately and set the `PLAYWRIGHT_PATH` environment variable to its folder. |

## Saved games

The server saves every game to disk after every accepted action, so closing the browser, losing the connection or restarting the server loses nothing.

- Saves live in the `data/` folder next to this file, one file per game: `data/rooms/K7QXM.json`.
- **Back up** by copying the `data/` folder. **Restore** by copying it back while the server is stopped.
- **Never run two servers on the same folder of saved games** (for example `npm start` twice with different ports). Each keeps its games in memory and writes whole files, so each would silently write over what the other saved. Nothing checks this for you. (`npm run dev` has its own folder, `data-dev/`, for this reason.)
- If the disk is full, a move cannot be saved: the player is told "The server had a problem. Please try again.", the server prints "saving failed", and the last complete save stays as it is. Make room and play on.
- A save that cannot be read is moved aside (`.corrupt`), never deleted, and the server still starts.
- A save made by a newer version of the game than the one running is left untouched and not loaded; the server says so when it starts. Run the matching version of the code and the game is back.
- A game that was created but never started (its creator closed the page without pressing Leave) stays in the folder as a small file. Deleting such a file while the server is stopped is safe.

**A player lost their seat** (new phone, cleared browser data, another browser): the game cannot tell them apart from a stranger, and a running game waits for that seat every turn. The person who runs the server can free the seat:

1. Stop the server.
2. Open the game's file, for example `data/rooms/K7QXM.json`, in a text editor. Near the top, under `"seats"`, every player has one line. Find the player's line (by `"name"`) and change its `"tokenHash": "..."` to `"tokenHash": null`. Change nothing else: a seat's line cannot be deleted, and its `"playerId"` must stay as it is (the server would set such a file aside at the next start and say why).
3. Start the server. The player opens the game's link, types a name and presses Join: they are back on their old seat, with its old name.

Two things to know about a freed seat:

- **It goes to the first browser without a seat in this game that opens the link and presses Join.** That need not be a stranger: it can be another player of the same game on a second device or in another browser, who would then see and play that side. So free the seat when the returning player is ready to press Join at once (stay on a call with them), and ask them to confirm that they are in. The server prints a line when the seat is taken. If the wrong person got it, do the three steps again.
- **Free one seat at a time.** If two players lost their seats, do the steps for one, wait until that player is back, then for the other. Two free seats are handed out in the order people join, whatever names they type, so two players could end up on each other's side.

## Settings

Settings are environment variables, given when starting the server, for example `PORT=9000 npm start`.

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Port of the web page and the game | `8787` |
| `HOST` | Network interface to listen on | all |
| `DOMINATION_DATA_DIR` | Folder for saved games. Never the same folder for two servers | `data/` in this folder (`data-dev/` with `npm run dev`) |
| `DOMINATION_CLIENT_DIR` | Folder of the built web page. It must not contain the folder for saved games | `packages/client/dist/` in this folder |
| `DOMINATION_FULL_SYNC` | Set to `1` to send whole views instead of small updates (a safety switch) | off |
| `DOMINATION_SEED` | Same map every time; **for tests only**. Never set it on a real server: every game would have the same map, and whoever has played once knows it all | random |
| `DEV_PORT` | Only for `npm run dev`: port of the development page | `5173` |

## Where things live

```
domination/
  README.md            this file
  ARCHITECTURE.md      how the project is designed, and which file does what
  package.json         the list of tools and the commands above
  docs/art/            the approved art style (reference picture)
  docs/screenshots/    pictures of the game for this file
  scripts/dev.mjs      what "npm run dev" runs (devEnv.mjs next to it: where it keeps its saved games)
  e2e/                 the end-to-end test
  packages/
    shared/            THE RULES OF THE GAME. Used by both server and client.
      src/data/          every number of the game: terrain, units, civilizations, balance
      src/hex.ts         hex-grid maths
      src/rng.ts         seeded random numbers
      src/mapgen/        map generation (tuning.ts: the numbers that shape the maps)
      src/rules/         moving, cities, turns
      src/view/          fog of war: what each player is allowed to see
      src/protocol.ts    the messages between browser and server
      test/              the tests of all of the above
    server/            the game server (keeps the truth, saves games)
    client/            the web page (map drawing, panels, input)
      src/sprites/art/   the pictures, drawn as text
      dist/              the built page (made by "npm run build"; not in git)
  data/                saved games (created by the server; not in git)
  data-dev/            saved games of "npm run dev" (created by it; not in git)
```

**Changing the game's numbers:** movement costs, yields, unit costs, city rules, map sizes, colours and city names are plain tables in `packages/shared/src/data/`. Edit a number, run `npm test`, run `npm run build`, restart the server, and ask players to reload the page: the page works out the highlighted tiles with its own copy of the numbers, and a page built before the change would highlight by the old ones. (With `npm run dev` neither the build nor the restart is needed.) Running games use the new numbers too. Some tests guard how the numbers hang together, and their messages say what does not fit. Many more are simply written for today's numbers (a Warrior that walks two tiles of grassland, say): after a deliberate change such a test fails although nothing is wrong, and its expectation is what has to change.

**Changing what maps look like:** the share of land, the size of mountain ranges, forests and deserts, and how start positions are chosen are numbers in `packages/shared/src/mapgen/tuning.ts`. They only affect games started afterwards: a running game keeps its map.

## Good to know (phase 1 limits)

- **No fighting yet.** Units of different players cannot attack or pass through each other; they simply block the way. Combat, research, buildings and a way to win come in later phases.
- **Up to 6 players** for now: civilizations are unique per game and there are six. The game is laid out for 8.
- **Map sizes show a recommended number of players.** More players than that can start, but their starting land is less evenly matched and they begin closer together: now and then a tile closer than the usual eight, because nobody is put alone on a small island while the larger land has room. On a rare map one or two players start on a second landmass, which land units cannot leave.
- **Everybody is waited for.** A turn ends when every player has pressed End Turn; an absent player holds the game up. Turn timers come in a later phase.
- **Check the lobby before you start.** Every seat in the lobby becomes a player, also one whose owner has closed the page ("not connected"), and the game then waits for that seat every turn. The host is warned before starting. A seat can only be given up by its own player (the Leave button); if a seat is stuck in the lobby, make a new game.
- **Only the host can start.** If the host presses Leave, the next player who is connected becomes host. If the host only closes the page, they stay host, and the lobby waits for them to come back.
- **Opening an invite link does not join.** It shows the game's code with a Join button; only pressing Join takes a seat. Coming back to a game you are already in needs no button. If the game has already started, is full or does not exist, the page says so under the code and offers to start a new game instead. A link that was damaged on its way (cut short, or with a full stop stuck to its end) is called damaged; the code can then be typed by hand.
- **A running game has no Leave button.** To get back to the first screen, open the page without the `?g=...` part of the address. Your seat in the game is kept.
- **Your seat lives in your browser.** There are no accounts: the browser remembers a secret that identifies you. Clearing the browser's site data, or switching to another browser or device, loses the seat (see "A player lost their seat" above for the rescue). One known gap: on a browser's very first visit, two tabs opened in the same instant can each be given a secret of their own, and only one of them is remembered. Open the game in one tab first.
- **Meant for friends, not for strangers.** Anybody who can open the page can create games, and there is no limit on how many. Share the address only with people you trust, or keep the server on your home network.
- **Tried in one browser only.** The end-to-end test plays in Chromium (the engine of Chrome and Edge) in a laptop-sized window, and the game was played by hand in a phone-sized touch window of the same browser, upright and on its side. Firefox, Safari and real phones have not been tried yet. The mouse, the wheel and the fingers were simulated by the test programs: a real mouse wheel and a laptop trackpad have not been tried either. If the wheel zooms too much or too little on your computer, the + and - buttons and keys always move exactly one step.
- **Small windows.** The game is laid out for a laptop screen and for a phone held upright. A phone on its side works too, but it is cramped: the panels float over the map and scroll inside themselves, and a city you select can end up behind its own panel. Drag the map to bring it out.
- **Moving this folder is fine.** Nothing inside refers to where the folder is; move or rename it, then run `npm install` again if the tools complain.
