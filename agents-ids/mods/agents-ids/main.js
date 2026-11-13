// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// agents-ids: a copy of Herdr's shipped `agents` mod, plus a second row line with the terminal
// address and the agent's session id, read from the terminal label `agent.session` (set by
// integrations/ in github.com/DarkoKuzmanovic/herdr-mods, or by any agent: `hc label $HC_TERMINAL_ID agent.session=<id>`).
// Ctrl-click the line: copy the session id; Shift-click: copy the address. Below the agents, "Recent
// sessions": agents that ended in a terminal, with Resume. Merge `agents` updates via the repo's upstream branch.
// A viewed done agent stays in Done until left. "Save & close sessions" (agents-ids.unload) saves every agent's
// session to a snapshot file and closes the tabs safe to close; "Reopen" (agents-ids.load) brings them back.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, notify, playSound, appHome, readTextFile, home, writeTextFile, nextCommand, machines } from "herdr";
import { briefName, closeFacts, effStatus, herds, herdSummary, inputBox, sameTerminal, thirdLine, hideSession, machineOf, projectOf, recentSessions, rememberSessions, resumeSpace, shortSid, stalls, reopenable, reopenSpace, reopenSummary, resumeArgv, runningSids, snapshotOf, snapshotPath, unloadRows, ICON_SETS, iconSet } from "./extras.mjs";

// agents-ids: the snapshot is written on this computer, its folder made first.
async function writeSnapshot(snap) {
  const path = snapshotPath(home(), appHome());
  const made = await exec("mkdir", ["-p", path.replace(/\/[^/]+$/, "")]);
  if (made.code !== 0) throw new Error(made.stderr.trim() || "can't make its folder");
  await writeTextFile(path, `${JSON.stringify(snap, null, 2)}\n`, await readTextFile(path));
}

async function readSnapshot() {
  try {
    const snap = JSON.parse((await readTextFile(snapshotPath(home(), appHome()))) ?? "null");
    return Array.isArray(snap?.rows) ? snap : null;
  } catch {
    return null;
  }
}

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
// agents-ids: "asks" (a finished agent's Next line asks for you) sits with Needs you; "waiting" (background
// jobs will wake it) gets its own section after Working.
const RANK = { blocked: 4, asks: 4, done: 3, working: 2, waiting: 1.5, idle: 1 };
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
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1.5: "Waiting", 1: "Idle" };
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
    if (props()?.unload) return this.initUnload(cx); // agents-ids
    this.folded = new Set();
    // agents-ids: each folder's git common dir (null: not a repo, or not asked yet), for "Grouped by project".
    // shortcut: never re-asked, so a folder that becomes a repo later groups by folder until restart.
    this.repos = new Map();
    this.names = new Map(); // agents-ids: sid -> session name from the agent's own history, "" when it has none
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Agent sessions seen in a terminal (sid -> where, when), for Recent sessions.
    this.remembered = JSON.parse(localStorage.getItem("sessions") ?? "{}");
    // agents-ids: "Send to several": picked agents and the message box.
    this.picked = new Set();
    this.msg = InputState.new({ placeholder: "Message to the picked agents…" });
    this.msg.on("submit", (_e, cx) => this.sendPicked(cx));
    cx.timer.every(30000, (cx) => cx.notify());
    // agents-ids: keys for Save & close / Reopen.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "unload") this.toggleUnload();
        else if (c === "load") this.reopen(cx);
        cx.notify();
      }
    });
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

  // agents-ids: the status a row shows (asks, waiting) from its labels; Herdr's own otherwise.
  eff(a) {
    return effStatus(a.status, this.labelsOf?.get(a.address));
  }

  rank(a) {
    const e = this.eff(a);
    if (e !== a.status) return RANK[e];
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
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))))
      // agents-ids: status icon sets, each previewed with its six states.
      .child(div().px(8).pt(10).pb(6).mt(4).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child("Status icons"))
      .children(ICON_SETS.map((s) => h_flex()
        .id(`icons-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).hover((el) => el.bg(t.hover))
        .on_click(() => { setShared("agents-ids.icons", s.id); closeOverlay(props().overlay); })
        .child(div().w(62).flex_none().whitespace_nowrap().child(s.label))
        .child(h_flex().flex_1().gap(4).items_center().children(["working", "blocked", "asks", "waiting", "idle", "done"].map((k) => this.status(t, { status: k }, true, s))))
        .when(s.id === iconSet(shared("agents-ids.icons")).id, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
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

  // agents-ids: names for Recent sessions, asked once per session on its own machine via names.py.
  fetchNames(recent, cx) {
    const ask = recent.filter((r) => !this.names.has(r.sid));
    for (const r of ask) this.names.set(r.sid, "");
    // One run per machine, each on its own: an unreachable machine leaves only its rows unnamed.
    for (const on of new Set(ask.map((r) => machineOf(r.address)))) {
      cx.spawn(async (cx) => {
        try {
          const script = await readTextFile(`${appHome()}/mods/agents-ids/names.py`);
          const args = ask.filter((r) => machineOf(r.address) === on).map((r) => `${r.app}:${r.sid}`);
          const res = await exec("python3", ["-c", script, ...args], { on });
          if (res.code !== 0) return;
          for (const [sid, name] of Object.entries(JSON.parse(res.stdout))) if (typeof name === "string") this.names.set(sid, name);
          cx.notify();
        } catch {}
      });
    }
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
      .tooltip(`${this.names.get(r.sid) ? `${this.names.get(r.sid)}\n` : ""}${r.argv.join(" ")}\nin a new tab${r.cwd ? `, ${r.cwd}` : ""}\nsession ${r.sid}, last in ${r.address}\nctrl-click: copy session id`)
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

  // agents-ids: a line too long for the panel runs as a ticker while the pointer is on its row. A mod
  // can't measure text before it is drawn, so the widths come from mouse moves over the line and its text.
  // The ticker is two copies of the text sliding left natively (transition); once one copy has passed,
  // a new element id puts it back at 0 without animating, which looks the same, and the next lap starts.
  // The row's hover drives it: the line's own hover ends whenever the sliding text passes under the pointer.
  marquee(el, id, text, tip, on) {
    if (!on) {
      if (this.scrolling?.id === id) this.scrolling = null;
      return el.truncate().tooltip(tip).child(text);
    }
    const m = this.scrolling?.id === id ? this.scrolling : (this.scrolling = { id, box: 0, text: 0, lap: 0, run: false });
    const lap = m.text + 40; // 40 px gap
    const ms = () => (m.text + 40) * 18; // about 55 px a second; read late, as go() outlives the render that measured
    const go = (cx) => cx.timer.after(m.lap ? 0 : 1000, (cx) => {
      if (this.scrolling !== m) return;
      m.run = true; cx.notify();
      cx.timer.after(ms(), (cx) => { if (this.scrolling === m) { m.run = false; m.lap++; cx.notify(); go(cx); } });
    });
    const measure = (k) => (e, cx) => {
      if (!e.bounds || m.started || m[k] === e.bounds.width) return;
      m[k] = e.bounds.width;
      if (m.box && m.text - m.box > 1) { m.started = true; cx.notify(); go(cx); }
      else if (m.box && m.text) cx.notify(); // fits: the tooltip comes back
    };
    return el.relative().overflow_hidden().on_mouse_move(measure("box"))
      .when(Boolean(m.box && m.text && m.text - m.box <= 1), (el) => el.tooltip(tip))
      .child(div().invisible().truncate().child(text)) // keeps the line's height
      .child(m.started
        ? h_flex().id(`${id}-lap${m.lap}`).absolute().top(0).left(m.run ? -lap : 0).transition("left", { duration: ms(), easing: "linear" }).whitespace_nowrap()
          .child(div().flex_none().child(text)).child(div().flex_none().pl(40).child(text))
        : div().absolute().top(0).left(0).whitespace_nowrap().on_mouse_move(measure("text")).child(text));
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
  status(t, a, compact = false, set = iconSet(shared("agents-ids.icons"))) {
    const color = t[a.status] ?? t.dim;
    // agents-ids: a picked icon set (header menu) draws Lucide icons; the Needs you / Your turn badges stay.
    const pick = set.icons?.[a.status];
    if (pick && (compact || (a.status !== "blocked" && a.status !== "asks"))) {
      const c = a.status === "asks" ? t.accent : a.status === "waiting" ? t.dim : a.status === "idle" ? t.idle ?? t.dim : color;
      return svg(`mods/agents-ids/icons/${pick}.svg`).size(12).mx(1).flex_none().text_color(c).when(a.status === "working" && Boolean(set.spin), (el) => el.spin(900));
    }
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // agents-ids: finished, and its Next line asks for you; or parked until a background job wakes it.
    if (a.status === "asks" && compact) return div().size(14).flex_none().rounded(4).bg(t.accent + "26").text_size(10.5).font_bold().text_color(t.accent).flex().items_center().justify_center().child("?");
    if (a.status === "asks") return div().flex_none().px(6).h(18).rounded(5).bg(t.accent + "26").text_size(10.5).font_semibold().text_color(t.accent).flex().items_center().child("Your turn");
    if (a.status === "waiting") return svg("mods/workspace-chrome/clock.svg").size(12).mx(1).flex_none().text_color(t.dim);
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
    const crew = herds(all).byLead.get(p.closeTarget)?.length ?? 0; // agents-ids
    const facts = closeFacts(status, this.gitCount, children, crew);
    const colors = [status === "working" || !status ? t.blocked : t.muted, this.gitCount === 0 ? t.muted : t.blocked, children === 0 ? t.muted : t.blocked, t.blocked, t.muted];
    const button = (id, text, click) => div().id(id).px(14).h(32).rounded(8).flex().items_center().bg(t.raised).text_color(t.foreground).hover(s => s.bg(t.hover)).on_click(click).child(text);
    return v_flex().id("close-check").track_focus(this.handle).size_full().p(18).gap(10).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Safe to close?"))
      .children(facts.map((fact, i) => div().text_size(12).text_color(colors[i]).child(fact)))
      .child(div().flex_1().text_size(12).text_color(this.closeError ? t.blocked : t.muted).child(this.closeError || `Closing ends this terminal and all its sub-agents.${crew ? " Its herd's tabs keep running." : ""}`))
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
    const crew = herds(terminals()).byLead.get(address)?.length ?? 0; // agents-ids: one more line for a herd lead
    openOverlay({ mod: "agents-ids", kind: "dialog", width: 380, height: crew ? 275 : 255, props: { closeTarget: address, identity } });
  }

  // agents-ids: "Save & close sessions": a dialog copy of this mod; the key toggles it.
  toggleUnload() {
    const open = shared("agents-ids.unload");
    if (open) {
      closeOverlay(open);
      setShared("agents-ids.unload", null);
    } else openOverlay({ mod: "agents-ids", kind: "dialog", width: 680, height: 480, props: { unload: true } });
  }

  initUnload(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    setShared("agents-ids.unload", props().overlay);
    this.procs = new Map(); // address -> procs.py's {fg, runs}; null: couldn't check
    // Agents, and the other terminals in their tabs (closing a tab ends those too), by machine.
    const ag = agents();
    const tabs = new Set(ag.map((a) => a.tab));
    const want = new Set([...ag.map((a) => a.address), ...panes().filter((p) => tabs.has(p.tab) && p.terminal).map((p) => p.terminal)]);
    const byMachine = new Map();
    for (const k of terminals().filter((k) => want.has(k.address))) {
      if (!k.pid) { this.procs.set(k.address, null); continue; }
      const m = machineOf(k.address);
      byMachine.set(m, [...(byMachine.get(m) ?? []), k]);
    }
    for (const [on, list] of byMachine) {
      cx.spawn(async (cx) => {
        let out = {};
        try {
          const script = await readTextFile(`${appHome()}/mods/agents-ids/procs.py`);
          const res = await exec("python3", ["-c", script, ...list.map((k) => String(k.pid))], { on, timeout: 15000 });
          if (res.code === 0) out = JSON.parse(res.stdout);
        } catch {}
        for (const k of list) this.procs.set(k.address, out[String(k.pid)] ?? null);
        cx.notify();
      });
    }
  }

  async close() {
    if (props()?.unload) setShared("agents-ids.unload", null); // agents-ids
  }

  // agents-ids: save every row to the snapshot, then close the tabs of `which` rows ("safe", "all", "none").
  save(which, cx) {
    const rows = this.unloadRows;
    cx.spawn(async (cx) => {
      const snap = snapshotOf(rows, Date.now());
      try {
        await writeSnapshot(snap);
      } catch (e) {
        this.unloadError = `Not saved, nothing closed: ${e?.message ?? e}`;
        cx.notify();
        return;
      }
      const tabs = which === "none" ? [] : [...new Set(rows.filter((r) => which === "all" || !r.cause).map((r) => r.tab))];
      for (const id of tabs) run("tab.close", { id, confirmed: true });
      setShared("agents-ids.snapshot", snap.saved_at);
      const kept = rows.filter((r) => !tabs.includes(r.tab)).length;
      notify({ title: `Saved ${rows.length} session${rows.length === 1 ? "" : "s"}`, body: `${tabs.length ? `Closed ${tabs.length} tab${tabs.length === 1 ? "" : "s"}` : "Nothing closed"}${kept ? ` · ${kept} still open` : ""}`, level: "success" });
      closeOverlay(props().overlay);
    });
  }

  unloadPanel(t) {
    const p = props();
    const rows = (this.unloadRows = unloadRows(agents(), terminals(), panes(), spaces(), this.procs));
    const safe = rows.filter((r) => !r.cause);
    const risky = rows.filter((r) => r.cause);
    const button = (id, text, primary, click) => div().id(id).px(14).h(32).rounded(8).flex().items_center().flex_none()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.bg(primary ? t.solid : t.hover)).on_click(click).child(text);
    const row = (r) => h_flex().id(`un-${r.address}`).px(8).py(5).gap(9).rounded(7).flex_none().items_center()
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click(() => { closeOverlay(p.overlay); run("agent.focus", { terminal: r.address }); })
      .child(div().w(14).flex_none().text_color(r.cause ? t.blocked : t.done).child(r.cause ? "\u26a0" : "\u2713"))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(7).min_w(0)
          .child(div().flex_none().text_color(t.foreground).child(`${r.machine ? `${r.machine}: ` : ""}${r.space_name} / ${r.tab_label}`))
          .child(div().flex_none().text_color(t.muted).child(r.app))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.folder ? r.folder.replace(/\/+$/, "").split("/").pop() : ""))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(r.argv ? r.status : `${r.status} \u00b7 no session id`)))
        .when(Boolean(r.cause), (el) => el.child(div().truncate().text_size(11.5).text_color(t.blocked).child(r.cause))));
    const confirm = this.confirmAll;
    return v_flex().id("unload").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover).text_size(12.5)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { if (confirm) { this.confirmAll = false; cx.notify(); } else closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (e.key === "enter" && !confirm) { this.save("safe", cx); cx.stop_propagation(); }
      })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(confirm ? "Close busy tabs too?" : "Save & close sessions"))
      .child(div().text_size(12).text_color(t.muted).child(confirm
        ? "These are still doing something. Closing their tabs ends it:"
        : "Every session below is saved; reopen them later with Ctrl+Shift+Alt+U or the bar in Agents. \u2713 tabs are safe to close."))
      .child(v_flex().id("unload-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .children((confirm ? risky : rows).map(row))
        .when(!rows.length, (el) => el.child(div().p(8).text_color(t.dim).child("No agents running."))))
      .when(Boolean(this.unloadError), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.unloadError)))
      .child(h_flex().justify_end().gap(8).flex_none()
        .when(confirm, (el) => el
          .child(button("unload-back", "Back", false, (_e, cx) => { this.confirmAll = false; cx.notify(); }))
          .child(button("unload-all-yes", `Save & close all ${rows.length}`, true, (_e, cx) => this.save("all", cx))))
        .when(!confirm, (el) => el
          .child(button("unload-only", "Save only", false, (_e, cx) => this.save("none", cx)))
          .child(button("unload-all", "Save & close all", false, (_e, cx) => {
            if (risky.length) { this.confirmAll = true; cx.notify(); } else this.save("all", cx);
          }))
          .child(button("unload-safe", `Save & close ${safe.length} safe`, true, (_e, cx) => this.save("safe", cx)))));
  }

  // agents-ids: the snapshot file, read again whenever a save says it changed.
  loadSnapshot(cx) {
    cx.spawn(async (cx) => {
      this.snapshot = await readSnapshot();
      cx.notify();
    });
  }

  reopenBar(t, all, cx) {
    const at = shared("agents-ids.snapshot") ?? "";
    if (this.snapshotSeen !== at) { this.snapshotSeen = at; this.loadSnapshot(cx); }
    const snap = this.snapshot;
    if (!snap || localStorage.getItem("snapshotDismissed") === snap.saved_at) return null;
    const n = reopenable(snap, runningSids(all, this.listed)).length;
    if (!n) return null;
    const when = new Date(snap.saved_at);
    const hhmm = Number.isNaN(when.getTime()) ? "?" : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    return h_flex().id("reopen-bar").mt(6).px(8).h(28).flex_none().rounded(8).gap(6).items_center().text_size(12)
      .bg(t.accent + "1f").text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.accent + "3d"))
      .tooltip("Reopen the saved sessions in their spaces (Ctrl+Shift+Alt+U)")
      .on_click((_e, cx) => this.reopen(cx))
      .child(div().flex_1().min_w(0).truncate().child(`Reopen ${n} session${n === 1 ? "" : "s"} (saved ${hhmm})`))
      .child(this.xButton(t, "reopen-dismiss", "Hide until the next save", (cx) => {
        localStorage.setItem("snapshotDismissed", snap.saved_at);
        cx.notify();
      }));
  }

  // agents-ids: reopens each saved session in a new tab of its space (by id, else by name, on its machine;
  // a new space when it's gone), argv only. Sessions running now are skipped, so twice opens nothing new.
  reopen(cx) {
    if (this.reopening) return;
    this.reopening = true;
    cx.spawn(async (cx) => {
      const snap = await readSnapshot();
      if (!snap) {
        this.reopening = false;
        return notify({ title: "No saved sessions", body: "Save some first: Ctrl+Shift+U", level: "info" });
      }
      const results = [];
      const opened = new Set();
      for (const r of snap.rows) {
        const argv = r.resumable ? resumeArgv(r.app, r.session) : null;
        if (!argv) { results.push({ skip: "no id" }); continue; }
        if (opened.has(r.session) || runningSids(terminals(), new Set(agents().map((a) => a.address))).has(r.session)) { results.push({ skip: "already open" }); continue; }
        const on = r.machine ?? null;
        const where = on ?? "this computer";
        if (on && machines().find((m) => m.name === on)?.layout !== "ready") { results.push({ fail: `${on} offline` }); continue; }
        let folder;
        try {
          if (r.folder) folder = (await exec("test", ["-d", r.folder], { on })).code === 0 ? r.folder : undefined;
          const space = reopenSpace(spaces(), r);
          const name = r.tab_name ? { name: r.tab_name } : {};
          if (space) run("tab.new", { space, folder, argv, ...name });
          else {
            run("space.new", { name: r.space_name, folder, argv, machine: on ?? "", ...(r.tab_name ? { tab: r.tab_name } : {}) });
            // The next row of this space goes into it, not into a second new one.
            for (let i = 0; i < 30 && !reopenSpace(spaces(), r); i++) await exec("sleep", ["0.1"]);
          }
          opened.add(r.session);
          results.push({ done: "" });
        } catch (e) {
          results.push({ fail: /unreach|offline|connect/i.test(String(e)) ? `${where} offline` : String(e?.message ?? e).slice(0, 60) });
        }
      }
      this.reopening = false;
      notify({ title: reopenSummary(results), level: results.some((x) => "fail" in x) ? "warning" : "success" });
      cx.notify();
    });
  }

  // agents-ids: types the message into each picked agent, but only where its input box is readable and
  // empty: a send into a draft would join or replace it. Skipped ones stay picked, so a retry is one Enter.
  sendPicked(cx) {
    const text = this.msg.value().trim();
    const picked = [...this.picked];
    if (!text || !picked.length || this.sending) return;
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const sent = [];
      const skipped = [];
      for (const addr of picked) {
        const k = terminals().find((x) => x.address === addr && x.state === "live");
        const app = k?.labels?.["agent.app"] ?? k?.agent ?? agents().find((a) => a.address === addr)?.program?.key;
        try {
          if (!k) { skipped.push([addr, "gone"]); continue; }
          const screen = await exec("hc", ["read", addr], { timeout: 5000 });
          // shortcut: someone typing between this read and the send below still joins the draft (a few ms); needs an atomic send-if-empty in herdr-core.
          const box = screen.code === 0 ? inputBox(app, screen.stdout) : null;
          if (box === null) { skipped.push([addr, "can't read its input box"]); continue; }
          if (box) { skipped.push([addr, "unsent text there"]); continue; }
          const r = await exec("hc", ["send", addr, text], { timeout: 10000 });
          if (r.code === 0) sent.push(addr);
          else skipped.push([addr, r.stderr.trim().slice(0, 50) || "send failed"]);
        } catch (e) {
          skipped.push([addr, String(e?.message ?? e).slice(0, 50)]);
        }
      }
      this.sending = false;
      if (!skipped.length) this.msg.set_value("");
      this.picked = new Set(skipped.map(([addr]) => addr));
      if (!this.picked.size) this.selecting = false;
      notify({ title: `Sent to ${sent.length} agent${sent.length === 1 ? "" : "s"}`, body: skipped.length ? `Not sent: ${skipped.map(([a, why]) => `${a} (${why})`).join(", ")}` : sent.join(", "), level: skipped.length ? "warning" : "success" });
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    if (props()?.closeTarget) return this.closeDialog(t);
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.unload) return this.unloadPanel(t); // agents-ids
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.labelsOf = new Map(all.map((k) => [k.address, k.labels ?? {}])); // agents-ids
    this.migratePins(all);
    this.sessions = new Map(all.map((k) => [k.address, k.labels?.["agent.session"]]));
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.alertStalls(list, all, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    // agents-ids: herds (members' agent.lead labels). In Priority, members nest under their lead, one level
    // deep; the other views keep them in their space or project with a "↳ lead" chip.
    const herd = herds(all);
    const agentAt = new Map(list.map((a) => [a.address, a]));
    const leadOf = new Map([...herd.byLead].flatMap(([l, ms]) => ms.map((m) => [m, l])));
    const crewOf = (addr) => (herd.byLead.get(addr) ?? []).map((m) => agentAt.get(m)).filter(Boolean);
    const candidates = new Set(byPriority && !collapsed ? list.filter((a) => !a.pinned && agentAt.has(leadOf.get(a.address))).map((a) => a.address) : []);
    const nested = new Set([...candidates].filter((m) => !candidates.has(leadOf.get(m))));
    const matesOf = (a) => crewOf(a.address).filter((m) => nested.has(m.address));
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0), ...matesOf(a).map((m) => this.rank(m)))]));
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
    // agents-ids: Priority sections read Needs you, Working, Idle, Done (rank -> position).
    const place = (a) => ({ 4: 4, 2: 3, 1.5: 2.5, 1: 2, 3: 1 })[rankOf(a) || RANK.idle];
    if (byPriority) list = [...list].sort((x, y) => place(y) - place(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const kidsOf = (a) => matesOf(a).sort((x, y) => place(y) - place(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned && !nested.has(a.address));
    list = [...pinned, ...rest];
    setAgentOrder(list.flatMap((a) => [a, ...kidsOf(a)]).map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const mates = kidsOf(a);
      const r = row(a, i, subs, mates);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority)), ...mates.map((m, j) => row(m, i, [], [], j === mates.length - 1 ? "└" : "├"))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs, mates = []) => {
      const sts = [...subs.map((s) => kidStatus(s.t, this.listed)), ...mates.map((m) => this.eff(m))];
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
        .when(!open, (el) => el.child(String(subs.length + mates.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const everyone = [...agentAt.values()]; // agents-ids: nested herd members need their tab names too
    const detail = new Map(everyone.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of everyone) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of everyone) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // agents-ids: the brief a herd member works from opens beside it (markdown in `fresh`, like md-open),
    // anything else with the system opener.
    const openBrief = (a, path, cx) => /\.(md|markdown)$/i.test(path)
      ? run("pane.split", { direction: "right", pane: a.pane, argv: ["fresh", path] })
      : cx.open_url(`file://${path.split("/").map(encodeURIComponent).join("/")}`);
    const togglePick = (a, cx) => {
      this.picked.has(a.address) ? this.picked.delete(a.address) : this.picked.add(a.address);
      cx.notify();
    };

    // tree: "├" or "└" for a herd member nested under its lead (Priority).
    const row = (a, i, subs = [], mates = [], tree = null) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      const st = this.eff(a); // agents-ids
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
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, { status: st }, true)));
      }
      const when = this.since(a);
      const idle = st === "idle" && !a.focused;
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
      const labels = this.labelsOf.get(a.address);
      // agents-ids: the third line: a finished agent's Next line or wait, else what it is doing (all optional labels).
      const doing = thirdLine(labels, a.status, now);
      // agents-ids: herd. A lead says how its herd is doing; a member outside its lead's nest names the lead.
      const crew = crewOf(a.address);
      const herdLine = crew.length ? herdSummary(crew.map((m) => this.eff(m))) : null;
      const brief = briefName(labels);
      const leadAddr = tree ? null : leadOf.get(a.address);
      const leadAgent = leadAddr && agentAt.get(leadAddr);
      const leadChip = leadAddr ? `\u21b3 ${leadAgent ? detail.get(leadAddr) ?? leadAgent.space_name ?? leadAddr : leadAddr}` : herd.gone.has(a.address) ? "lead gone" : null;
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
        .when(Boolean(sid), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(` \u00b7 ${shortSid(sid)}`)))
        .when(Boolean(brief), (el) => el.child(div().id(`brief-${a.address}`).min_w(0).truncate().ml(5).px(4).rounded(4).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`brief: ${labels["agent.brief"]}\nclick: open it`)
          .on_click((_e, cx) => { cx.stop_propagation(); openBrief(a, labels["agent.brief"], cx); }).child(brief)))
        .when(Boolean(leadChip), (el) => el.child(div().id(`lead-${a.address}`).min_w(0).truncate().ml(5).px(4).rounded(4).text_color(t.dim)
          .when(Boolean(leadAgent), (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`herd lead ${leadAddr}\nclick: go to it`)
            .on_click((_e, cx) => { cx.stop_propagation(); run("pane.focus", { pane: leadAgent.pane }); }))
          .child(leadChip)));
      const kin = subs.length + mates.length;
      const body = h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(44 + (doing ? 15 : 0) + (herdLine ? 15 : 0))
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(Boolean(tree), (el) => el.flex_1().min_w(0))
        .when(a.focused || (this.selecting && this.picked.has(a.address)), (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        // agents-ids: while picking for Send to several, a click picks; it never focuses or types.
        .on_click((_e, cx) => (this.selecting ? togglePick(a, cx) : run("pane.focus", { pane: a.pane })))
        .when(Boolean(this.selecting), (el) => el.child(div().size(14).flex_none().rounded(4).border(1.5).border_color(this.picked.has(a.address) ? t.accent : t.input)
          .flex().items_center().justify_center().when(this.picked.has(a.address), (el) => el.bg(t.accent).child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.background)))))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(kin > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(5).items_center()
            .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
            .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
          .child(ids)
          .when(Boolean(doing), (el) => el.child(this.marquee(div().id(`third-${a.address}`).min_w(0).text_size(11).text_color(doing.stale ? t.blocked : doing.you ? t.accent : t.dim), `third-${a.address}`, doing.text, doing.tip || doing.text, this.hovered === a.address)))
          .when(Boolean(herdLine), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(herdLine))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(kin > 0, el => el.child(fold(a, subs, mates)))
        .when(this.hovered === a.address && !this.selecting, el => el.child(pin).child(this.xButton(t, `close-${a.address}`, "Check before closing agent", () => this.askClose(a.address))))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, { status: st }, byPriority && !isPinned));
      if (!tree) return body;
      // agents-ids: a nested herd member, with a tree line from its lead.
      return h_flex().id(`herd-${a.address}`).pl(14).flex_none().items_start()
        .child(div().w(10).mr(4).flex_none().h(tree === "└" ? 22 : 44 + (doing ? 15 : 0)).border_l(1.5).border_color(t.input)
          .child(div().mt(21).w(10).border_b(1.5).border_color(t.input)))
        .child(body);
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
    this.fetchNames(recentShown, cx);
    const toggle = () => h_flex().id("recent-more").px(8).h(24).flex_none().items_center().text_size(11).text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.recentAll = !this.recentAll; cx.notify(); })
      .child(this.recentAll ? "Show less" : `Show ${recent.length - 5} more`);
    // agents-ids: "Reopen N sessions" while a snapshot has sessions not running now.
    const bar = collapsed ? null : this.reopenBar(t, all, cx);
    if (bar) rows.unshift(bar);
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
            .child(h_flex().gap(10).items_center().child(div() // agents-ids: Send to several
              .id("ag-send").text_color(this.selecting ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
              .tooltip(this.selecting ? "Stop picking" : "Send one message to several agents")
              .on_click((_e, cx) => {
                this.selecting = !this.selecting;
                if (this.selecting) this.msg.focus();
                else this.picked.clear();
                cx.notify();
              })
              .child(svg("mods/workspace-chrome/square-pen.svg").size(13)))
            .child(div() // agents-ids: Save & close sessions
              .id("ag-unload").text_color(t.dim).hover((s) => s.text_color(t.foreground))
              .on_click(() => this.toggleUnload()).tooltip("Save & close sessions (Ctrl+Shift+U)").child(svg("mods/workspace-chrome/archive.svg").size(13)))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-ids", kind: "popup", width: 250, height: 310, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label} \u00b7 status icons`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            )),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      // agents-ids: Send to several. Pick agents above, type once, Enter or Send.
      .when(Boolean(this.selecting) && !collapsed, (el) => el.child(v_flex().id("ag-compose").flex_none().px(8).pt(6).pb(8).gap(6).border_t(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).truncate().child(this.picked.size ? `To ${[...this.picked].join(", ")}` : "Click agents to pick them"))
        .child(Input.new(this.msg).h(32).flex_none().px(8).rounded(8).border_1().border_color(t.accent).bg(t.background).text_color(t.foreground))
        .child(h_flex().gap(6).justify_end()
          .child(div().id("ag-compose-cancel").px(10).h(26).rounded(7).flex().items_center().text_size(12).bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.selecting = false; this.picked.clear(); cx.notify(); }).child("Cancel"))
          .child(div().id("ag-compose-send").px(10).h(26).rounded(7).flex().items_center().text_size(12).bg(t.solid).text_color(t.solid_foreground)
            .when(!this.picked.size || this.sending, (el) => el.opacity(0.5))
            .on_click((_e, cx) => this.sendPicked(cx))
            .child(this.sending ? "Sending…" : `Send to ${this.picked.size}`)))))
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
