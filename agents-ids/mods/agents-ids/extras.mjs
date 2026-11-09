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

export function closeFacts(status, git, children) {
  return [
    `Agent: ${status || "unknown"}`,
    `Git: ${git == null ? "unknown" : git ? `${git} uncommitted changes` : "no uncommitted changes"}`,
    `Sub-agents: ${children == null ? "unknown" : children || "none"}`,
    "Background processes: unknown",
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

/** The command that reopens a session, or null for an unknown agent or an id that isn't plain
 *  letters, digits, `-`, `_`, `.` (labels are written by any program, and Resume may type this
 *  into a shell). */
export function resumeArgv(app, id) {
  const key = (app ?? "").toLowerCase().replace(/^.*\//, "").replace(/-code$/, "");
  // agents-ids: own keys only, so a label like `__proto__` can't reach Object.prototype.
  return Object.hasOwn(RESUME, key) && /^[\w.-]{4,128}$/.test(id ?? "") ? RESUME[key](id) : null;
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
