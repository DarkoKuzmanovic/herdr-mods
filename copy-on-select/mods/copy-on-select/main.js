// Copy on select: Shift-drag a selection in any terminal and it's on the clipboard when the pointer
// settles, with one "Copied" toast. Plain drags (and agents that select with the mouse themselves)
// are left alone: only a Shift-press is watched, so nothing copies without the modifier.
//
// Mods see presses (on_mouse_down_out on a 0px block) but not releases, so logic.mjs decides from
// pointer movement when the drag is over. Any new press ends the watch.

import { View, div } from "gpui-kit";
import { focused, run, notify } from "herdr";
import { start, tick } from "./logic.mjs";

const TICK_MS = 40;

export default class CopyOnSelect extends View {
  init(_props, _cx) {
    this.press = 0; // bumps on every press, so an older watch stops
  }

  onPress(event, cx) {
    const press = ++this.press;
    const m = event.modifiers;
    if (event.button !== "left" || !m.shift || m.control || m.alt || m.platform) return;

    const s = start(event.position, Date.now());
    let toasted = false;
    const watch = cx.timer.every(TICK_MS, () => {
      const step = press !== this.press || !window.is_window_active() ? "stop" : tick(s, window.mouse_position(), Date.now());
      if (step === "stop") return watch.cancel();
      if (step !== "copy" || !focused()?.terminal) return;
      run("terminal.copy"); // no-op when nothing is selected
      if (!toasted) notify({ title: "Copied", level: "success", timeout: 1500 });
      toasted = true;
    });
  }

  render(_cx) {
    return div()
      .id("copy-on-select")
      .size_full()
      .on_mouse_down_out((event, cx) => this.onPress(event, cx));
  }
}
