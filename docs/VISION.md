# VISION — Genesis HQ Lab

## What is Genesis HQ?

Genesis HQ is the visual surface of **Genesis**, a living AI company in
which every agent is a digital employee. The HQ view shows the office where
those employees work, sit at desks, talk to each other, and run the
business in real time.

This lab is the experimentation space for that visual surface, isolated from
the production `../genesis` backend so we can iterate freely.

## What this lab is **not**

- It is **not the production app**. It does not talk to live LLM providers,
  Polymarket, or any real money.
- It is **not a game**. There is no scoring, no progression, no story arc.
  It is a workplace simulation tied to real agent state.
- It is **not a generic "metaverse office"**. It exists to make Genesis
  legible — to make agent activity visible at a glance.

## North star

> When the user opens Genesis HQ, within 3 seconds they should be able to
> tell **which agents are working, what they are working on, and whether
> anything needs human attention**, without reading numbers.

That sentence is the only metric this lab optimizes for.

## Concrete promises

1. **Every visible character is a real agent** (either a real DB row in the
   production app, or a clearly labeled mock here).
2. **Every visible state comes from real fields:**
   `agent.status`, `agent.currentTask`, `agent.visualProfile`,
   `agent.department`, `agent.role`. Never invented.
3. **The map is one continuous office**, not a grid of cards. Rooms are
   connected by corridors, walls, and doors — not by gaps and panels.
4. **Conversations and overhead bubbles** are sourced from real logs
   (`/api/genesis/logs`) or `currentTask`. Never random catalog phrases.
5. **Status drives visuals, not the other way around.** The UI never
   pretends an agent is working when the backend says they're idle.

## Reference aesthetic

- **Pixel Agents** (Pablo De Lucca) — top-down RPG office, warm wood floors,
  visible characters, ambient details (plants, coffee, bookshelves).
- **Bloomberg Terminal** — dense, premium, information-rich.
- **Stardew Valley** indoor scenes — warm, lived-in, legible from above.

We are **not** copying any of these. We borrow the *legibility* and the
*warmth*, then make Genesis its own thing.

## Out of scope (for now)

- 3D / WebGL / Three.js anything.
- Sound design.
- Walking pathfinding (agents teleport between idle and working positions).
- Player avatar / first-person view.
- Multi-floor buildings (one floor is enough until it isn't).

## How we know we're done

The lab "graduates" a slice to `../genesis` when:

1. The human operator has signed off visually (screenshot + thumbs up).
2. `npm run build` passes here.
3. The slice is documented in `docs/CHANGELOG_AI.md` with the date,
   approved screenshot reference, and the diff of files that need porting.
