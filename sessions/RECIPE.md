# Sessions

Build a standalone Herdr overlay that searches past Hermes, Pi, PiG, Claude Code, Codex and
OpenCode sessions. Open it with `mod.open:sessions` (for example bind `ctrl-shift-s` in
`keys.json`). Type to search; use the arrow keys and Enter, or click a row, to resume in a new tab.
Escape closes the overlay.

Search the shown space's machine. An overlay opened with props may specify `machines`, an array
of additional Herdr machine names. A matching space must already be open on the session's machine
for resume. The Python 3 helper reads these stores on each searched machine:

- Hermes: `~/.hermes/state.db` (read-only SQLite).
- Pi and PiG: `~/.pi/agent/sessions/` and `~/.pig/agent/sessions/` JSONL.
- Claude Code: `~/.claude/projects/<project>/<session>.jsonl`.
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- OpenCode: `~/.local/share/opencode/opencode.db` (read-only SQLite, current and legacy tables).

`HERDR_SESSIONS_ROOT` overrides the home root for the helper. Only sessions with a user message
are shown, and not scripted runs (Claude's `entrypoint` `sdk-*`, i.e. `claude -p` and the SDK; Codex's
`originator` `codex_exec`), which outnumber interactive sessions about ten to one. Searches share roughly three seconds between sources and inspect at most the newest
2,000 files per JSONL source or OpenCode sessions per table; results are capped at 50. Queries
travel as arguments, never through a shell. Only validated session IDs are passed to an agent.
The helper is sent to remote machines via `exec` as Python source, so they do not need a copy of
the mod.

Mod files: `mods/sessions/main.js`, `mod.json`, `logic.mjs`, `search.py`, `test_logic.mjs`,
`test_search.py`. Verify with `node sessions/mods/sessions/test_logic.mjs`,
`python3 -I sessions/mods/sessions/test_search.py`, `python3 -I tests/test_sessions_search.py`
and `herdr-app check sessions/mods/sessions`.
