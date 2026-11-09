# Open markdown

Build a standalone Herdr overlay that lists the markdown files named in the focused terminal and
opens the picked one in `fresh` (a terminal text editor) in a split to the right. Open it with
`mod.open:md-open` (for example bind `alt-o` in `keys.json`). Arrow keys and Enter, or a click, open
a file; Escape closes the overlay.

Read the focused terminal (`focused()`: its `shown` terminal, else `terminal`) with
`hc read --lines 2000 <address>` run on that terminal's machine (`machine/t7` names another machine's
terminal). Find paths ending in `.md` or `.markdown`: absolute, `~/`, `./`, `../` or bare relative,
also when followed by `:12` or punctuation; not URLs or `.mdx`. List the newest (lowest on screen)
first, each once. Keep only paths that are files on that machine, made absolute: relative ones against
the focused terminal's folder, `~/` against that machine's home. Do that with one constant `sh -c`
script that takes the paths as arguments; never put a path into script text.

Open with `pane.split {direction: "right", pane, argv: ["fresh", path]}`; a layout terminal block has
no pane, so open a new tab with that argv instead. Programs on the alternate screen (Hermes TUI, editors)
have no history, so only what is on screen is found. A path a program wrapped across two lines is not
found.

Mod files: `mods/md-open/main.js`, `mod.json`, `logic.mjs`, `test_logic.mjs`.
Verify with `node md-open/mods/md-open/test_logic.mjs` and `herdr-app check md-open/mods/md-open`.
