import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Textarea, TextareaState } from "gpui-base";
import { appHome, closeOverlay, exec, focused, props, readTextFile, run, theme, writeTextFile } from "herdr";
import { parsePrompts, projectKey, projectName, remove, save, visible } from "./logic.mjs";

// A plain file, not localStorage: an overlay window's storage file is named by a hash herdr-app may change.
const FILE = () => `${appHome()}/data/prompts.json`;

export default class Prompts extends View {
  init(_props, cx) {
    this.prompts = [];
    this.error = "";
    this.load(cx);
    this.project = "";
    this.editing = null;
    this.confirm = null;
    this.input = TextareaState.new({ placeholder: "Write a prompt… (Ctrl+Enter saves)" });
    this.input.set_auto_grow(3, 10);
    this.input.on("submit", (_e, cx) => this.store(this.project, cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    // The terminal under the panel: Insert pastes there, and its git root (else folder) is the project.
    const f = focused();
    this.pane = f?.pane ?? null;
    this.terminal = f?.shown ?? f?.terminal ?? null;
    if (!this.terminal || !f?.cwd) return;
    const at = this.terminal.lastIndexOf("/");
    const machine = at < 0 ? null : this.terminal.slice(0, at);
    this.project = projectKey(machine, f.cwd);
    cx.spawn(async (cx) => {
      const r = await exec("git", ["-C", f.cwd, "rev-parse", "--show-toplevel"], { on: machine }).catch(() => null);
      if (r?.code === 0 && r.stdout.trim()) this.project = projectKey(machine, r.stdout.trim());
      cx.notify();
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      this.raw = await readTextFile(FILE()).catch(() => null);
      this.prompts = parsePrompts(this.raw);
      cx.notify();
    });
  }

  // Writes only over the file as last read, so another window's save is never overwritten.
  write(prompts, cx) {
    this.prompts = prompts;
    const text = JSON.stringify(prompts, null, 1);
    const before = this.pending;
    this.pending = new Promise((done) => cx.spawn(async (cx) => {
      await before;
      try { await writeTextFile(FILE(), text, this.raw ?? null); this.raw = text; this.error = ""; }
      catch { this.error = "Not saved: the prompts changed elsewhere. Reloaded; try again."; this.load(cx); }
      done();
      cx.notify();
    }));
    cx.notify();
  }

  store(project, cx) {
    this.write(save(this.prompts, { id: this.editing?.id, text: this.input.value(), project }), cx);
    this.editing = null;
    this.input.set_value("");
  }

  edit(p, cx) {
    this.editing = p;
    this.input.set_value(p.text);
    this.input.focus();
    cx.notify();
  }

  // Pasted (bracketed, no Enter) into the terminal under the panel, so you can still change it before sending.
  insert(p, cx) {
    closeOverlay(props().overlay);
    if (this.pane) run("pane.focus", { pane: this.pane });
    cx.write_to_clipboard(p.text);
    run("terminal.paste");
  }

  render() {
    const t = theme();
    const shown = visible(this.prompts, this.project);
    const name = projectName(this.project);
    return v_flex().id("prompts").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(12)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); } })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Prompts"))
        .child(div().text_color(t.dim).child(name ? `${name} + global` : "global"))
        .child(this.icon(t, "prompts-close", "Close (Esc)", () => closeOverlay(props().overlay))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(Textarea.new(this.input).px(10).py(6).rounded(8).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .child(h_flex().gap(6).items_center()
        .when(Boolean(name), (el) => el.child(this.button(t, "save-project", `Save to ${name}`, true, `Only shown in ${this.project}`, (cx) => this.store(this.project, cx))))
        .child(this.button(t, "save-global", "Save global", !name, "Shown in every project", (cx) => this.store("", cx)))
        .when(Boolean(this.editing), (el) => el.child(this.button(t, "cancel-edit", "Cancel edit", false, "Keep the prompt as it was",
          (cx) => { this.editing = null; this.input.set_value(""); cx.notify(); })))
        .child(div().flex_1())
        .when(!this.terminal, (el) => el.child(div().text_color(t.dim).child("Focus a terminal to insert"))))
      .when(!shown.length, (el) => el.child(div().py(12).text_color(t.muted).child(name ? `No prompts for ${name} or global yet.` : "No global prompts yet.")))
      .child(v_flex().id("prompts-list").flex_1().min_h(0).gap(8).overflow_y_scrollbar()
        .children(shown.map((p, i) => this.card(t, p, i))));
  }

  card(t, p, i) {
    const text = p.text.length > 600 ? `${p.text.slice(0, 600)}…` : p.text;
    return v_flex().id(`prompt-${i}`).flex_none().p(10).gap(6).rounded(8).border(1)
      .border_color(this.editing?.id === p.id ? t.accent : t.border).bg(t.surface)
      .child(div().text_color(t.foreground).child(text))
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(10.5).text_color(t.dim).child(p.project ? projectName(p.project) : "global"))
        .child(div().flex_1())
        .when(Boolean(this.terminal), (el) => el.child(this.button(t, `insert-${i}`, "Insert", true, "Paste into the terminal (no Enter)", (cx) => this.insert(p, cx))))
        .child(this.button(t, `edit-${i}`, "Edit", false, "Edit above; Save to… moves it", (cx) => this.edit(p, cx)))
        .child(this.button(t, `delete-${i}`, this.confirm === p.id ? "Delete?" : "Delete", false, "Click twice to delete",
          (cx) => { if (this.confirm === p.id) { this.confirm = null; this.write(remove(this.prompts, p.id), cx); } else { this.confirm = p.id; cx.notify(); } })));
  }

  button(t, id, label, primary, tip, onClick) {
    return div().id(id).flex_none().px(8).py(3).rounded(5).text_size(11.5).font_semibold().cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.bg(primary ? t.accent : t.hover)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .child(label);
  }

  icon(t, id, tip, onClick) {
    return div().id(id).flex_none().size(18).rounded(5).flex().items_center().justify_center().text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(svg("mods/workspace-chrome/x.svg").size(11));
  }
}
