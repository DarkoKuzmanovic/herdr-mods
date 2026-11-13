// agents-ids' own helpers, kept out of main.js so Herdr's `agents` updates merge cleanly.
// Pure (no herdr imports): `node test_logic.mjs` loads them.

/** Short session id. Hermes drops "local-"; UUIDv7 ids (Pi, PiG, Codex) keep 13 chars, as their
 *  first 8 repeat for ~65 s; OpenCode's time-ordered "ses_…" ids show their last 8 (the random part). */
export const shortSid = (sid) => {
  const s = (sid ?? "").replace(/^local-/, "");
  if (/^ses_/.test(s)) return s.slice(-8);
  return s.slice(0, /^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(s) ? 13 : 8);
};

// Labels are untrusted; never let them add lines to the sidebar.
export function doingLine(labels, status, now) {
  const text = typeof labels?.["agent.doing"] === "string" ? labels["agent.doing"].replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!text) return null;
  const since = Number(labels?.["agent.doing.since"]);
  if (!Number.isFinite(since) || since <= 0 || since * 1000 > now) return { text, stale: false, tip: "" };
  const ms = now - since * 1000;
  const m = Math.floor(ms / 60000);
  const age = m < 1 ? "<1m" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  const stale = status === "working" && ms > 30 * 60000;
  return { text: `${text} · ${age}`, stale, tip: stale ? `no change for ${age}` : "" };
}

// Agents stuck now: working on the same agent.doing for 30+ minutes (the amber line), or blocked for
// 5+ minutes. `key` names one stall, so each stall alerts once; a new doing or state is a new stall.
export function stalls(list, labelsOf, changed, now) {
  const out = [];
  for (const a of list) {
    const doing = doingLine(labelsOf(a.address), a.status, now);
    const since = changed[a.address]?.s === "blocked" ? changed[a.address].at : null;
    if (doing?.stale) out.push({ key: `${a.address} working ${labelsOf(a.address)["agent.doing.since"]}`, address: a.address, text: doing.text });
    else if (a.status === "blocked" && since && now - since > 5 * 60000) out.push({ key: `${a.address} blocked ${since}`, address: a.address, text: `blocked for ${Math.floor((now - since) / 60000)}m` });
  }
  return out;
}

export function sameTerminal(before, after) {
  return Boolean(before && after && (typeof before.created_ms === "number" || before.labels?.["agent.session"]) && after.state === "live" && before.address === after.address &&
    before.created_ms === after.created_ms && before.labels?.["agent.session"] === after.labels?.["agent.session"]);
}

export function closeFacts(status, git, children, herd = 0) {
  return [
    `Agent: ${status || "unknown"}`,
    `Git: ${git == null ? "unknown" : git ? `${git} uncommitted changes` : "no uncommitted changes"}`,
    `Sub-agents: ${children == null ? "unknown" : children || "none"}`,
    "Background processes: unknown",
    ...(herd ? [`Herd: ${herd} tab${herd > 1 ? "s" : ""} still open (they keep running)`] : []),
  ];
}

const RESUME = {
  claude: (id) => ["claude", "--resume", id],
  codex: (id) => ["codex", "resume", id],
  pi: (id) => ["pi", "--session", id],
  pig: (id) => ["pig", "--session", id],
  opencode: (id) => ["opencode", "--session", id],
  hermes: (id) => ["hermes", "--resume", id],
};

/** The known agent an app name means (`claude-code`, `/usr/bin/codex` -> `claude`, `codex`), or null. */
export function agentKey(app) {
  const key = (typeof app === "string" ? app : "").toLowerCase().replace(/^.*\//, "").replace(/-code$/, "");
  // agents-ids: own keys only, so a label like `__proto__` can't reach Object.prototype.
  return Object.hasOwn(RESUME, key) ? key : null;
}

/** The command that reopens a session, or null for an unknown agent or an id that isn't plain
 *  letters, digits, `-`, `_`, `.` (labels are written by any program, and Resume may type this
 *  into a shell). */
export function resumeArgv(app, id) {
  const key = agentKey(app);
  return key && /^[\w.-]{4,128}$/.test(id ?? "") ? RESUME[key](id) : null;
}

const KEEP = 20;
const DAYS = 14;

/** A live terminal that runs an agent now (it reports a status), as opposed to a bare shell or
 *  another program. Shells and other programs report none. */
const running = (k, agentAddresses) => agentAddresses.has(k.address) || (k.state === "live" && Boolean(k.status) && k.status !== "unknown");

const entry = (k) => {
  const app = k.labels?.["agent.app"];
  const sid = k.labels?.["agent.session"];
  // herdr.space is the id on the terminal's own machine; spaces() ids carry a `machine/` prefix for remote ones.
  const space = k.labels?.["herdr.space"];
  const m = machineOf(k.address);
  return resumeArgv(app, sid) ? { sid, app, address: k.address, cwd: k.cwd ?? null, space: space ? (m ? `${m}/${space}` : space) : null } : null;
};

/** The machine an address lives on (`vps/t7` -> `vps`), or null for this one. */
export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);

/** "Grouped by project": the git repo a folder is in, with worktrees counted under their main repo
 *  (`commonDir` is `git rev-parse --path-format=absolute --git-common-dir`); a folder outside git, or
 *  not checked yet, is its own project. `key` is machine:path (a hostname holds no colon), so two
 *  machines' same paths stay apart. */
export function projectOf(machine, cwd, commonDir) {
  const at = machine ? `${machine}: ` : "";
  if (commonDir) {
    const root = commonDir.replace(/\/+$/, "").replace(/\/\.git$/, "");
    return { key: `${machine ?? ""}:${root}`, name: at + root.split("/").pop().replace(/\.git$/, "") };
  }
  const dir = (cwd ?? "").replace(/(.)\/+$/, "$1");
  return { key: `${machine ?? ""}:${dir}`, name: at + (dir.replace(/^\/(home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/, "~") || "unknown folder") };
}

/** Where Resume opens a session: its own space when it still exists, else any space on the same
 *  machine (an entry saved before 0.4.2 has an unprefixed space id); null when that machine has no
 *  space here, since a session only resumes on the machine that holds it. */
export function resumeSpace(spaceList, r) {
  const m = machineOf(r.address);
  const same = spaceList.filter((s) => (s.machine ?? null) === m);
  return (same.find((s) => s.id === r.space) ?? same.find((s) => s.active) ?? same[0])?.id ?? null;
}

/** The remembered sessions (sid -> entry with `seen` ms) updated from the terminals now listed,
 *  so a session stays resumable after its terminal is gone, across restarts. The same object back
 *  when nothing changed (no write needed). */
export function rememberSessions(store, all, agentAddresses, now) {
  const next = { ...store };
  let changed = false;
  for (const k of all) {
    const e = entry(k);
    if (!e) continue;
    const old = next[e.sid];
    // Running: seen now, but at most once a minute (each change is a localStorage write).
    const seen = running(k, agentAddresses) ? (old && now - old.seen < 60000 ? old.seen : now) : old?.seen ?? k.status_ms ?? now;
    // Rewrite only when seen moves: an ended session is history, and its rewrite would drop `hidden`.
    if (old && old.seen === seen) continue;
    next[e.sid] = { ...e, seen };
    changed = true;
  }
  const keep = Object.values(next).filter((e) => now - e.seen < DAYS * 86400000).sort((a, b) => b.seen - a.seen).slice(0, KEEP);
  if (keep.length !== Object.keys(next).length) changed = true;
  return changed ? Object.fromEntries(keep.map((e) => [e.sid, e])) : store;
}

/** The store with `sid` hidden from Recent sessions. Kept, not deleted, so a shell that still
 *  carries its label doesn't bring it back; running it again clears `hidden` (rememberSessions
 *  rewrites the entry when `seen` moves). */
export const hideSession = (store, sid) => (store[sid] ? { ...store, [sid]: { ...store[sid], hidden: true } } : store);

/** Agent sessions that ended and can be resumed, newest first, at most `max`: remembered ones
 *  whose agent isn't running anywhere now. */
export function recentSessions(all, agentAddresses, store, max = 5) {
  const runningSids = new Set(all.filter((k) => running(k, agentAddresses)).map((k) => k.labels?.["agent.session"]).filter(Boolean));
  return Object.values(store)
    .filter((e) => !e.hidden && !runningSids.has(e.sid) && resumeArgv(e.app, e.sid))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, max)
    .map((e) => ({ ...e, argv: resumeArgv(e.app, e.sid) }));
}

// agents-ids: "Save & close sessions" and "Reopen saved sessions".

/** Where the snapshot lives: ~/.local/state/herdr-mods/ for the usual app folder, else inside the app
 *  folder ($HERDR_APP_HOME), so a second window (the demo) never writes the person's own. */
export const snapshotPath = (home, appHome) =>
  appHome.replace(/\/+$/, "") === `${home.replace(/\/+$/, "")}/.config/herdr-app` ? `${home}/.local/state/herdr-mods/session-snapshot.json` : `${appHome}/data/herdr-mods/session-snapshot.json`;

const oneLine = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Why closing a terminal now would lose something, or null. `p`: procs.py's {fg, runs} for it,
 *  undefined while asked, null when it couldn't be checked. An agent's own foreground is the agent. */
function busy(k, status, p, agent) {
  if (status === "blocked") return "waiting for your answer";
  if (status === "working") return `working: ${oneLine(k?.labels?.["agent.doing"], 40) || "mid-reply"}`;
  if (p === undefined) return "checking processes…";
  if (p === null) return "couldn't check processes";
  const runs = [...(agent || !p.fg ? [] : [p.fg]), ...(p.runs ?? [])];
  return runs.length ? `runs: ${oneLine(runs[0], 60)}${runs.length > 1 ? ` +${runs.length - 1}` : ""}` : null;
}

/** The session id a terminal's agent was started with (`hermes --resume <id>`, as Reopen starts it), or
 *  null: an agent may label itself only after its first turn, and saving again must not lose it. */
export function sessionFromArgv(app, argv) {
  const key = agentKey(app);
  if (!key || !Array.isArray(argv)) return null;
  const flag = RESUME[key]("x")[1];
  const i = argv.lastIndexOf(flag);
  return i >= 0 && resumeArgv(key, argv[i + 1]) ? argv[i + 1] : null;
}

/** One row per terminal running a known agent: where, what, and `cause` (null: safe to close). A
 *  row is safe only when everything its tab would end is: other terminals in the tab, sub-agents. */
export function unloadRows(agentList, all, paneList, spaceList, procs) {
  const byAddr = new Map(all.map((k) => [k.address, k]));
  const tabs = new Map(spaceList.flatMap((s) => s.tabs.map((t) => [t.id, t])));
  const rows = agentList.flatMap((a) => {
    const k = byAddr.get(a.address);
    const app = agentKey(k?.labels?.["agent.app"]) ?? agentKey(a.app) ?? agentKey(a.program?.key);
    if (!k || !app) return [];
    const tab = tabs.get(a.tab);
    const label = k.labels?.["agent.session"];
    const session = typeof label === "string" && label ? label : sessionFromArgv(app, k.foreground?.argv) ?? sessionFromArgv(app, k.argv);
    return [{ address: a.address, pane: a.pane, machine: machineOf(a.address), space: a.space, space_name: a.space_name, tab: a.tab,
      tab_label: tab?.name ?? a.tab_name, tab_name: tab?.named ? tab.name : null, folder: k.cwd ?? null, app, session,
      argv: resumeArgv(app, session), status: a.status, cause: busy(k, a.status, procs.get(a.address), true) }];
  });
  const own = new Map(rows.map((r) => [r.address, r.cause]));
  for (const r of rows) {
    if (r.cause) continue;
    const others = paneList.filter((p) => p.tab === r.tab && p.terminal && p.terminal !== r.address).map((p) => p.terminal);
    const why = others.map((t) => [t, own.has(t) ? own.get(t) : busy(byAddr.get(t), null, procs.get(t), false)]).find(([, c]) => c);
    const kids = all.filter((k) => k.parent === r.address && k.state === "live").length;
    r.cause = why ? `same tab: ${why[0]} ${why[1]}` : kids ? `${kids} sub-agent${kids > 1 ? "s" : ""} running` : null;
  }
  return rows;
}

/** The snapshot file's content: every row, resumable or not. */
export const snapshotOf = (rows, now) => ({
  saved_at: new Date(now).toISOString(),
  rows: rows.map((r) => ({ machine: r.machine, space: r.space, space_name: r.space_name, tab_name: r.tab_name, folder: r.folder,
    app: r.app, session: r.session, address: r.address, argv: r.argv, resumable: Boolean(r.argv) })),
});

/** Session ids running now: a live agent's label, or the id its foreground (or, while an agent runs,
 *  the terminal itself) was started with, since an agent may label itself only after its first turn. */
export function runningSids(all, agentAddresses) {
  const out = new Set();
  for (const k of all) {
    if (k.state !== "live") continue;
    const live = running(k, agentAddresses);
    if (live && k.labels?.["agent.session"]) out.add(k.labels["agent.session"]);
    for (const a of [...(k.foreground?.argv ?? []), ...(live ? k.argv ?? [] : [])]) if (typeof a === "string") out.add(a);
  }
  return out;
}

/** Snapshot rows that Reopen would open: resumable and not running now. */
export const reopenable = (snap, sids) => (snap?.rows ?? []).filter((r) => r.resumable && resumeArgv(r.app, r.session) && !sids.has(r.session));

/** The space a saved row reopens in: its own (by id), else one of the same name, on its machine. */
export function reopenSpace(spaceList, r) {
  const same = spaceList.filter((s) => (s.machine ?? null) === (r.machine ?? null));
  return (same.find((s) => s.id === r.space) ?? same.find((s) => s.name === r.space_name))?.id ?? null;
}

/** "Reopened 4 · skipped 1 (already open) · failed 1 (laptop offline)" from [{done|skip|fail: reason}]. */
export function reopenSummary(results) {
  const part = (word, kind) => {
    const hits = results.filter((x) => kind in x);
    if (!hits.length) return null;
    const why = [...new Set(hits.map((x) => x[kind]).filter(Boolean))];
    return `${word} ${hits.length}${why.length ? ` (${why.join(", ")})` : ""}`;
  };
  return [part("Reopened", "done"), part("skipped", "skip"), part("failed", "fail")].filter(Boolean).join(" · ") || "Nothing to reopen";
}

// agents-ids 0.9.0: what a finished agent says next, background waits, herds and sending to several.
// Labels (docs/labels.md): agent.next, agent.needs, agent.waiting, agent.lead, agent.brief.

const label = (labels, key, n) => oneLine(labels?.[key], n);
const finished = (status) => status === "done" || status === "idle";

/** The status a row shows: a finished agent whose Next line asks for you is "asks" (with Needs you), one
 *  with background jobs that will wake it is "waiting"; anything else is Herdr's own status. */
export function effStatus(status, labels) {
  if (!finished(status)) return status;
  if (labels?.["agent.needs"] === "you" && label(labels, "agent.next", 200)) return "asks";
  if (label(labels, "agent.waiting", 30)) return "waiting";
  return status;
}

/** The third row line: the Next line of a finished agent (`you`: it asks for you), its wait, or what it's doing. */
export function thirdLine(labels, status, now) {
  if (finished(status)) {
    const next = label(labels, "agent.next", 200);
    const wait = label(labels, "agent.waiting", 30);
    const doing = doingLine(labels, status, now);
    const age = doing?.text.match(/ · (\S+)$/)?.[1];
    if (next) return { text: `→ ${next}`, you: labels?.["agent.needs"] === "you", stale: false, tip: `Next: ${next}${wait ? `\nwaiting: ${wait}` : ""}` };
    if (wait) return { text: `waiting: ${wait}${age ? ` · ${age}` : ""}`, you: false, stale: false, tip: "background jobs will wake it" };
  }
  const doing = doingLine(labels, status, now);
  return doing && { ...doing, you: false };
}

/** Herds: lead address -> member addresses, from members' `agent.lead` labels. Only this computer's
 *  terminals nest (a remote member's label names a terminal on its own machine), and only under a live
 *  lead. `gone`: members whose lead isn't live any more. */
export function herds(all) {
  const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
  const out = new Map();
  const gone = new Set();
  for (const k of all) {
    const lead = label(k.labels, "agent.lead", 64);
    if (k.state !== "live" || !lead || machineOf(k.address) || lead === k.address) continue;
    if (!live.has(lead) || machineOf(lead)) { gone.add(k.address); continue; }
    out.set(lead, [...(out.get(lead) ?? []), k.address]);
  }
  return { byLead: out, gone };
}

/** "herd · 3 working · 1 needs you · 1 done" from members' shown statuses. */
export function herdSummary(statuses) {
  const n = (...s) => statuses.filter((x) => s.includes(x)).length;
  const parts = [[n("working"), "working"], [n("blocked", "asks"), "needs you"], [n("waiting"), "waiting"], [n("done", "idle"), "done"]];
  return ["herd", ...parts.filter(([c]) => c).map(([c, w]) => `${c} ${w}`)].join(" · ");
}

/** A brief's short name for the row: its file name without a leading date or the extension. */
export const briefName = (labels) => label(labels, "agent.brief", 300).replace(/\/+$/, "").split("/").pop()
  .replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/, "").replace(/\.[^.]+$/, "").slice(0, 24);

/** What sits in an agent's input box, from `hc read` text: a string ("" when empty), or null when this
 *  agent's box can't be read, so a send must not go there (it would replace or join a draft). */
export function inputBox(app, screen) {
  if (agentKey(app) !== "hermes") return null; // shortcut: Hermes only; add an agent once its prompt line is checked.
  // Fail closed: only a one-line composer right under Hermes's status bar (`─ ready │ …`) counts; an older
  // ❯ in the transcript, or a multi-line draft, reads as null.
  const lines = String(screen ?? "").split("\n").filter((l) => l.trim());
  const [bar, box] = lines.slice(-2);
  if (!box || !/^\s*❯/.test(box) || !/^\s*─.*│/.test(bar ?? "")) return null;
  const text = box.replace(/^\s*❯\s?/, "").trim();
  return text === "Ctrl+C to interrupt…" ? "" : text;
}

// Status icon sets (Lucide, in ./icons). "default" draws today's spinner, ! and ?, clock, ring and dot.
// spin: the working icon turns, as the default spinner does. scan: an icon swung left and right over it.
// pulse: ms per fade out and back, by status.
export const ICON_SETS = [
  { id: "default", label: "Default" },
  { id: "rings", label: "Rings", spin: true, icons: { working: "loader-circle", blocked: "circle-alert", asks: "circle-question-mark", waiting: "circle-dashed", idle: "circle", done: "circle-check" } },
  { id: "signs", label: "Signs", icons: { working: "activity", blocked: "octagon-alert", asks: "message-circle-question-mark", waiting: "hourglass", idle: "moon", done: "check" } },
  { id: "matrix", label: "Matrix", scan: "matrix-column", pulse: { blocked: 900, waiting: 2400 }, icons: { working: "matrix-working", blocked: "matrix-blocked", asks: "matrix-asks", waiting: "matrix-waiting", idle: "matrix-idle", done: "matrix-done" } },
  { id: "who", label: "Who", icons: { working: "bot", blocked: "hand", asks: "user-round", waiting: "alarm-clock", idle: "coffee", done: "check-check" } },
];
export const iconSet = (id) => ICON_SETS.find((s) => s.id === id) ?? ICON_SETS[0];
