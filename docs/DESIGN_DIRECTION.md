# DESIGN_DIRECTION — Genesis HQ Lab

This is the binding visual contract. Any UI change that breaks these rules
will be reverted.

## 1. Layout

- **One single continuous map.** No card-based grid of rooms. Rooms share
  walls and corridors.
- **Top-down 2D pixel art** (slight 3/4 perspective on furniture is allowed
  if it stays legible).
- **At most 2 fully enclosed rooms** in any one floor (e.g. Risk Bunker,
  Memory Archive). Everything else is open-plan with rugs / plants /
  half-walls as soft dividers.
- **Hallways are real**: floor tiles continue through them; agents can be
  shown walking there.

## 2. Floor & walls

> **2026-06-10 owner-approved exception (live tile office / HQ canvas):**
> the tile office uses the "Pantalla 1" industrial look — cool gray tile
> floor and slate-dark walls (a dark ambient cast over the architecture),
> warm carpet only in the meeting area, terminal-green zone tags, and a
> numberless MARKET WATCH wall screen. Characters and furniture stay at
> normal brightness so they read instantly. The warm-hardwood rule below
> still applies to any *new* surface that has not adopted this direction.

- **Default floor**: warm beige hardwood. Low noise, low saturation.
- **Banned floors**: high-saturation red, bright neon, pure black.
- **Walls**: dark carbon `#181d28` with a 1px trim `#262d3d`. The
  building has one outer wall outline; interior walls only where required
  by an enclosed room.
- **Doors**: visible as a colored 2px frame at a wall gap, tinted with the
  room's accent color.

## 3. Palette

Department accent colors (binding):

| Department      | Accent     |
|-----------------|------------|
| Market Room     | `#3da9fc` (electric blue) |
| Strategy Lab    | `#22d3ee` (cyan)          |
| Risk Office     | `#ff4757` (signal red)    |
| Debate Room     | `#7c5cff` (violet)        |
| Memory Archive  | `#1f6fb0` (deep blue)     |
| Audit Office    | `#00ff9c` (terminal green)|
| Board Room      | `#ffd24a` (signal gold)   |
| Execution Desk  | `#ffb547` (signal amber)  |
| Genesis HR      | `#a855f7` (purple)        |

UI chrome (sidebar, header, panels): `#0a0c12`, `#10131a`, `#15171d`,
`#1a1d24` (carbon scale). Foreground text: `#e6edf3`.

## 4. Characters

- **Top-down sprites**, two poses: seated (back view) and standing
  (front view).
- **Every character is a real agent**. Pulled from DB / fixture.
- **Look is derived** from `agent.visualProfile.primary` and
  `.accent` and `.archetype` — never hardcoded per name.
- **Status drives motion:**
  - `idle`: gentle bob.
  - `working` + `currentTask` present: typing wobble + green halo.
  - `working` + `currentTask=null` → render as `idle`. (anti-fake rule.)
  - `thinking`: pulse + `...` bubble.
  - `debating`: lateral sway + opposed bubbles.
  - `learning`: cyan particles overhead.
  - `warning`: amber halo + `!` bubble.
  - `promoted`: gold halo + medal.
  - `fired`/`suspended`: 40% opacity.

## 5. Bubbles & conversations

Bubble text priority (highest first):

1. Live log message from `/api/genesis/logs` (or the local fixture
   equivalent), aged ≤ 30s.
2. `agent.currentTask` (truncated to ~22 chars + `…`).
3. Status glyph fallback (`...`, `?!`, `!`, `+`, `★`).

**Never** show a bubble with text that isn't sourced from the agent's real
fields or a real log entry. Catalog phrases are forbidden.

## 6. Furniture

- Each room must have at least one piece of furniture that signals its
  purpose: bookshelves for Memory, server racks for Execution, vault door
  for Risk, meeting table for Debate/Board, etc.
- **Don't repeat the same plant tile** more than twice in a single room.
  We have at least three plant variants — alternate them.

## 7. Density & rhythm

- Trading Floor: up to 8 desks open plan.
- Most other rooms: 2–4 desks.
- Meeting rooms (Debate, Board): no desks, just a meeting table + chairs.
- Lounge / Kitchen: no desks, only social furniture (coffee, fridge,
  water, sofas, plants).

## 8. Forbidden visuals

- Card-style bordered rooms with gaps between them.
- High-saturation red flooring.
- Neon glow on everything.
- Emojis used as the primary character. (Emoji as a small status badge is
  OK.)
- Floating numeric HUDs over agents. Stats live in the modal.

## 9. References (concept only — do not copy assets)

- Pixel Agents (Pablo De Lucca) — layout vibe.
- Stardew Valley indoor — warmth and density.
- Bloomberg Terminal — chrome density.
- Kenney "RPG Urban Pack" (CC0) — acceptable asset source for environment
  tiles. Characters stay custom for dynamic palette.

## 10. When in doubt

Default to **legibility over decoration**. If the user can't immediately
tell who is working on what, the change is wrong.
