import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, ScrollHandle, Textarea, TextareaState } from "gpui-base";
import { appHome, closeOverlay, exec, focused, props, readTextFile, run, theme, writeTextFile } from "herdr";
import { count, groups, keyMachine, parsePrompts, projectKey, projectName, remove, save } from "./logic.mjs";

// A plain file, not localStorage: an overlay window's storage file is named by a hash herdr-app may change.
const FILE = () => `${appHome()}/data/prompts.json`;
// Holds a machine name to keep the prompts on that machine instead (one list for every computer).
const ON_FILE = () => `${appHome()}/data/prompts.on`;
// Reads or writes prompts.json on the `on` machine; a write lands only over the expected text (exit 4).
// shortcut: the whole list travels as one argument (Linux caps it at 128 KB, ~200 long prompts); send edits instead if it grows.
const REMOTE = `
import fcntl, os, sys, tempfile
d = os.path.join(os.path.expanduser(os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app")), "data")
p = os.path.join(d, "prompts.json")
os.makedirs(d, exist_ok=True)
with open(p + ".lock", "w") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try: cur = open(p, encoding="utf-8").read()
    except FileNotFoundError: cur = None
    if sys.argv[1] == "read":
        sys.stdout.write(cur or ""); sys.exit(0 if cur is not None else 3)
    if cur != (sys.argv[3] if len(sys.argv) > 3 else None): sys.exit(4)
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(sys.argv[2])
    os.replace(tmp, p)
`;

export default class Prompts extends View {
  init(_props, cx) {
    this.prompts = [];
    this.error = "";
    this.project = "";
    this.scope = "all";
    this.query = "";
    this.at = 0;
    this.composing = false;
    this.editing = null;
    this.confirm = null;
    this.scroll = ScrollHandle.new();
    this.search = InputState.new({ placeholder: "Search prompts…" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.at = 0; cx.notify(); });
    this.search.on("submit", (_e, cx) => { const p = this.flat()[this.at]; if (p && this.terminal) this.insert(p, cx); });
    this.input = TextareaState.new({ placeholder: "Write a prompt… (Ctrl+Enter saves)" });
    this.input.set_auto_grow(3, 8);
    this.input.on("submit", (_e, cx) => this.store(this.project, cx));
    this.search.focus();
    cx.timer.after(300, () => this.search.focus());
    // The terminal under the panel: Insert pastes there, and its git root (else folder) is the project.
    const f = focused();
    this.pane = f?.pane ?? null;
    this.terminal = f?.shown ?? f?.terminal ?? null;
    cx.spawn(async (cx) => {
      this.on = (await readTextFile(ON_FILE()).catch(() => null))?.trim() || null;
      const self = this.on ? (await exec("uname", ["-n"]).catch(() => null))?.stdout.trim() || null : null;
      this.load(cx);
      if (!this.terminal || !f?.cwd) return;
      const at = this.terminal.lastIndexOf("/");
      const machine = at < 0 ? null : this.terminal.slice(0, at);
      const key = keyMachine(machine, this.on, self);
      this.project = projectKey(key, f.cwd);
      cx.notify();
      const r = await exec("git", ["-C", f.cwd, "rev-parse", "--show-toplevel"], { on: machine }).catch(() => null);
      if (r?.code === 0 && r.stdout.trim()) this.project = projectKey(key, r.stdout.trim());
      cx.notify();
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      if (this.on) {
        const r = await exec("python3", ["-c", REMOTE, "read"], { on: this.on }).catch(() => null);
        this.raw = r?.code === 0 ? r.stdout : null;
        this.error = r && r.code <= 3 ? "" : `Can't reach ${this.on}: showing no prompts.`;
      } else this.raw = await readTextFile(FILE()).catch(() => null);
      this.prompts = parsePrompts(this.raw);
      cx.notify();
    });
  }

  async put(text) {
    if (!this.on) return writeTextFile(FILE(), text, this.raw ?? null);
    const r = await exec("python3", ["-c", REMOTE, "write", text, ...(this.raw == null ? [] : [this.raw])], { on: this.on }).catch(() => null);
    if (r?.code !== 0) throw new Error(r?.code === 4 ? "changed" : "unreachable");
  }

  // Writes only over the file as last read, so another window's save is never overwritten.
  write(prompts, cx) {
    this.prompts = prompts;
    const text = JSON.stringify(prompts, null, 1);
    const before = this.pending;
    this.pending = new Promise((done) => cx.spawn(async (cx) => {
      await before;
      try { await this.put(text); this.raw = text; this.error = ""; }
      catch (e) {
        this.error = e?.message === "unreachable" ? `Not saved: can't reach ${this.on}.` : "Not saved: the prompts changed elsewhere. Reloaded; try again.";
        this.load(cx);
      }
      done();
      cx.notify();
    }));
    cx.notify();
  }

  groups() { return groups(this.prompts, this.project, this.project || this.scope !== "project" ? this.scope : "all", this.query); }
  flat() { return this.groups().flatMap((g) => g.items); }

  store(project, cx) {
    this.write(save(this.prompts, { id: this.editing?.id, text: this.input.value(), project }), cx);
    this.compose(false, cx);
  }

  // Opens the editor (empty, or holding `p` to edit) or closes it and hands the keyboard back to search.
  compose(open, cx, p = null) {
    this.composing = open;
    this.editing = open ? p : null;
    this.input.set_value(p?.text ?? "");
    (open ? this.input : this.search).focus();
    cx.notify();
  }

  // Pasted (bracketed, no Enter) into the terminal under the panel, so you can still change it before sending.
  insert(p, cx) {
    closeOverlay(props().overlay);
    if (this.pane) run("pane.focus", { pane: this.pane });
    cx.write_to_clipboard(p.text);
    run("terminal.paste");
  }

  move(by, cx) {
    const n = this.flat().length;
    if (!n) return;
    this.at = Math.max(0, Math.min(n - 1, this.at + by));
    this.scroll.scroll_to_item(this.rowIndex.get(this.at) ?? 0);
    cx.notify();
  }

  render() {
    const t = theme();
    const name = projectName(this.project);
    const gs = this.groups();
    this.at = Math.min(this.at, Math.max(0, gs.reduce((n, g) => n + g.items.length, 0) - 1));
    // The list's direct children are headings and rows; rowIndex maps a row's place in the flat list to its child.
    const children = [];
    this.rowIndex = new Map();
    let i = 0;
    for (const g of gs) {
      children.push(this.heading(t, g, children.length));
      for (const p of g.items) { this.rowIndex.set(i, children.length); children.push(this.row(t, p, i++)); }
    }
    const tabs = [...(name ? [["project", name]] : []), ["global", "Global"], ["all", "All"]];
    return v_flex().id("prompts").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(12)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); return this.composing ? this.compose(false, cx) : closeOverlay(props().overlay); }
        if (e.key === "n" && e.modifiers.control) { cx.stop_propagation(); return this.compose(!this.composing, cx); }
        if (!this.composing && (e.key === "down" || e.key === "up")) { cx.stop_propagation(); this.move(e.key === "down" ? 1 : -1, cx); }
      })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Prompts"))
        .when(Boolean(this.on), (el) => el.child(div().text_size(11).text_color(t.dim).child(`kept on ${this.on}`)))
        .child(this.icon(t, "prompts-new", "plus.svg", "New prompt (Ctrl+N)", (cx) => this.compose(!this.composing, cx)))
        .child(this.icon(t, "prompts-close", "x.svg", "Close (Esc)", () => closeOverlay(props().overlay))))
      .child(h_flex().h(32).flex_none().gap(8).px(10).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.search).flex_1().text_color(t.foreground)))
      .child(h_flex().gap(4).items_center()
        .children(tabs.map(([id, label]) => this.tab(t, id, label, count(this.prompts, this.project, id)))))
      .when(this.composing, (el) => el.child(v_flex().gap(8).p(10).rounded(8).border_1().border_color(t.accent).bg(t.surface)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(this.editing ? "Edit prompt" : "New prompt"))
        .child(Textarea.new(this.input).px(10).py(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
        .child(h_flex().gap(6).items_center()
          .when(Boolean(name), (el) => el.child(this.button(t, "save-project", `Save to ${name}`, true, `Only shown in ${this.project}`, (cx) => this.store(this.project, cx))))
          .child(this.button(t, "save-global", "Save global", !name, "Shown in every project", (cx) => this.store("", cx)))
          .child(div().flex_1())
          .child(this.button(t, "cancel-edit", "Cancel", false, "Esc", (cx) => this.compose(false, cx))))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!children.length, (el) => el.child(div().py(16).text_color(t.muted).child(
        this.query.trim() ? `No prompts match “${this.query.trim()}”.` : "No prompts here yet. Ctrl+N adds one.")))
      .child(v_flex().id("prompts-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar().track_scroll(this.scroll).children(children))
      .child(div().text_size(10.5).text_color(t.dim).child(this.terminal ? "↑ ↓ select · Enter insert · Ctrl+N new · Esc close" : "Focus a terminal to insert · Ctrl+N new · Esc close"));
  }

  tab(t, id, label, n) {
    const on = (this.project || id !== "project") && this.scope === id;
    return h_flex().id(`tab-${id}`).flex_none().gap(5).px(10).py(4).rounded(6).items_center().cursor_pointer()
      .bg(on ? t.raised : t.popover).hover((s) => s.bg(on ? t.raised : t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.scope = id; this.at = 0; cx.notify(); })
      .child(div().text_size(11.5).font_semibold().text_color(on ? t.foreground : t.muted).child(label))
      .child(div().text_size(10.5).text_color(t.dim).child(String(n)));
  }

  heading(t, g, key) {
    const here = g.key && g.key === this.project;
    return h_flex().id(`group-${key}`).flex_none().gap(6).pt(key ? 10 : 2).pb(4).items_center()
      .child(div().text_size(10.5).font_bold().text_color(here ? t.accent : t.dim).child(g.title.toUpperCase()))
      .child(div().text_size(10.5).text_color(t.dim).child(String(g.items.length)))
      .child(div().flex_1().h(1).bg(t.border));
  }

  row(t, p, i) {
    const picked = i === this.at;
    return h_flex().id(`prompt-${i}`).flex_none().gap(8).px(10).py(7).rounded(7).items_center().cursor_pointer()
      .bg(picked ? t.hover : t.popover).border_1().border_color(this.editing?.id === p.id ? t.accent : picked ? t.border : t.popover)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.at = i; cx.notify(); })
      .when(p.text.length > 120 || p.text.includes("\n"), (el) => el.tooltip(p.text.length > 2000 ? `${p.text.slice(0, 2000)}…` : p.text))
      // Two lines at most: the full text is in the tooltip.
      .child(div().flex_1().min_w(0).line_height("18px").max_h(36).overflow_hidden().text_color(t.foreground).child(p.text))
      .when(Boolean(this.terminal), (el) => el.child(this.button(t, `insert-${i}`, "Insert", picked, "Paste into the terminal (no Enter)", (cx) => this.insert(p, cx))))
      .child(this.icon(t, `edit-${i}`, "square-pen.svg", "Edit (Save to… moves it)", (cx) => this.compose(true, cx, p)))
      .child(this.confirm === p.id
        ? this.button(t, `delete-${i}`, "Delete?", false, "Click again to delete", (cx) => { this.confirm = null; this.write(remove(this.prompts, p.id), cx); }, t.blocked)
        : this.icon(t, `delete-${i}`, "x.svg", "Delete (click twice)", (cx) => { this.confirm = p.id; cx.notify(); }));
  }

  button(t, id, label, primary, tip, onClick, color = null) {
    return div().id(id).flex_none().px(8).py(3).rounded(5).text_size(11.5).font_semibold().cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(color ?? (primary ? t.solid_foreground : t.foreground))
      .hover((s) => s.bg(primary ? t.accent : t.hover)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(label);
  }

  icon(t, id, file, tip, onClick) {
    return div().id(id).flex_none().size(22).rounded(5).flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
      .hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(svg(`mods/workspace-chrome/${file}`).size(12));
  }
}
