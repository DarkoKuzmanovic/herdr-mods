# Copy on select

Hold Shift, drag across text in any Herdr terminal, and it's on the clipboard as soon as the pointer
stops, with one short **Copied** toast. Shift also makes Herdr select text in agents and programs
that take the mouse (Claude Code, Hermes, vim), so the same gesture works everywhere. A plain drag
copies nothing: nothing reaches the clipboard without the modifier.

## How it behaves

- **Shift + left-drag, then stop:** after the pointer has been still for 250 ms, `terminal.copy`
  runs and a `success` toast says *Copied* (1.5 s). One toast per drag.
- **Pause mid-drag:** the partial selection is copied; keep dragging and the final selection is
  copied again when the pointer settles (no second toast).
- **Shift-click without moving (4 px or less):** nothing.
- **Ctrl, Alt or Super held, right or middle button, no Shift:** nothing.
- **Any new press, the window losing focus, 1.75 s of stillness after the copy, or 30 s:** the
  watch ends.
- **No terminal focused:** nothing.

## Built from

- `mods/copy-on-select/`: `main.js`, `mod.json` = `{ "place": "none" }`, `logic.mjs` (pure, tested
  by `test_logic.mjs` under node).
- The layout gets one block `{ "id": "copy-on-select", "type": "block", "content": { "mod":
  "copy-on-select" }, "size": { "px": 0 } }`, e.g. in the status row.
- `render` returns one `div().size_full().on_mouse_down_out(...)`. The element is 0px, so every press
  in the window, terminals included, counts as outside: the only way a mod sees terminal presses.
- On a Shift + left press: `cx.timer.every(40, ...)` samples `window.mouse_position()` and feeds
  `tick()` in `logic.mjs`, which answers `wait`, `copy` or `stop`.
- `herdr` functions: `focused`, `run("terminal.copy")`, `notify`. No `exec`, no OS helper.

## Watch out

- **Mods never see releases** and Linux has no unprivileged way to ask whether a button is down
  (macOS has `NSEvent.pressedMouseButtons`). So "drag is over" is guessed from the pointer standing
  still. Holding still mid-drag copies early; the final copy still happens when you stop at the end.
- **It can't tell whether anything was selected.** A Shift-drag that selects nothing still runs
  `terminal.copy` (a no-op) and shows the toast.
- **Only active in layouts that contain its block.**

## Done when

- `node mods/copy-on-select/test_logic.mjs` prints `ok`; `herdr-app check mods/copy-on-select` passes.
- Shift-dragging over terminal text and stopping puts exactly that text on the clipboard
  (`wl-paste`) and shows one *Copied* toast.
- A plain drag and a Shift-click copy nothing.
