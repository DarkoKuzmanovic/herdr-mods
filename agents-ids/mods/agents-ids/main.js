// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// agents-ids: a copy of Herdr's shipped `agents` mod, plus a second row line with the terminal
// address and the agent's session id, read from the terminal label `agent.session` (set by
// integrations/ in github.com/DarkoKuzmanovic/herdr-mods, or by any agent: `hc label $HC_TERMINAL_ID agent.session=<id>`).
// Ctrl-click the line: copy the session id; Shift-click: copy the address. Below the agents, "Recent
// sessions": agents that ended in a terminal, with Resume. Merge `agents` updates via the repo's upstream branch.
// A viewed done agent stays in Done until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, notify, playSound } from "herdr";
import { closeFacts, sameTerminal, doingLine, hideSession, machineOf, projectOf, recentSessions, rememberSessions, resumeSpace, shortSid, stalls } from "./extras.mjs";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
  { id: "project", label: "Grouped by project", icon: "folder" }, // agents-ids
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    // agents-ids: a separate dialog view checks the exact terminal's machine and folder.
    if (props()?.closeTarget) {
      this.handle = cx.focus_handle();
      this.handle.focus();
      this.gitCount = null;
      const target = terminals().find(k => k.address === props().closeTarget);
      const on = target?.address.includes("/") ? target.address.split("/")[0] : null;
      if (target?.cwd) cx.spawn(async (cx) => {
        try {
          const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", target.cwd, "status", "--porcelain"], { on });
          if (r.code === 0) this.gitCount = r.stdout ? r.stdout.trimEnd().split("\n").length : 0;
        } catch {}
        cx.notify();
      });
      return;
    }
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // agents-ids: each folder's git common dir (null: not a repo, or not asked yet), for "Grouped by project".
    // shortcut: never re-asked, so a folder that becomes a repo later groups by folder until restart.
    this.repos = new Map();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Agent sessions seen in a terminal (sid -> where, when), for Recent sessions.
    this.remembered = JSON.parse(localStorage.getItem("sessions") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // agents-ids: one notification per stall, with the attention sound; clicking it focuses the agent.
  alertStalls(list, all, now) {
    if (!list.length) return; // empty right after a start; forgetting the alerted stalls would repeat them
    const labels = new Map(all.map((k) => [k.address, k.labels ?? {}]));
    const found = stalls(list, (addr) => labels.get(addr) ?? {}, this.changed, now);
    // Stalls already alerted, read each time: a restart or a second copy of the mod doesn't repeat them.
    const before = localStorage.getItem("alerted") ?? "[]";
    const alerted = new Set(JSON.parse(before));
    for (const s of found.filter((s) => !alerted.has(s.key))) {
      const a = list.find((x) => x.address === s.address);
      notify({ title: `${a.program?.name ?? "Agent"} in ${a.space_name} looks stuck`, body: s.text, level: "warning", action: { name: "agent.focus", args: { terminal: s.address } } });
      playSound("blocked");
    }
    const keys = JSON.stringify(found.map((s) => s.key));
    if (keys !== before) localStorage.setItem("alerted", keys);
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // agents-ids: an ended session reopens in a new tab, never typed into its old terminal (that would
  // submit whatever half-typed line is there), on its own machine, in its folder if that still exists.
  resume(r) {
    const space = resumeSpace(spaces(), r);
    if (!space) return; // shortcut: its machine has no space open here, so nothing happens; show why if it bites.
    const open = (folder) => run("tab.new", { space, folder, argv: r.argv });
    if (!r.cwd) return open(undefined);
    exec("test", ["-d", r.cwd], { on: machineOf(r.address) }).then((x) => open(x.code === 0 ? r.cwd : undefined), () => open(undefined));
  }

  recentRow(t, r) {
    return h_flex()
      .id(`recent-${r.sid}`)
      .px(8)
      .h(28)
      .flex_none()
      .rounded(8)
      .gap(6)
      .items_center()
      .text_size(12)
      .hover((s) => s.bg(t.hover))
      .tooltip(`${r.argv.join(" ")}\nin a new tab${r.cwd ? `, ${r.cwd}` : ""}\nsession ${r.sid}, last in ${r.address}\nctrl-click: copy session id`)
      .on_click((e, cx) => e?.modifiers?.control && cx.write_to_clipboard(r.sid))
      .child(div().flex_none().text_color(t.muted).child(r.app))
      // The folder says which work it was; a closed terminal's address may belong to another by now.
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${r.cwd ? r.cwd.replace(/\/+$/, "").split("/").pop() : r.address} \u00b7 ${shortSid(r.sid)}`))
      .child(div()
        .id(`resume-${r.sid}`)
        .flex_none()
        .px(6)
        .h(18)
        .rounded(5)
        .flex()
        .items_center()
        .text_size(10.5)
        .font_semibold()
        .text_color(t.accent)
        .bg(t.accent + "1f")
        .hover((s) => s.bg(t.accent + "3d"))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.resume(r);
        })
        .child("Resume"))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(duration(Date.now() - r.seen)))
      .child(this.xButton(t, `forget-${r.sid}`, "Remove from Recent sessions", (cx) => this.hide([r.sid], cx)));
  }

  // agents-ids: hide sessions from Recent sessions until they run again.
  hide(sids, cx) {
    this.remembered = sids.reduce(hideSession, this.remembered);
    localStorage.setItem("sessions", JSON.stringify(this.remembered));
    cx.notify();
  }

  xButton(t, id, tip, onClick) {
    return div()
      .id(id)
      .flex_none()
      .size(18)
      .rounded(5)
      .flex()
      .items_center()
      .justify_center()
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(svg("mods/workspace-chrome/x.svg").size(11));
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { if (on) this.hovered = k.address; else if (this.hovered === k.address) this.hovered = null; cx.notify(); })
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .when(this.hovered === k.address, el => el.child(this.xButton(t, `close-${k.address}`, "Check before closing agent", () => this.askClose(k.address))))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  // agents-ids: confirmation never describes an unknown check as safe.
  closeDialog(t) {
    const p = props();
    const all = terminals();
    const target = all.find(k => k.address === p.closeTarget && k.state === "live");
    const status = agents().find(a => a.address === p.closeTarget)?.status ?? target?.status;
    const children = target ? this.tree(all, p.closeTarget).length : null;
    const facts = closeFacts(status, this.gitCount, children);
    const colors = [status === "working" || !status ? t.blocked : t.muted, this.gitCount === 0 ? t.muted : t.blocked, children === 0 ? t.muted : t.blocked, t.blocked];
    const button = (id, text, click) => div().id(id).px(14).h(32).rounded(8).flex().items_center().bg(t.raised).text_color(t.foreground).hover(s => s.bg(t.hover)).on_click(click).child(text);
    return v_flex().id("close-check").track_focus(this.handle).size_full().p(18).gap(10).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Safe to close?"))
      .children(facts.map((fact, i) => div().text_size(12).text_color(colors[i]).child(fact)))
      .child(div().flex_1().text_size(12).text_color(this.closeError ? t.blocked : t.muted).child(this.closeError || "Closing ends this terminal and all its sub-agents."))
      .child(h_flex().justify_end().gap(8)
        .child(button("close-cancel", "Cancel", () => closeOverlay(p.overlay)))
        .child(button("close-confirm", "Close", (_e, cx) => {
          if (!sameTerminal(p.identity, terminals().find(k => k.address === p.closeTarget))) {
            this.closeError = "Terminal changed, not closed"; cx.notify(); return;
          }
          run("terminal.kill", { terminal: p.closeTarget }); closeOverlay(p.overlay);
        })));
  }

  askClose(address) {
    const target = terminals().find(k => k.address === address && k.state === "live");
    if (!target) return;
    const identity = { address, state: target.state, created_ms: target.created_ms, labels: { "agent.session": target.labels?.["agent.session"] } };
    openOverlay({ mod: "agents-ids", kind: "dialog", width: 380, height: 255, props: { closeTarget: address, identity } });
  }

  render(cx) {
    const t = theme();
    if (props()?.closeTarget) return this.closeDialog(t);
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    this.sessions = new Map(all.map((k) => [k.address, k.labels?.["agent.session"]]));
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.alertStalls(list, all, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    // agents-ids: "Grouped by project" asks git once per folder; the stable sort keeps space order inside a project.
    const byProject = sort.id === "project";
    const project = new Map();
    if (byProject) {
      const cwds = new Map(all.map((k) => [k.address, k.cwd ?? ""]));
      for (const a of list) {
        const on = machineOf(a.address), cwd = cwds.get(a.address) ?? "", key = `${on ?? ""}:${cwd}`;
        if (cwd && !this.repos.has(key)) {
          this.repos.set(key, null);
          cx.spawn(async (cx) => {
            try {
              const r = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { on });
              if (r.code === 0 && r.stdout.trim()) { this.repos.set(key, r.stdout.trim()); cx.notify(); }
            } catch {}
          });
        }
        project.set(a.address, projectOf(on, cwd, this.repos.get(key)));
      }
      list = [...list].sort((x, y) => {
        const p = project.get(x.address), q = project.get(y.address);
        return p.name.localeCompare(q.name) || p.key.localeCompare(q.key);
      });
    }
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || byProject || isPinned; // agents-ids: a project spans spaces, so its rows name theirs
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const sid = this.sessions.get(a.address);
      // agents-ids: the activity label is optional for integrations that don't report it.
      const doing = doingLine(all.find((k) => k.address === a.address)?.labels, a.status, now);
      const ids = h_flex()
        .id(`ids-${a.address}`)
        .min_w(0)
        .text_size(11)
        .tooltip(sid ? `terminal ${a.address}\nsession ${sid}\nctrl-click: copy session id \u00b7 shift-click: copy address` : `terminal ${a.address}\nshift-click: copy address`)
        .on_click((e, cx) => {
          // agents-ids: a plain click falls through to the row; only ctrl/shift copy.
          const copy = e?.modifiers?.shift ? a.address : e?.modifiers?.control ? sid : null;
          if (!copy) return;
          cx.stop_propagation();
          cx.write_to_clipboard(copy);
        })
        // agents-ids: the machine shows at the right, so a remote address keeps only its id and the session id fits.
        .child(div().flex_none().text_color(t.accent).child(machine ? a.address.slice(machine.length + 1) : a.address))
        .when(Boolean(sid), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(` \u00b7 ${shortSid(sid)}`)));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(doing ? 58 : 44)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(5).items_center()
            .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
            .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
          .child(ids)
          .when(Boolean(doing), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(doing.stale ? t.blocked : t.dim).tooltip(doing.tip || doing.text).child(doing.text))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin).child(this.xButton(t, `close-${a.address}`, "Check before closing agent", () => this.askClose(a.address))))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : byProject ? `pr-${project.get(a.address).key}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : byProject ? project.get(a.address).name : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(Boolean(g.clear), (el) => el.child(this.xButton(t, `${g.id}-clear`, "Clear Recent sessions", g.clear)))
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    const store = rememberSessions(this.remembered, all, this.listed, now);
    if (store !== this.remembered) localStorage.setItem("sessions", JSON.stringify((this.remembered = store)));
    // agents-ids: 5 recent sessions, all remembered ones after "Show more".
    const recent = collapsed ? [] : recentSessions(all, this.listed, store, Infinity);
    const recentShown = this.recentAll ? recent : recent.slice(0, 5);
    const toggle = () => h_flex().id("recent-more").px(8).h(24).flex_none().items_center().text_size(11).text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.recentAll = !this.recentAll; cx.notify(); })
      .child(this.recentAll ? "Show less" : `Show ${recent.length - 5} more`);
    if (recent.length) rows.push(header({ id: "recent", label: "Recent sessions", status: null, members: recent, clear: (cx) => this.hide(recent.map((r) => r.sid), cx) }),
      ...(this.folded.has("recent") ? [] : [...recentShown.map((r) => this.recentRow(t, r)), ...(recent.length > 5 ? [toggle()] : [])]));

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-ids", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
