# Domination: architecture (phase 1)

This file is the map of the project. The precise contracts live in the code as types and doc comments; where this file and a doc comment disagree, the doc comment wins and this file should be fixed.

## 1. The design in one page

Three packages in one npm workspace, all TypeScript, strict mode, ES modules:

| Package | What it is | May use |
|---|---|---|
| `packages/shared` | The rules of the game, the data tables and the message types. Pure and deterministic. | Nothing: no Node, no browser, no clock, no built-in random |
| `packages/server` | One Node process: keeps the truth, validates, saves, sends each player their view. | Node, `ws`, `shared` |
| `packages/client` | A plain static web app: Canvas 2D map plus DOM panels. | Browser, `shared` |

The ideas everything else follows from:

1. **The server is authoritative.** Clients send wishes (actions). The server asks the shared rules engine, saves, and tells each player what they may see.
2. **One gate.** A game state changes only through `applyAction` (a player did something) and `resolveTurn` (the turn ended), both in `shared`.
3. **One filter.** Everything a client learns about a game comes from `buildPlayerView` and `filterEvents`, or is a diff of two views. Views are built by allow-list, from scratch.
4. **The saved file is the truth.** The rules never edit the state they are given; they return a new one. The server first works out everything it is going to send (so a failure there stops the change before it exists), then saves the new state, adopts it only if the save succeeded, and only then sends. Disk is never behind what a client was told, and nobody is told "rejected" about something that was saved.
5. **The client shows the last view it was sent.** No prediction, no resending. After any hiccup a full view puts it right.

## 2. Final design decisions

**Rules engine (`shared`)**

- State is plain JSON (`types.ts`). Positions are always a `TileIndex`; `{x, y}` coordinates exist only inside `hex.ts` and the renderer.
- A tile is `terrain` (ocean, coast, grassland, plains, desert) + optional `feature` (forest, hills, mountains) + owning `cityId`. A feature's numbers *replace* the ground's. Rules read tiles only through `tileMoveCost`, `tileYields`, `tileIsWorkable`, `tileAllowsCity`.
- Territory has one source of truth: `tile.cityId`. Worked tiles and yields are derived by `cityEconomy`, never stored.
- `applyAction(state, playerId, turn, action)` validates fully, then works on a copy. Every action carries the turn it was issued in (`staleTurn`). Accepted no-ops are reported with `changed: false`. "Not yours" and "does not exist" share one error code.
- A move carries the path the client chose from its own view. The server walks it one step at a time on the truth, refreshing sight after each step, and stops before the first illegal step. The server never path-finds, so a route cannot give hidden things away.
- One movement implementation behind the small `Board` interface (`boardFromState` on the server, `boardFromView` on the client), so the reachable-tile highlight matches what the server accepts.
- Turns are simultaneous. The turn resolves inside the `endTurn` action that makes everybody ready (same call, same save). `resolveTurn` is a short list of named steps.
- Randomness: one seed string, several independent streams (`seedRng(seed, stream)`): the map, gameplay dice (unused in phase 1), and one id stream per player.
- Unit and city ids are random, per player (`u3_k7m2qd`), so the ids a player sees depend only on their own actions.
- Fog of war: visible = within sight of own units, plus own territory and one ring around it. Explored tiles and last-seen owners/cities are remembered per player *on the server*, inside the game state.
- Events (`GameEvent`) are cosmetic news for toasts. The engine hands out every event together with its audience (`AddressedEvent`: `to` is a list of players or `'all'`); `filterEvents` picks one player's events and drops the audience lists, which never leave the server. Phase 1 addresses a player's events to that player only, plus `turnStarted` to all. The client must work if events are ignored.
- Cities are named from their civilization's list in founding order. That makes "how many cities has this player founded" readable from a city's name, which is accepted and written down as a public fact (`protocol.ts`).
- A city's view says why a finished item is not appearing (`productionBlocked`: needs population, or no free tile); one function (`productionBlocked` in `rules/city.ts`) serves both turn resolution and the view.
- Start positions come with hard guarantees (distinct, legal city sites, at least `minCityDistance` apart, room to walk) and stronger ones when the map is not crowded (distance, one landmass, fairness within 70%); the generator retries with the next attempt stream until they hold.
- All balance numbers live in `shared/src/data/`. Table tests guard the relationships fog and rules rely on (for example: a settler sees far enough that "too close to a city" reveals nothing).

**Server**

- One process, one port: `node:http` serves the built client and upgrades `/ws` to a `ws` WebSocket. Each message is handled synchronously from start to finish: no queues, no locks.
- The commit rule, for every change to a room (lobby or game): **prepare** (build the next file and every message; pure, so an exception here means nothing happened), **save** (temp file, fsync, rename), **adopt and send** (cannot fail: sending never throws). For an action that is: rules, then every seat's view and each socket's update, then save, then adopt, then send, then `actionOk` to the sender. A player whose view did not change receives nothing. A failure before the save answers the actor `actionRejected serverError` and changes nothing.
- A client is never shown the text of an exception: every `serverError` carries the one constant sentence `SERVER_ERROR_MESSAGE`; details go to the server log.
- One JSON file per game (`data/rooms/CODE.json`), rewritten atomically after every accepted change. All games are loaded before the server starts listening.
- Identity: the server issues a random token; the browser keeps it in localStorage; a seat stores only its SHA-256. A game is joined by a five-character code. `joinGame` is also the reconnect message: sent with `name: null` it only brings a player back to a seat they have; taking a seat needs a name, that is, the Join button. A seat whose stored hash is `null` is unclaimed and goes to the next player who joins (the manual rescue for a lost token; later the hook for empty and AI seats).
- A socket is attached to at most one room. Joining another game detaches it from the old one only after the join succeeded, and never gives up the old seat; only `leaveGame` does. The room is the authority on which sockets it holds.
- Per socket: its own `seq` counter (plus one for every `gameSync` and `gameUpdate` sent on it) and last-sent view. Full `gameSync` on attach and on `resync`, `gameUpdate` patches afterwards. `DOMINATION_FULL_SYNC=1` turns patches off.
- Liveness survives background tabs, whose timers run about once a minute: the client pings every 25 s and gives up only if nothing arrives within 10 s after a ping (never on a late timer alone); the server drops a socket after 150 s of silence.
- A save from another version of the game (newer file format, or a game-state layout it cannot migrate) is left untouched on disk and not loaded; its code stays reserved.
- Start-up refuses a data folder inside the public client folder, and warns loudly about a fixed seed.
- The server reaches the rules only through the `Rules` bundle (`server/src/rules.ts`); tests can pass a fake.
- No absolute paths: defaults are resolved from the source file location to the project root.

**Client**

- No UI framework. Panels are built once and then updated in place (`textContent`, `hidden`, `disabled`), which keeps clicks from being lost when an update arrives mid-press. Names from other players only ever become text nodes.
- One small store holds everything on screen; game data enters it only from server messages. One action in flight at a time (`busy`, set only when a message really went out). One question, `canActNow`, decides both whether reachable tiles are highlighted and whether a tap moves the unit.
- `net/identity.ts` is the only place that touches localStorage, the address bar and page reloads, and it works (as a no-op) where they do not exist, so the app logic is tested in plain Node. The token is also kept in memory, so an open page never forgets who it is.
- End Turn and Cancel share one button; the controller ignores presses for 0.6 s after the button's meaning changed, which makes a double-click or a held Enter key harmless.
- The renderer owns canvas, camera and sprites. The app shell owns input events and what they mean. They meet in `render/api.ts`.
- Sprites are authored as text (rows of characters with a small palette and reserved owner-colour characters) and rasterised at start-up behind the `SpriteSheet` interface, so PNG sheets can replace them later. No binary assets, no font files.
- All hex shapes (hit test, fog, highlights, borders) derive from `render/geometry.ts`. Zoom is a whole number of device pixels per art pixel.
- The renderer is created on a canvas that is already in the page and measures it at once; without a view its camera calls do nothing (`render/api.ts`). Fog is applied per sprite (a fogged twin), not as a hexagon laid on top, because sprites stick out of their tile.

**Tooling**

- `tsx` runs the server in development and in production; `tsc` only type-checks (`noEmit`). `shared` is consumed as TypeScript source, so there is no build step for it and no `.js` import suffixes.
- Vite builds and serves the client; Vitest runs all tests from the project root. Runtime dependencies: `ws` and `tsx` (both in `dependencies`, so `npm start` works after an install without development tools; building the client still needs them).

## 3. Module map and who owns what

Five work packages build phase 1 at the same time on disjoint files. **WP1** map generation, **WP2** rules + visibility + views, **WP3** server, **WP4** client app shell, **WP5** renderer + sprites + camera. *Scaffold* files are finished or frozen: change them only through the integrator.

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore      scaffold
scripts/dev.mjs                                                      scaffold
e2e/two-players.ts                                                   integrator (after the merge)

packages/shared/src/
  index.ts              public exports                               scaffold (frozen)
  types.ts              GameState, Tile, Unit, City, PlayerState     scaffold (frozen)
  actions.ts            Action, RuleError, GameEvent, ActionResult   scaffold (frozen)
  viewTypes.ts          PlayerView, ViewPatch and their parts        scaffold (frozen)
  protocol.ts           wire messages, PROTOCOL_VERSION              scaffold (frozen)
  data/                 terrain, units, civs, rules + map sizes      scaffold (numbers may be tuned)
  hex.ts  rng.ts  ids.ts  json.ts                                    scaffold (done, tested)
  view/patch.ts         diffViews, applyViewPatch                    scaffold (done, tested)
  testing/              mapFromAscii, sampleView, sampleLobby,
                        isImplemented                                scaffold (done, tested)
  mapgen/**             generateMap                                  WP1
  rules/**              createGame, applyAction, movement, city,
                        turn, invariants                             WP2
                        (pathTo in movement.ts is already written)
  view/visibility.ts    computeVisible, updateKnowledge              WP2
  view/playerView.ts    buildPlayerView, filterEvents                WP2
packages/shared/test/
  hex, rng, ids, json, tables, patch, fixtures, purity,
  pathTo .test.ts                                                    scaffold
  mapgen*.test.ts                                                    WP1
  everything else (rules*, visibility*, and WP2's own helper
  files for building test states)                                    WP2

packages/server/**      config, server, httpStatic, connection,
                        parseMessage, roomManager, room, roomFile,
                        storage, tokens, rules, main, test/          WP3
                        (test/fakeRules.ts and its data are WP3's own)

packages/client/
  vite.config.ts, tsconfig.json, tsconfig.node.json                  scaffold
  index.html, src/main.ts, src/styles.css                            WP4
  src/ui/**             app, dom, screens, panels, toasts            WP4
  src/ui/testIds.ts     data-testid names (e2e contract)             scaffold (frozen)
  src/net/**            connection, identity                         WP4
  src/state/**          store, serverMessages                        WP4
  src/game/**           controller, selectors                        WP4
  src/input/**          mapInput                                     WP4
  src/debugHook.ts, src/demo.ts                                      WP4
  src/render/api.ts     MapRenderer, MapOverlay (the WP4/WP5 seam)   scaffold (frozen)
  src/render/placeholderRenderer.ts   stand-in renderer (done)       scaffold
  dev-map.html, src/dev/mapHarness.ts   map test page (done)         scaffold
  src/render/**         renderer, camera, geometry (done, tested)    WP5
  src/sprites/**        format, rasterize, spriteSheet, palette,
                        font, art/                                   WP5
  sprites.html, other src/dev/**   optional sprite gallery page      WP5
  test/geometry.test.ts, test/render*.test.ts                        WP5
  test/shell*.test.ts and other client tests                         WP4
```

Every function still to be written has its exact signature and a doc comment describing its behaviour, and a body that throws `not implemented: <name>`. Every test still to be written is listed as `it.todo(...)` in the test files.

**The seams between work packages**

| Between | Contract |
|---|---|
| WP1 -> WP2 | `generateMap(seed, mapSize, playerCount)` returns `{ map, starts }`, with the start-position guarantees H1-H5 in its doc comment. `createGame` takes the generator as an optional second argument, so WP2 tests use hand-drawn maps (`mapFromAscii`). |
| WP2 -> WP3 | The `Rules` bundle: `createGame`, `applyAction`, `buildPlayerView`, `filterEvents`, `checkInvariants`; plus `diffViews`. WP3 tests start with a fake bundle. |
| WP2 -> WP4 | `PlayerView` (render-ready), `reachableTiles(boardFromView(view), unit)`, `pathTo` (already written), `applyViewPatch`. The controller and `overlayFor` take the reach function as an option, so WP4 tests them with a stub. |
| WP3 <-> WP4 | `protocol.ts`, nothing else. |
| WP4 -> WP5 | `createMapRenderer(canvas)` and `render/api.ts`: `setView`, `setOverlay`, `panBy`, `zoomBy`, `centerOn`, `tileAt`, `tileToScreen`, `destroy`, and its two "not ready yet" rules (the canvas is in the page before the renderer is created; without a view the camera calls do nothing). |
| WP4 -> e2e | `ui/testIds.ts` and `window.__domination` (`debugHook.ts`). |
| WP3 -> e2e | `loadConfig(env)` and `startServer({ config })`. |

**Working before the others are done**

- WP2 uses `mapFromAscii` and a hand-made generator; WP3 uses a fake `Rules` (described at the top of `server/test/server.test.ts`).
- WP4 uses `sampleView()`, demo mode (`/?demo`) and the scaffold's stand-in renderer: `createRendererOrPlaceholder(canvas)` gives the real renderer once WP5 has written it and flat-coloured hexagons with real panning, zooming and hit testing until then.
- WP5 uses the map test page `/dev-map.html`, which drives the renderer through the seam with sample data, before WP4's screens exist.
- Code that must call another package's unfinished function catches exactly the scaffold's "not implemented" error (`isNotImplementedError`), nothing wider.
- **Tests that need another work package** are written now and wrapped in `describe.skipIf(!isImplemented(() => ...))` (`isImplemented` is in `@domination/shared/testing`). They are skipped while the other package is a stub and switch themselves on when it lands. After the merge, the integrator checks that no test is still skipped for this reason. Nobody fills in another package's stub to get a test to run.

**Working in parallel**

`npm test` and `npm run typecheck` check the WHOLE project, and the packages are type-checked through each other's source. While five people work at once they can therefore be red because of somebody else's half-written file. The rules:

- Check your own part with the narrow commands below; run the two whole-project commands before handing over.
- **An error in a file you do not own is not yours to fix.** Report it to the integrator and carry on. The same goes for frozen scaffold files: ask, do not edit.
- Never test against the shared `packages/client/dist` (every `npm run build` empties it). Server tests point `config.clientDir` at a temporary folder of their own.
- Use your own ports when running a development setup (table below): `PORT=8801 DEV_PORT=5201 npm run dev`. Server tests always use port 0 (a free port) and a temporary data folder.

| | Tests | Types | `PORT` / `DEV_PORT` |
|---|---|---|---|
| WP1 | `npx vitest run packages/shared/test/mapgen` | `npx tsc -p packages/shared && npx tsc -p packages/shared/test` | not needed |
| WP2 | `npx vitest run packages/shared/test/rules packages/shared/test/visibility` | as WP1 | not needed |
| WP3 | `npx vitest run packages/server` | `npx tsc -p packages/server` | 8803 / 5203 |
| WP4 | `npx vitest run packages/client/test/shell` | `npx tsc -p packages/client` | 8804 / 5204 |
| WP5 | `npx vitest run packages/client/test/geometry packages/client/test/render` | `npx tsc -p packages/client` | 8805 / 5205 |

(The words after `vitest run` are matched against test file paths, so a new file such as `packages/shared/test/rulesCity.test.ts` is picked up by WP2's command.)

## 4. From a click to a redraw

1. The player taps a highlighted tile. `input/mapInput.ts` sees a tap (not a drag), asks `renderer.tileAt(point)` which tile it was, and calls `controller.onTileTap(tile)`.
2. `game/controller.ts` sees a selected unit, that the tile is in `reachableTiles(boardFromView(view), unit)` and that the player may act right now (`canActNow`). It sends `{ type: 'action', requestId, turn, action: { type: 'moveUnit', unitId, path } }` and sets `busy`.
3. On the server, `connection.ts` parses and checks the message (`parseClientMessage`) and hands it to the socket's `Room`.
4. `room.ts` takes the player id from the socket's seat and calls `rules.applyAction(state, playerId, turn, action)`. The rules walk the path on a copy of the state and return the new state plus events.
5. Still without having changed anything, the room builds every player's view of the new state (`buildPlayerView`) and, for every attached socket, the difference to the last view sent on that socket (`diffViews`).
6. The room saves the new state (`storage.save`: temp file, fsync, rename), and only then adopts it. Now it sends each socket its prepared `gameUpdate` (nothing, if that player's view did not change), and then `actionOk` to the sender.
7. In the browser, `net/connection.ts` passes the message to `state/serverMessages.ts`, which checks `seq`, applies the patch (`applyViewPatch`) and puts the new view into the store.
8. Store subscribers run: `ui/gameScreen.ts` calls `renderer.setView(view)` and `renderer.setOverlay(overlayFor(state))`; the panels update their texts.
9. The renderer marks itself dirty and draws the visible tiles on the next animation frame.

If the action is refused, step 4 returns an error, nothing is saved or broadcast, and only the sender gets `actionRejected` (shown as a toast). The same happens, with the code `serverError`, if anything in steps 4 to 6 fails before the state was adopted.

## 5. Conventions

- **Language:** TypeScript strict, ES modules, relative imports without file extensions. Use `import type` for types.
- **Spelling in code** follows the web platform: `color`, `neighbor`, `center`.
- **Style:** plain functions and plain data. Small files with one job. A `switch` on `action.type` with an exhaustive `never` check rather than registries or class hierarchies. Comments explain *why*; doc comments on every export.
- **No new dependencies** without a written reason. Phase 1 needs none beyond `ws` and the tools already installed.
- **Determinism in `shared`:** no clock, no built-in random, no I/O, no logging, and only maths that gives the same result on every machine (`+ - * / %`, `Math.floor/ceil/round/trunc/abs/sign/min/max/sqrt/imul`; no `sin`, `pow`, `**` and the like). Anything order-dependent iterates in a documented order (players in seat order, units and cities in creation order, tiles by index). `test/purity.test.ts` and the package's TypeScript settings enforce this.
- **Errors:** rule violations by players are returned (`RuleError` with a code); programming errors throw. Tests compare codes, never message texts.
- **Never trust the client:** the acting player comes from the socket; every message is shape-checked; names are cleaned on the server and rendered as text on the client.
- **Tests** live in `packages/<name>/test/*.test.ts` and run with `npm test`. Server tests use a real server on port 0 with a temporary data folder and close everything afterwards.
- **Paths:** nothing in the repository contains an absolute path of the project, so the folder can be moved. (One documented exception: the default location of the globally installed Playwright in `e2e/`, overridable with `PLAYWRIGHT_PATH`.)
- **Ports:** server 8787 (`PORT`), Vite dev server 5173 (`DEV_PORT`); the Vite proxy follows `PORT`.
- **"Not implemented"** is spelled exactly `throw new Error('not implemented: <name>')` in every stub, so that `isImplemented` / `isNotImplementedError` can recognise it.

## 6. Points settled while writing the scaffold

Where the brief or the design proposals left something open, or where the scaffold departs from a suggestion:

- **Six players today, eight seats by design.** Civilizations are unique per game and there are six, so `maxPlayers()` is `min(RULES.maxSeats, number of civs)`. Types, lobby layout and rules are sized for 8.
- **Map sizes carry a recommended player count that is shown, not enforced.** The generator must always return a start for every player.
- **Terrain is ground + feature**, with replace semantics (simple tables, matches the art, leaves a slot for phase 2 improvements).
- **Production stays selected** after a unit is completed; a city with nothing chosen makes no progress that turn; a Settler needs population 2 and takes one.
- **Citizens are assigned** by total yield, then food, then lower tile index. Cities never shrink in phase 1.
- **Server-issued tokens, stored as hashes.** "Which games am I in?" is answered by the browser remembering its last game code, not by a server-side index.
- **No journal, lock file, turn backups or async queue** in phase 1. Backup is copying `data/`.
- **Patches are whole-section replacements** (`ViewPatch`), implemented and tested in the scaffold, with a full-sync fallback switch.
- **Input is handled by the app shell (WP4)**, which drives the renderer's camera through `panBy` / `zoomBy`; the renderer never listens to pointer or key events.
- **Implemented in the scaffold beyond hex and RNG**, because several work packages meet there: ids, JSON helpers, table accessors, view patches, test fixtures, `pathTo`, the pixel-hex geometry (`client/src/render/geometry.ts`), a stand-in renderer and a map test page.
- **Opening an invite link never takes a seat**; pressing Join does. The page's automatic `joinGame` carries no name and can only bring a player back to a seat they already have. This keeps accidental second seats (phone and laptop) out of the lobby.
- **Seats cannot be removed by the host in phase 1.** Instead: the lobby warns the host before starting with a seat that is not connected; a stuck lobby is replaced by a new game; in a running game the server's owner can free a seat by hand (`tokenHash: null`, see README).
- **City names stay in list order** (the genre's habit), although that tells an observer how many cities a player has founded. It is listed as a public fact; non-interference tests keep the number of founded cities equal between the worlds they compare.
- **Worked tiles are shown on the map** (a marker per tile while the city is selected, `MapOverlay.workedTiles`), not listed in the city panel.
- **TypeScript 7, Vite 8, Vitest 5** (current releases at the time of writing).

## 7. Deferred to later phases (do not build now)

The design leaves room for each of these; the note says where it will plug in.

| Later | Where it plugs in |
|---|---|
| Combat, hit points, ranged attacks, city defence (phase 2) | New action types and columns in `UNITS`; dice from `GameState.rng`; `Unit` gains fields |
| Tech tree, buildings (phase 2) | New data tables; `BuildItem` gains a `kind`; a step in `resolveTurn` |
| Workers, tile improvements, resources (phase 2) | New `Tile` fields, each with a last-seen twin in `RememberedTile` |
| More unit types, sea units | Rows in `UNITS`; `canEnterTile` learns about domains |
| Multi-turn move orders (phase 2) | `Unit` gains an order; a step in `resolveTurn` paths on `boardFromView` of the owner |
| Ordered turns and secretly planned orders between players at war (phase 3) | `GameSettings.turnMode`; a gate in `applyAction`; queued actions run through the same action code |
| Turn timers, Discord and email notifications (phase 3) | Deadlines in the room file (never in `GameState`); the server calls `resolveTurn`; reacts to `turnStarted` |
| Teams, shared vision | `PlayerState` gains a team; one check in `computeVisible` and in `canEnterTile` |
| Events about other players (phase 2: the victim and the onlookers of a fight), turn reports, replays (phase 3) | The engine adds more players to an event's audience (`AddressedEvent.to`), collected where it already walks step by step; no type changes. Events get stored |
| City-states, policies, happiness, diplomacy, trade (phase 4) | More players and tables; new actions |
| Religion, espionage, great people, victory, AI seats (phase 5) | An AI is a player that produces `Action`s from its `PlayerView`; an empty seat is one with `tokenHash: null` |
| Desktop wrapper, PNG art (phase 6) | The client is a static site; `SpriteSheet` gets a PNG implementation |

Also left out of phase 1 on purpose: client prediction, animation beyond an optional cosmetic slide, line-of-sight blocking, map wrap, rivers, border growth, manual citizen assignment, manual city names, joining a running game, spectators, chat, kicking players or removing seats, a host override for absent players, moving a seat to another device (other than the manual rescue in the README), accounts, HTTPS in the Node process, a database, sound, a minimap.
