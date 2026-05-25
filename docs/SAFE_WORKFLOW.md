# SAFE_WORKFLOW — How to change this repo without breaking things

This is the operational checklist. Follow it every time, no exceptions.

## Before you start

1. `git status` — confirm you are on a clean tree.
2. `git pull origin main` (when the remote is set).
3. Read `docs/VISION.md` and `docs/DESIGN_DIRECTION.md` if you are touching
   any UI.
4. Read the latest entries in `docs/CHANGELOG_AI.md` — another AI may have
   already explored this area.

## Branch

```bash
git checkout -b <type>/<short-description>
# examples:
#   feat/office-iso-floor
#   fix/agent-bubble-overflow
#   experiment/kenney-character-recolor
#   refactor/extract-furniture-catalog
#   docs/expand-vision
```

One branch per logical change. If you find yourself fixing two unrelated
things, stash the second and branch off again.

## While you work

- **Type-check often**: `npm run build` (vite build runs `tsc -b` first).
- **Lint**: `npm run lint`. Fix warnings related to your change; ignore
  pre-existing ones unless they touch the files you edit.
- **Don't add dependencies casually.** Each new dep should be justified in
  the commit message.
- **Don't reformat unrelated files.** Stick to the lines you change.

## Before commit

- `npm run build` must pass.
- Read your own diff: `git diff`. If anything is unexplained, add a
  comment or revert it.
- Stage explicitly: `git add <files>`. Avoid `git add -A` unless you have
  reviewed every modified file.

## Commit message

Conventional format:

```
<type>(<scope>): <short summary>

<optional longer body explaining WHY, not WHAT>
```

Examples:

```
feat(office): place agents at desks by department
fix(character): clamp bubble width when currentTask is long
docs(vision): clarify the no-fake-data rule
chore(deps): pin tailwindcss to 3.4
```

## Forbidden commands

These need explicit human approval in the same chat session, every time:

```bash
git push --force        # use --force-with-lease + permission instead
git reset --hard        # almost always wrong
git clean -fdx          # destroys untracked work
rm -rf <anything>       # explain in chat first
npm cache clean --force # not your job
git rebase -i ...       # interactive — won't work in tool-call mode anyway
```

## After commit

- Append to `docs/CHANGELOG_AI.md`:
  ```md
  ## YYYY-MM-DD — <your AI name or initials>
  - Branch: <branch>
  - Summary: <one or two sentences>
  - Files touched: <list>
  - Verification: `npm run build` ok / failed
  - Notes for the next AI: <optional, e.g. "left half-done X here">
  ```
- Do **not** open a PR or push automatically. Wait for the human.

## When things go wrong

- Build broke? Say so in chat, do not "fix it" by mass-rewriting unrelated
  files.
- Merge conflict? Resolve manually, never use `--theirs` or `--ours`
  blindly.
- Secret leaked? Stop everything, tell the human in chat. Do not try to
  rewrite history.
- Sibling repo modified by accident? Stop, list the files you touched
  outside this repo, and let the human decide.

## Handoff between AIs

When you finish a session, fill out `docs/AI_HANDOFF.md` so the next AI
picks up cleanly. Treat it like leaving a clean kitchen for a roommate.
