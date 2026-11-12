# AGENTS.md

Guide for coding agents (and people) changing this repo. Read it before editing; keep it true when
you change how things work.

## What this is

Mods for the Herdr desktop app (herdr-app, [herdr.dev](https://herdr.dev)) plus the small
integrations that make coding agents report their session IDs to it:

| Path | What |
|---|---|
| `agents-ids/` | Herdr's `agents` mod + session-ID line + Recent sessions with Resume |
| `spaces-plus/` | Herdr's `spaces` mod + git line, status, tabs, ports, PR badge, machine load |
| `sysstat/` | Status bar: CPU (sparkline), memory, AMD GPU of the shown space's machine |
| `sessions/` | Search past Hermes, Pi and PiG sessions (overlay) and resume one in a new tab |
| `usage/` | Status bar: AI provider quota from a configured collector command (Kuota JSON) |
| `md-open/` | Picker of markdown paths in the focused terminal; opens one in `fresh` in a split |
| `integrations/bin/agent-session-label` | The one script every hook calls; writes the labels |
| `integrations/{pi,opencode,hermes}/` | Pi/PiG extension, OpenCode TUI plugin, Hermes plugin |
| `install.sh` | Copies mods, links integrations, adds Claude Code / Codex hooks, once |
| `layout/main-plus.json` | Herdr's `main` layout with the three mods (installed, not listed) |
| `scripts/demo.sh` | Isolated demo window for screenshots |
| `docs/window.png` | The README's whole-window screenshot |
| `tests/` | Self-checks for the Python pieces |

Each mod is one folder in the shape herdr.dev indexes (repo topic `herdr-mod`): `<name>/RECIPE.md`
(the brief to rebuild it from scratch), `<name>/preview.png`, and the mod itself in
`<name>/mods/<name>/` (`main.js`, `mod.json`, its helper module, `test_logic.mjs`). Keep that shape:
herdr.dev skips a folder without `RECIPE.md` and `preview.png` beside `mods/`, and no mod folder may
hold a `layouts/` folder. A new mod gets a new top-level folder the same way. The layout is not listed
on herdr.dev (a layout package would need its own copies of the mods); it lives in `layout/`, which
`install.sh` copies to herdr-app's `layouts/`.

## Ground rules

- **Edit here, never in `~/.config/herdr-app/mods/`.** Those are copies; `./install.sh --watch`
  overwrites them on every save. Mods are copied, not symlinked: herdr-app hot-reloads a mod only when
  a file in its own folder changes, and an edit behind a symlink never reaches that folder.
- **Keep the forks mergeable.** `agents-ids/main.js` and `spaces-plus/main.js` are copies of Herdr's
  shipped mods. Put new logic in `extras.mjs` (pure functions, no `herdr`/`gpui-kit` imports) and keep
  the edits inside `main.js` small and marked by a comment, so the next upstream merge conflicts only
  where both sides really changed. Same for sysstat's `logic.mjs`.
- **Mods stand alone.** No imports from another mod's folder (someone may install only one). The
  shipped `workspace-chrome` icons (`mods/workspace-chrome/*.svg`) are fine; they ship with herdr-app.
- **The label contract is public.** Terminal labels `agent.session` (the session ID) and `agent.app`
  (`claude`, `codex`, `pi`, `pig`, `opencode`, `hermes`) are what other agents and tools write. Don't
  rename them; add new labels instead.
- **Never type untrusted text into a shell.** Labels can be written by any program. Resume runs only
  IDs matching `^[\w.-]{4,128}$` for known programs (`resumeArgv` in `agents-ids/extras.mjs`), always as
  the argv of a new tab; nothing is ever typed into a terminal. `exec` takes an
  argument list; the only `sh -c` scripts are constants in the code.
- **A hook must never break or slow an agent.** `agent-session-label` exits 0 on any error, does
  nothing outside herdr-app (no `HC_TERMINAL_ID`), and labels only when the agent is (a direct child of)
  the terminal's foreground job leader, so an agent started by another agent can't overwrite the label.
- **No personal data in the repo.** No real usernames, hostnames, home paths, session IDs from real
  work, company or project names, in code, tests, docs or screenshots. Test fixtures use `/home/alex`
  and made-up names like `acme`. Before committing, `git grep -nIiE '/home/[a-z]+/' -- ':!*.md'`
  should show only `/home/alex`; look at every new `preview.png` too.
- **No new dependencies.** Mods use only `herdr`, `gpui-kit`, `gpui-base`. Scripts use POSIX `sh` /
  `bash`, `python3` stdlib, `git`, `rsync`. External tools a feature calls (`gh`, `ss`, `lsof`, `btop`)
  must be optional: missing means the feature quietly shows nothing.

## herdr-app facts that bit us

- The API is in `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`; herdr-app's own
  `~/.config/herdr-app/AGENTS.md` explains mods, layouts and the design rules. `herdr-app commands`
  lists every command with its arguments. Read those instead of guessing.
- `terminals()` returns live terminals only, with their `labels`. Anything about a closed terminal
  must be remembered by the mod (`localStorage`), as Recent sessions does.
- `window()` can be undefined while a mod starts; write `window()?.active`.
- `readTextFile(path, { on })` and `exec(cmd, args, { on })` run on a space's machine; `on: null` is
  this computer.
- `hc send <t> <text>` pastes and presses Enter (it waits for a person to pause typing); keys go
  with `hc keys <t> ctrl+c`. `hc ls --json` has no labels; read them with `hc get <t> --json`.
- Agents save a session only after its first message, so test Resume on a session that has one.
- Agents started as the `argv` of `hc run` exit at once in tests; run `/usr/bin/zsh -i` and
  `hc send <t> <agent>` instead. `hc keys <t> ctrl+c ctrl+c ctrl+d` quits most agents.
- Codex and OpenCode report their session only after the first prompt.
- `window.maximize` toggles, and `app.zoom_in` adds to the zoom saved in `HERDR_APP_HOME`: a script
  that runs them on every start must `app.zoom_reset` first and check the window size.

## Checks

Run all of these before every commit; all must pass:

```sh
for m in agents-ids spaces-plus sysstat sessions usage md-open copy-on-select; do node $m/mods/$m/test_logic.mjs && herdr-app check $m/mods/$m; done
python3 -I tests/test_label.py && python3 -I tests/test_hermes_plugin.py && python3 -I tests/test_sessions_search.py && python3 -I tests/test_session_names.py && python3 -I tests/test_procs.py && node tests/test_pi.mjs
shellcheck -S warning install.sh scripts/demo.sh
```

A UI change also needs a live look: `./install.sh --watch` in one terminal, then `herdr-app status`
(its `errors` must be `[]`) and `herdr-app shot /tmp/x.png`. herdr-app can't click for you: say in the
PR or report which clicks you did not try. Probe spaces (`herdr-app do space.new …`) stay in herdr-app's
`recent` list after `space.close`; prefer the demo window for anything that needs spaces.

## Screenshots

`scripts/demo.sh start`, then `scripts/demo.sh shot`, then `scripts/demo.sh stop`. It runs a second
herdr-app on its own herdr-core (`XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `XDG_DATA_HOME`,
`HERDR_APP_HOME` all moved), so your real spaces and agents never show up and can't be closed by it.
Never publish a shot of your real window. The crop boxes at the top of the script fit a 3440x1440
screen; adjust them for yours. Don't source the demo environment into a shell you keep using; run it in
a subshell.

## Upstream merges

The `upstream` branch holds Herdr's shipped `agents` and `spaces` files at the fork paths, unchanged.
When a herdr-app update changes them:

```sh
git switch upstream
cp ~/.config/herdr-app/mods/agents/main.js agents-ids/mods/agents-ids/main.js
cp ~/.config/herdr-app/mods/spaces/main.js spaces-plus/mods/spaces-plus/main.js
git commit -am "Herdr's agents and spaces from herdr-app <version>"
git switch main && git merge upstream
```

Then run the checks, and add a **Changed** line to the changelog naming the herdr-app version.

## Changelog

`CHANGELOG.md` follows Keep a Changelog. Every commit that changes what a user of the mods or the
integrations sees adds a line under `## [Unreleased]`, in the same commit, under `Added`, `Changed`,
`Fixed` or `Removed`. Write for users: what they see or do, bold mod name first
(`- **spaces-plus:** …`). Internal refactors, tests and docs-only changes need no line.

## Releases

Version numbers are `MAJOR.MINOR.PATCH`: new features bump MINOR, fixes only bump PATCH, a renamed
label or removed feature bumps MAJOR.

1. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty
   `## [Unreleased]` above it, and update the compare links at the bottom.
2. Set `version:` in `integrations/hermes/agent-session-label/plugin.yaml` to `X.Y.Z`.
3. Run the checks. Commit `Release vX.Y.Z`, then `git tag -a vX.Y.Z -m vX.Y.Z` and
   `git push origin main vX.Y.Z`.
4. Publish the notes from the changelog:

   ```sh
   awk '/^## \[X.Y.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > /tmp/notes.md
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes.md
   ```

## Git

- Work on `main` for small changes; for anything bigger use a branch in a worktree at
  `.worktrees/<branch>/` (ignored by git).
- Commit messages: one line saying what changed for a user, e.g.
  `spaces-plus: PR badge per branch via gh`.
- Never force-push `main` or `upstream`, and never rewrite a pushed tag.
