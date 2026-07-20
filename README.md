# Dominion

A multiplayer Pokémon-style overworld prototype: tile-based Greco-Roman capital, wild encounters, bag/party menus, and enterable building interiors. Built with **Phaser 4** (client), **Colyseus** (server), and a shared TypeScript package for protocol, tiles, and pure game rules.

---

## Gameplay

- Join the capital plaza (marble court + fountain). Walk with **WASD / arrow keys**.
- **Wild encounters** roll on tall-grass / habitat tiles; fight, catch, or run in a turn-based battle overlay.
- **Enter buildings** by stepping onto a door tile (or facing the door from the south and pressing **E**). Interiors are real tile rooms (house / temple / shrine). Step on the south **door-mat** (or press **X**) to leave.
- **Start menu** (**Enter**): Party · Bag · Settings · Exit menu. Shortcuts **P** / **I** / **O** also work in the overworld and during battle.
- **100 claimable houses**, global/local chat, inventory, and home warp (**H**).

---

## Monorepo layout

| Path | Package | Role |
|------|---------|------|
| `apps/client` | `@game/client` | Vite + Phaser client (WorldScene, BattleScene, menus, WindowedTilemap) |
| `apps/server` | `@game/server` | Colyseus `WorldRoom`, movement, battles, enter/exit, SQLite |
| `packages/shared` | `@game/shared` | Protocol, tiles, autotile, buildings, interiors, placement, resolution |
| `tools/` | (root scripts) | Asset codegen, previews, pixel-art lint, Playwright helpers |

Workspace: **pnpm** (`pnpm-workspace.yaml`). Shared code is imported as `@game/shared`.

---

## Asset pipeline

Codegen is deterministic from pure TS painters and the world seed. Pipeline order:

```
tools/palette.ts          → indexed ≤48-color PAL (shared by all painters)
tools/stamps.ts           → stamp helpers / textures used by tileset painters
tools/gen-tileset.ts      → apps/client/public/assets/tileset.png
tools/gen-sprites.ts      → characters.png, creatures.png
tools/gen-map.ts          → world.json (client public + server data)
  └─ autotile bake, scatter decals, collision rebuild, BFS house reachability
```

Run everything:

```bash
pnpm gen                 # tileset + sprites + map
pnpm gen:tileset
pnpm gen:sprites
pnpm gen:map
```

### Graphics principles (enforced in code + tests)

| Principle | What it means here |
|-----------|-------------------|
| **Indexed ≤48-color palette** | All tile/sprite painters pull from `tools/palette.ts` / shared PAL; `test:palette` + style gates. |
| **Stamp-based texturing** | Props/structures placed via `prop-stamps` footprints (`applyPropStamp`), not free noise scatter for named props. |
| **Flatness budget** | Value hierarchy tests (seam dark/light edges); paved tiles get BR dark seams; court uses raised `MARBLE_COURT`. |
| **Hard-edged transitions** | 48-blob terrain pairs (`autotile.ts`); water never 4-adjacent to raw floor (pool coping ring). |
| **Placement grammar** | Paintings on walls, crates need ortho wall, statues on axis/flanks, benches on path edges, zone budgets. |
| **Y-sort** | Tall props (3-tile columns, statues, trees) become depth-sorted sprites; player depth tracks tile Y. |
| **Integer zoom** | Overworld and interiors both use zoom **3**; CSS scale snaps so physical pixels/texel stay integer. |

Capital massing (after de-pillar): columns only in **structured runs** (avenue edges + porticoes, spacing ≥ 3, architrave on porticoes), free-standing cap **≤ 8 per plaza quadrant**, plus **two stoas** flanking the temple approach and a **perimeter enclosure wall**. Vertical-surface metric counts only **contiguous footprints ≥ 3×2** (no 1-tile prop spam).

---

## Collision and doors

### Collision

- Solid tiles live in `SOLID_TILES` (`packages/shared/src/tiles.ts`).
- `gen-map` rebuilds the collision layer from ground/deco/overhead solids after placement (stamp footprints also write bits).
- Client prediction uses `WorldModel.isBlocked`; server `tryStep` is authoritative outdoors.
- Interiors bake collision the same way from room templates (`packages/shared/src/interiors.ts`).

### Door entry (Pokémon-correct)

The walkable entrance is the facade **door tile** (`H_DOOR` in the map) — not the ground in front of the building. Like Pokémon DP: walk **onto** the doorway to go inside.

| Action | Rule |
|--------|------|
| **Auto-enter** (walk) | Only when the step lands **exactly** on the door tile (`x === doorX && y === doorY`). Standing in front (or any neighbor) never warps. |
| **Prompt** “Press E to enter” | `nearDoor` — Manhattan distance ≤ 1. Prompt only; never warps. |
| **E key** | Only while standing **on** the door tile (same cell as auto-enter). |
| **Exit** | Step onto the interior **south-edge door-mat** (exact tile), or press **X**. |

Shared helpers: `onDoorTile`, `nearDoor`, `canConfirmEnter`, `resolveEnterTarget`, `resolveNearEnterTarget`, `resolveConfirmEnterTarget` in `packages/shared/src/buildings.ts`. Public door coords match gen-map `H_DOOR` cells (e.g. Grand Temple at `(511, 485)`).

---

## Controls

| Input | Action |
|-------|--------|
| WASD / Arrows | Move (grid steps) |
| **Hold R** + move | Run (faster grid steps; R alone does not move) |
| **E** | Enter building (standing on the door tile) |
| **X** | Exit interior (fallback; mat also exits) |
| **Enter** | Open / close **Start menu** (Party / Bag / Settings / Exit menu) |
| **P** | Party panel |
| **I** | Bag (fetches inventory) |
| **O** | Settings |
| **H** | Go home (house door / plaza) |
| **Esc** | Close open menu |
| Click chat + type | Send chat (**Tab** in chat toggles global/local) |

A **top-left cheat sheet** lists Move, Run (hold R), and Bag. A bottom hint bar echoes the main keys. Join prints a full controls system message. **P** / **I** / Start work during battle via DOM hotkeys (WorldScene is paused under the battle overlay).

---

## Dev setup

### Requirements

- Node 20+ (tested on 23)
- pnpm 9+

### Install and run

```bash
pnpm install
pnpm gen                 # first-time / after art changes
pnpm dev                 # frees ports, then client + server in parallel
```

| Service | URL / port |
|---------|------------|
| Client (Vite) | http://localhost:**5175** |
| Server (Colyseus + HTTP) | http://localhost:**2567** (`SERVER_PORT`) |
| Health | `GET http://localhost:2567/health` → `{ ok: true }` |

Useful scripts:

```bash
pnpm dev:server          # server only
pnpm dev:client          # client only
pnpm dev:free            # kill stale listeners on 5175/2567
pnpm typecheck           # recursive tsc (shared tests may need @types/node)
```

---

## Testing

### Unit / integration

```bash
pnpm test                # server unit + multiplayer live tests
pnpm --filter @game/server test
pnpm test:scroll         # client tile-stream unit tests
```

Door semantics, interiors, menus, battles, houses, and protocol wiring are covered in `apps/server/src/test/unit.test.ts` (drives shared helpers + room paths). Multiplayer tests boot a real room and Colyseus clients.

### Graphics / pixel-art lint

```bash
pnpm test:graphics       # resolution, palette, stamps, value, props, ysort,
                         # mapcomp, footprint, placement, plaza
pnpm test:style          # tools/style-check.mjs
pnpm test:marble         # tools/marble-grid-check.mjs
pnpm test:mapcomp        # vertical ≥3×2 massing, de-pillar source gates
```

Other targeted scripts: `test:autotile`, `test:seams`, `test:palette`, `test:stamps`, `test:value`, `test:props`, `test:ysort`, `test:footprint`, `test:placement`, `test:plaza`, `test:center`, `test:resolution`.

Preview / capture helpers (optional): `pnpm preview:map`, `pnpm preview:scene`, `tools/screenshot*.mjs`, `tools/play-verify.mjs`.

---

## Interiors (tile templates)

- Authoring: `packages/shared/src/interiors.ts` — ~**12×9** rooms per kind (`house` / `temple` / `shrine`).
- Tiles: `FLOOR_WOOD` / `T_FLOOR` / `STONE_ROAD`, 2-row `I_WALL` faces, `TABLE` / `BED` / `RUG` / `AMPHORA` / columns as appropriate.
- Render: same `WindowedTilemap` + tileset texture at **`INTERIOR_ZOOM = 3`**, collision bake, y-sort for tall bases.
- Spawn: `(6, 7)`; exit mat: `(6, 8)` (`INTERIOR_SPAWN_TILE` / `INTERIOR_EXIT_TILE`).

---

## Short roadmap

1. **Richer interiors** — multi-room houses, NPCs, shops tied to temple/shrine kinds.
2. **Battle depth** — status moves, items in battle from Bag, trainer battles.
3. **World content** — more districts outside the capital, dungeons, seasonal palette swaps.
4. **Net polish** — interest management at scale, reconnect, anti-cheat beyond step rate.
5. **Art pass** — expand tileset within the 48-color budget; more stoa/facade variants without prop spam.

---

## License / notes

Private prototype monorepo. Generated assets under `apps/client/public/assets/` are outputs of `pnpm gen` and should be regenerated after pipeline changes rather than hand-edited.
