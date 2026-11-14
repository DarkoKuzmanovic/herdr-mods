import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, exec, panes, props, readTextFile, run, setShared, shared, spaces, theme } from "herdr";
import { age, badge, continueTab, folders, parseNotes, resumeArgv, spaceFor, yourTurn } from "./logic.mjs";

// Bumped after a tick or a done, so the other copy (status-bar badge or panel) looks again at once.
const REV = "handovers.rev";
const base = (p) => String(p).split("/").filter(Boolean).pop() ?? p;

export default class Handovers extends View {
  // Two copies: the status-bar block (the badge), and the panel that `mod.open:handovers` opens as a window.
  init(_props, cx) {
    this.panel = Boolean(props()?.overlay);
    this.notes = null;
    this.error = "";
    this.rev = shared(REV);
    this.refresh(cx);
    cx.timer.every(this.panel ? 15000 : 60000, (cx) => this.refresh(cx));
    // Look again at once after a change elsewhere, or when the folders change (a space opens, or the app
    // has just started and its spaces weren't loaded yet).
    cx.timer.every(1000, (cx) => {
      const where = JSON.stringify(folders(spaces(), panes()));
      if (shared(REV) === this.rev && where === this.where) return;
      this.rev = shared(REV);
      this.refresh(cx);
    });
  }

  refresh(cx) {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/handovers/handovers.py`);
        if (!this.script) throw new Error("helper missing");
        // The helper runs on each space's machine as source; folders travel as arguments, never as script.
        const targets = folders(spaces(), panes());
        this.where = JSON.stringify(targets);
        const found = await Promise.all(targets.map(async ({ machine, dirs }) => {
          try {
            const r = await exec("python3", ["-c", this.script, "list", ...dirs], { on: machine });
            if (r.code !== 0) throw new Error(r.stderr);
            return { notes: parseNotes(r.stdout, machine), failed: false };
          } catch { return { notes: [], failed: true }; }
        }));
        this.notes = found.flatMap((f) => f.notes).sort((a, b) => Number(yourTurn(b)) - Number(yourTurn(a)) || b.mtime - a.mtime);
        this.error = found.some((f) => f.failed) ? "Some machines could not be read." : "";
      } catch {
        this.error = "Could not load the handovers helper.";
      }
      this.busy = false;
      cx.notify();
      if (this.again) { this.again = false; this.refresh(cx); }
    });
  }

  // Writes go through the helper on the note's machine: it checks the path is a handover note.
  change(note, args, cx) {
    cx.spawn(async (cx) => {
      const r = await exec("python3", ["-c", this.script, ...args], { on: note.machine }).catch(() => null);
      this.error = r?.code === 0 ? "" : `Could not update “${note.title}”: ${r?.stderr?.trim() || "machine unreachable"}`;
      setShared(REV, Date.now());
      this.rev = shared(REV);
      this.refresh(cx);
    });
  }

  open(note, argv, extra, cx) {
    const space = spaceFor(note, spaces());
    if (!space || !argv) { this.error = "Open a space on that machine first."; return cx.notify(); }
    run("tab.new", { space: space.id, folder: note.root, argv, ...extra });
  }

  render() {
    const t = theme();
    return this.panel ? this.renderPanel(t) : this.renderBadge(t);
  }

  renderBadge(t) {
    const notes = this.notes ?? [];
    const mine = notes.some(yourTurn);
    return h_flex().id("handovers").size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().text_size(11.8)
      .child(h_flex().id("handovers-trigger").h_full().px(14).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(`Handovers: ${notes.length} open${mine ? ", your turn on some" : ""}. Click: open the panel (Ctrl+Shift+H)${this.error ? `\n${this.error}` : ""}`)
        .on_click(() => run("mod.open", { name: "handovers" }))
        .child(svg("mods/workspace-chrome/file-text.svg").size(13).flex_none().text_color(mine ? t.blocked : t.muted))
        .child(div().text_color(mine ? t.blocked : notes.length ? t.muted : t.dim).child(badge(notes))));
  }

  renderPanel(t) {
    const notes = this.notes ?? [];
    return v_flex().id("handovers-panel").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(12)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Handovers"))
        .child(div().text_color(t.dim).child(this.busy ? "looking…" : `${notes.length} open`))
        .child(this.icon(t, "handovers-close", "Close", () => closeOverlay(props().overlay))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(this.notes !== null && !notes.length, (el) => el.child(v_flex().gap(4).py(12)
        .child(div().text_color(t.muted).child("No open handovers in your spaces."))
        .child(div().text_color(t.dim).child("Agents write them as .hermes/plans/*-handover.md in a repo."))))
      .child(v_flex().id("handovers-list").flex_1().min_h(0).gap(10).overflow_y_scrollbar()
        .children(notes.map((n, i) => this.card(t, n, i))));
  }

  card(t, n, i) {
    const mine = yourTurn(n);
    const resume = resumeArgv(n);
    return v_flex().id(`card-${i}`).flex_none().p(12).gap(8).rounded(8).border(1).border_color(mine ? t.blocked + "66" : t.border).bg(t.surface)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.muted).child(base(n.root)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(n.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(age(n.mtime)))
        .child(this.icon(t, `done-${i}`, "Done: hide this handover (writes status: done into the note)", (cx) => this.change(n, ["done", n.path], cx))))
      .children(n.you.map((item, j) => h_flex().id(`you-${i}-${j}`).gap(8).items_start().cursor_pointer()
        .tooltip(item.done ? "Untick" : "Tick: marks it done in the note")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => this.change(n, ["tick", n.path, String(j)], cx))
        .child(div().flex_none().text_color(item.done ? t.done : t.blocked).child(item.done ? "☑" : "☐"))
        .child(div().flex_1().min_w(0).text_color(item.done ? t.dim : t.foreground).when(item.done, (el) => el.line_through()).child(`You: ${item.text}`))))
      .children(n.agent.map((line, j) => h_flex().id(`agent-${i}-${j}`).gap(8).items_start()
        .child(div().flex_none().text_color(t.accent).child("◇"))
        .child(div().flex_1().min_w(0).text_color(t.muted).child(j ? line : `Agent: ${line}`))))
      .child(h_flex().gap(6).items_center().pt(2)
        .child(this.button(t, `continue-${i}`, "New agent", true, "A new tab with a fresh agent that starts by reading this note",
          (cx) => { const c = continueTab(n); this.open(n, c.argv, { name: n.title.slice(0, 30), ...(c.task ? { task: c.task } : {}) }, cx); }))
        .when(Boolean(resume), (el) => el.child(this.button(t, `resume-${i}`, "Old session", false, `Reopen the session that wrote this note, with its whole history: ${resume?.join(" ")}`,
          (cx) => this.open(n, resume, { name: n.title.slice(0, 30) }, cx))))
        .child(this.button(t, `note-${i}`, "Note", false, `Open ${n.path} in fresh`,
          (cx) => this.open(n, ["fresh", n.path], { name: "handover" }, cx)))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child(n.machine ? `${n.machine}` : "")));
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
