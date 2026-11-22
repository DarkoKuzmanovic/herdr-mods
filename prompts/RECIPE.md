# Prompts

Build a Herdr mod that keeps prompts you want to send later: global ones, and ones for the project
the focused terminal is in. Open the panel, save or edit a prompt, and **Insert** it into the agent in
that terminal.

![The Prompts panel](preview.png)

**Panel (`mod.open:prompts`, a 520×620 `window` overlay, e.g. `ctrl-shift-i` in `keys.json`):** a
`Prompts` heading with a + (new prompt, Ctrl+N) and an X (Esc). Under it:

- **Search** (focused on open, search icon inside a bordered box): filters as you type, on the text and
  the project name, any case.
- **Scope tabs** with counts: `<project>` (only when there is one), `Global`, `All` (the default).
- **Editor**, folded away until + or Ctrl+N (or a row's pencil) opens it, outlined in `accent`: a
  textarea (3 to 8 rows), **Save to `<project>`** (primary; only with a project), **Save global**
  (Ctrl+Enter saves to the project, or global without one) and **Cancel** (Esc closes the editor
  first, then the panel). Saving a prompt you edit replaces it, and moves it to that scope.
- **The list**, under headings with a rule and a count: this project (in `accent`), `GLOBAL`, then
  other projects by their newest prompt; newest first in each. Each row: the text at most two lines
  (the full text in a tooltip when longer), **Insert**, a pencil (edit) and an X (delete: the first
  click turns it into a red **Delete?**, the second deletes). The picked row (↑/↓, or a click) has a
  border and an orange Insert.
- A footer with the keys: ↑ ↓ select · Enter insert · Ctrl+N new · Esc close.

**Insert** (the button, or Enter in the search) closes the panel, focuses the pane it was opened over,
puts the prompt on the clipboard and runs `terminal.paste`. It is pasted, never sent: no Enter, so you
can still change it. Only shown when a terminal was focused.

**Project:** the git root of the focused terminal's folder (`git -C <cwd> rev-parse --show-toplevel`,
run on that terminal's machine), else the folder itself; for another machine's terminal it is
`<machine>:<path>`.

**Storage:** `~/.config/herdr-app/data/prompts.json` (under `appHome()`), an array of `{id, text, project,
at}`, `project` `""` for global. Read when the panel opens; written with `writeTextFile(path, text,
expected)` against the last read, so a save from another window is never overwritten (the panel says
so and reloads). Not `localStorage`: an overlay window's storage file is named by a hash.

**One list for several computers:** put a machine's name in `data/prompts.on` (e.g. `echo box >
~/.config/herdr-app/data/prompts.on` on a laptop that works on `box`'s terminals). The panel then reads
and saves `box`'s `prompts.json` through `exec("python3", …, { on: "box" })`: a small helper that
writes only over the text the panel last read, under a lock. Projects are named as `box` sees them
(`box`'s terminals by bare path, this computer's as `<its name>:<path>`), so a prompt saved on either
computer shows on both. When `box` is unreachable the panel says so and saves nothing.

Mod files: `mods/prompts/main.js`, `mod.json`, `logic.mjs` (pure: parse, filter, save, remove),
`test_logic.mjs`. Verify with `node prompts/mods/prompts/test_logic.mjs` and
`herdr-app check prompts/mods/prompts`.
