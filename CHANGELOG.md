# Changelog

What changed in each release of herdr-mods, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Every change that a user of the mods or the integrations
would notice gets a line under **Unreleased** in the same commit; a release turns that section into
a version (see [AGENTS.md](AGENTS.md#releases)).

## [Unreleased]

### Added

- **agents-ids:** key command `agents-ids.sort` opens the sort and status icons menu.
- **agents-ids:** a fifth status icon set, **Matrix**: a 3x3 dot grid, a lit column sweeping across it while the agent works.

## [0.10.0] - 2026-11-13

### Added

- **agents-ids:** an agent's third line (Next, waiting, doing) that is too long for the panel runs as a ticker while the pointer is on its row.
- **agents-ids:** pick the status icons in the sort menu (top right of Agents): Default, Rings, Signs or Who (Lucide icons).

### Changed

- **agents-ids:** Save & close sessions has a box icon instead of ⏏.
- **usage:** a gauge icon in front of the quota, like the status bar's other items.

## [0.9.0] - 2026-11-12

### Added

- **agents-ids:** A finished agent's third line is what it says comes next (its reply's `Next:` line). When
  that line asks for you, the agent sorts with *Needs you* and shows *Your turn*.
- **agents-ids:** *Waiting*: an agent whose background jobs will wake it (a CI watch, a build) reads
  `waiting: gh · 4m` with a clock, in its own section after Working, instead of looking idle.
- **agents-ids:** Herds. Agents started by a lead (`agent.lead`) nest under it in Priority view, with
  `herd · 3 working · 1 needs you` on the lead and each worker's brief, which a click opens. In the other
  views they stay in their space with a `↳ lead` chip. Closing a lead says its herd keeps running.
- **agents-ids:** Send to several: pick agents with the pen icon, type once, send. An agent whose input
  box holds unsent text, or can't be read (only Hermes's can, for now), is skipped and named.
- **md-open:** also lists HTML and PDF files, and opens them in your browser or PDF viewer.
- **Hermes integration:** reports Hermes's turn state to Herdr (working, done, blocked on an approval or a
  question) and sets `agent.next`, `agent.needs` and `agent.waiting` for the features above. Install it
  without cloning: `hermes plugins install DarkoKuzmanovic/herdr-mods/integrations/hermes/agent-session-label`.
- **docs/labels.md:** every label the mods read, who sets it and what shows it. None is required.

## [0.8.1] - 2026-11-12

### Fixed

- **Hermes integration:** A session resumed in a different terminal (`hermes --resume <id>`, or Resume in
  agents-ids or sessions) now labels that terminal. Before, the labels went to the terminal the session was
  first created in, because Hermes's shared gateway keeps the environment from that first start. `/resume`
  inside an already open tab is still not followed.
- **Hermes integration:** On Hermes 0.23.1 and newer, a resumed tab shows its session ID as soon as it opens,
  not only after its first message.
- **spaces-plus:** clicking a port or pull request chip did nothing in the Windows app; links now open
  through the app itself, on every platform, without `xdg-open` or `open`.
- **spaces-plus:** a port chip on a WSL machine opened `http://<machine name>:<port>`, which Windows
  can't resolve; under the Windows app it now opens `http://localhost:<port>`, which WSL forwards.

## [0.8.0] - 2026-11-12

### Added

- **copy-on-select:** New mod. Shift-drag a selection in any terminal and it is copied when the
  pointer settles, with one *Copied* toast. Plain drags copy nothing. In the main-plus layout as a 0px
  block in the status row.
- **agents-ids:** Save & close sessions (Ctrl+Shift+U, or ⏏ in the Agents header): lists every agent with ✓ or ⚠
  (working, waiting for an answer, or running a job such as a build or a test run), saves them all to a
  snapshot and closes the tabs that are safe to close. Reopen them later with Ctrl+Shift+Alt+U or the
  "Reopen N sessions" bar: each comes back in its space with its tab name and folder.

## [0.7.0] - 2026-11-11

### Added

- **agents-ids:** Recent sessions tooltips start with the session's name from Hermes, Pi, PiG, Codex,
  OpenCode or Claude Code (read from the agent's own history on that machine; none shown if it has no name).

### Changed

- **agents-ids:** Priority view lists Needs you, Working, Idle, then Done (Done was second).
- **spaces-plus:** Space avatars are outlined in the space's color instead of a filled bright tile.

## [0.6.0] - 2026-11-09

### Added

- **md-open:** New mod. A key (e.g. `alt-o`) lists the markdown files named in the focused terminal,
  newest first; Enter opens the picked one in `fresh` in a split to the right.
- **agents-ids:** A notification with a sound when an agent looks stuck: working on the same thing
  for over 30 minutes, or blocked for over 5. Once per stall; clicking it focuses the agent. Shows
  only while herdr-app is open.

### Changed

- **install.sh:** Under WSL it says where the mods go and how to point them at a Windows herdr-app;
  the README has the WSL steps (#2).

### Fixed

- **sessions:** Typing while the first search was still running left *Searching…* up forever.

## [0.5.0] - 2026-11-08

### Added

- **agents-ids:** *Grouped by project* in the sort menu: one group per git repository, its worktrees
  and subfolders included, so agents in different spaces of one repo sit together; a folder outside
  git is its own group.

## [0.4.2] - 2026-11-08

### Fixed

- **integrations (Pi/PiG):** a PiG session was labeled `agent.app=pi`, so agents-ids resumed it with
  `pi --session` instead of `pig --session`; PiG is now detected through its extension runtime
  (`PIG_EXT_HOST_INFO`), which plain Pi doesn't set.
- **agents-ids:** Resume of a remote session opened it on this computer; it now opens on the session's
  own machine, and does nothing when no space of that machine is open.
- **agents-ids:** Resume no longer types into the old terminal, where it would submit a half-typed
  line; it always opens a new tab, in the session's folder only if that still exists.
- **agents-ids:** a hidden recent session came back when its terminal changed folder.
- **agents-ids:** a session label like `__proto__` broke the Recent sessions list.
- **integrations (Hermes):** a gateway started inside a Herdr terminal labelled that terminal for
  clients outside Herdr.
- **integrations:** a new session cleared the last agent's activity line only when it next reported.
- **install.sh:** rewriting Claude Code or OpenCode settings turned a 0600 file into 0644; it keeps
  the mode now.
- **install.sh:** Pi's and PiG's moved-aside `agent-session.ts` overwrote each other in the backup; the
  backup keeps full paths.

### Changed

- **sessions:** searches run one at a time instead of one per keystroke, and stop reading a session
  file once they have its title and match.
- **spaces-plus:** nothing is polled while the sidebar is narrowed to a rail; port chips no longer wait
  for a slow `gh pr list`.
- **integrations (Pi/PiG):** a settled agent now reads `waiting for you` instead of `done`, since
  settling in the TUI means sitting at the prompt.
- **integrations (Pi/PiG):** on Linux the extension checks once that it owns the terminal's
  foreground job (reading `/proc` itself) and then labels through `hc` directly, instead of spawning
  the `agent-session-label` helper on every tool call; the helper remains for macOS and for agents
  that don't own the foreground.

## [0.4.1] - 2026-11-08

### Fixed

- **agents-ids:** an agent on another machine showed `machine/t5c` with no room left for its session
  id; the line now reads `t5c · <session>` (the machine is already on the right; hover still names the
  full address, Shift-click still copies it).

## [0.4.0] - 2026-11-08

### Added

- **sessions:** a new mod: search past Hermes, Pi and PiG sessions by topic and resume the picked one
  in a new tab (Enter or click). Bind it to a key, e.g. `"ctrl-shift-s": "mod.open:sessions"`.
- **usage:** a new status-bar mod showing the busiest AI provider quota (`codex 31%`, red from 90%),
  with every provider and its reset time on hover, from a command you configure (Kuota's JSON).
- **agents-ids:** a third line per agent with what it is doing now and for how long; amber when it has
  been working on the same thing for over 30 minutes.
- **agents-ids:** an X on each agent row opens a check of what closing would lose (still working,
  uncommitted changes, sub-agents) before ending the terminal; it refuses if the terminal changed.
- **spaces-plus:** the pull request badge turns red when a check failed and amber when CI has been
  queued for over 45 minutes; the tooltip names the failing checks.
- **spaces-plus:** an unreachable machine shows why (`ssh timeout`, `connection refused`, `host key`)
  and since when, with the full error on hover.
- **Integrations:** Hermes and Pi/PiG set the new `agent.doing` and `agent.doing.since` labels.

## [0.3.0] - 2026-11-04

### Added

- **agents-ids:** an X next to Resume removes a session from Recent sessions; it comes back only if
  that session runs again; an X on the Recent sessions header clears the whole list.
- **agents-ids:** Recent sessions show how long ago each one ran (`3h`, `2d`), and "Show n more"
  lists every remembered session, not only the last 5.
- **sysstat:** CPU, memory and GPU values turn red at 90% busy or full.

### Changed

- **agents-ids:** a plain click no longer copies anything; Ctrl-click copies the session ID (on the
  ID line and in Recent sessions), Shift-click still copies the address.

## [0.2.1] - 2026-11-04

### Fixed

- herdr.dev can list the three mods: each is now one folder in the shape its index expects
  (`agents-ids/RECIPE.md`, `agents-ids/preview.png`, the mod in `agents-ids/mods/agents-ids/`; the
  same for `spaces-plus` and `sysstat`). The mods themselves are unchanged. After `git pull`, run
  `./install.sh` again; it reads the new paths.

### Changed

- The `main-plus` layout moved to `layout/main-plus.json` and is no longer offered on
  herdr.dev/layouts (a listed layout has to carry its own copies of the mods). `install.sh` still adds it.
- The README's whole-window screenshot moved to `docs/window.png`.

## [0.2.0] - 2026-11-03

### Added

- **agents-ids:** a *Recent sessions* group under the agents: agent sessions that ended (the agent
  quit, or its terminal closed) with a **Resume** button. At a bare shell, Resume types the resume
  command there (`claude --resume <id>`, `codex resume <id>`, `pi --session <id>`,
  `opencode --session <id>`, `hermes --resume <id>`); otherwise it opens a new tab in the same space
  and folder. Click a row to copy its session ID. Remembers the last 20 sessions for 14 days, across
  restarts.
- **spaces-plus:** the ports a space's programs listen on (`:5173`), from `ss` (Linux) or `lsof`
  (macOS) on the space's machine; click opens it in the browser. A server in a worktree shows on the
  worktree, not on the checkout around it. Agents' own sockets and ephemeral ports are left out.
- **spaces-plus:** the pull request of a space's branch (`#42`: green open, dim draft, purple merged),
  from `gh pr list`, refreshed every 5 minutes; click opens it.
- **spaces-plus:** CPU and memory in use on each machine row (red from 90%).
- **sysstat:** a one-minute CPU sparkline; GPU load and VRAM on AMD cards (amdgpu sysfs); it follows
  the shown space to its machine; click opens `btop` (else `htop`, else `top`) in a new tab.
- **Integrations:** every agent now also sets the `agent.app` label (which program the session belongs
  to), so Resume knows the command.
- **Integrations:** a Hermes plugin, `integrations/hermes/agent-session-label`.
  `install.sh` links it into `~/.hermes/plugins/` unless another plugin already sets the label.
- `scripts/demo.sh`: screenshots from an isolated demo window (own herdr-core, demo repos and agents),
  so previews never show your own spaces.
- Self-checks: `mods/sysstat/test_logic.mjs`, `tests/test_hermes_plugin.py`.
- `AGENTS.md` and `CLAUDE.md` for coding agents working on this repo; this changelog.

### Changed

- `agent-session-label` falls back to `ps` where there is no `/proc`, so the hooks also run on macOS
  (untested there). A `-` for the pid argument means "find the agent".
- sysstat's text is shorter (`MEM 25.1/31.3G`), the memory percentage moved to the tooltip, and
  `main-plus` gives it 420px.
- The mods' own helpers moved to `extras.mjs` (agents-ids, spaces-plus) and `logic.mjs` (sysstat), so
  merging Herdr's updates to `agents` and `spaces` touches fewer lines, and the tests import them
  instead of evaluating `main.js`.

## [0.1.0] - 2026-11-03

First public release.

### Added

- **agents-ids:** Herdr's Agents list with a second line per agent: terminal address and short session
  ID from the `agent.session` label. Click copies the session ID, Shift-click the address.
- **spaces-plus:** Herdr's Spaces list with git changes, tab count and agent status per space, the
  active space's tabs, space counts on machine rows, and recent spaces to reopen.
- **sysstat:** CPU and memory in the status bar (Linux).
- Session-ID integrations for Claude Code and Codex (`SessionStart` hooks), Pi and PiG (extension) and
  OpenCode (TUI plugin), all through `integrations/bin/agent-session-label`.
- `install.sh` (`--mods-only`, `--watch`) and the `main-plus` layout.

[Unreleased]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DarkoKuzmanovic/herdr-mods/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DarkoKuzmanovic/herdr-mods/releases/tag/v0.1.0
