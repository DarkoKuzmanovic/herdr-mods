# Handover notes

A handover note is how an agent leaves work for the next session and for you. The
[handovers](../handovers/RECIPE.md) mod lists every open note in your spaces. Any agent or person can
write one; this page is the format.

## Where

`<repo>/.hermes/plans/<anything>-handover.md` (or just `handover.md`), in the repo the work is in.
The mod looks in each open space's folder and each pane's folder, and in every folder above them up to
(not including) your home, so a worktree under `<repo>/.worktrees/` finds its repo's notes. Notes in
spaces you have closed don't show until you open one there.

## Format

```markdown
---
title: Search endpoint
app: hermes
session: local-3f9c2a1e7d4b
---
# Handover: search endpoint

## You
- [ ] Review PR #42 before it merges

## Agent
- Add pagination tests for /search
- Update the API docs

## Anything else
Free text: what is live, what is untested, where to look.
```

- **Front matter** (optional): `title` (else the first `# ` heading, without `Handover:`), `app`
  (`hermes`, `claude`, `codex`, `pi`, `pig`, `opencode`; the agent New agent starts, Hermes by default),
  `session` (the session that wrote it, for Old session), `status` (`done` hides the note).
- **`## You`**: what only the person can do, one list item each. `- [ ]` open, `- [x]` done. The card
  is *your turn* while any item is open.
- **`## Agent`**: what the next session does. The card shows the first four items.
- Only top-level list items under those two headings count; everything else is for the reader.

## What the mod writes

Ticking an item in the panel toggles its `[ ]` / `[x]` in the note. The X on a card adds
`status: done` to the front matter. Nothing else in the note changes, and a note an agent edits at the
same moment keeps the agent's version.
