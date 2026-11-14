// Pure helpers for the handovers mod (no herdr / gpui-kit imports), tested by test_logic.mjs.

const AGENTS = { claude: ["claude"], codex: ["codex"], pi: ["pi"], pig: ["pig"], opencode: ["opencode"] };
const RESUME = {
  claude: (id) => ["claude", "--resume", id],
  codex: (id) => ["codex", "resume", id],
  pi: (id) => ["pi", "--session", id],
  pig: (id) => ["pig", "--session", id],
  opencode: (id) => ["opencode", "--session", id],
  hermes: (id) => ["hermes", "--tui", "--resume", id],
};
const key = (app) => (Object.hasOwn(RESUME, app) ? app : null);

/** The agent a note's `app:` names, Hermes when it names none or an unknown one. */
export const agentOf = (note) => key(String(note?.app ?? "").toLowerCase()) ?? "hermes";

/** Continue's tab: a fresh agent and its first message. Herdr's `task` reaches the agent as an argument,
 *  which Hermes reads as a subcommand, so Hermes gets the message as `chat -q` instead. */
export function continueTab(note) {
  const app = agentOf(note), task = continueTask(note);
  return app === "hermes" ? { argv: ["hermes", "chat", "--tui", "-q", task] } : { argv: AGENTS[app], task };
}

/** Reopens the note's session, or null without a plain session id (labels and notes are untrusted). */
export function resumeArgv(note) {
  const id = String(note?.session ?? "");
  return /^[\w.-]{4,128}$/.test(id) ? RESUME[agentOf(note)](id) : null;
}

/** The first message Continue gives the fresh agent. */
// The agent reads and reports first: a note's "## Agent" list can mean logins or production, so the person says go.
export const continueTask = (note) => `Read ${note.path}, a handover note. Tell me in a few lines where things stand and what you'd do next from its "## Agent" list, then wait for my go before doing anything. Its "## You" list is mine.`;

/** Notes from the helper's JSON, with the machine they came from; junk dropped. */
export function parseNotes(json, machine) {
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((n) => n && typeof n.path === "string" && typeof n.root === "string" && typeof n.title === "string" && Array.isArray(n.you) && Array.isArray(n.agent))
      .map((n) => ({ ...n, machine: machine ?? null }));
  } catch { return []; }
}

/** Your part is open when an item in `## You` isn't ticked. */
export const yourTurn = (note) => note.you.some((i) => !i.done);

/** The status bar's words beside its icon: `2 · 1 yours` (one is your turn), `2`, or `0`. */
export function badge(notes) {
  const mine = notes.filter(yourTurn).length;
  return `${notes.length}${mine ? ` · ${mine} yours` : ""}`;
}

/** Folders to look in, per machine: each space's folder and each pane's folder ("" = this computer). */
export function folders(spaces, panes) {
  const byTab = new Map(spaces.flatMap((s) => s.tabs.map((t) => [t.id, s])));
  const out = new Map();
  const add = (machine, dir) => {
    if (!dir) return;
    const m = machine ?? "";
    out.set(m, out.get(m) ?? new Set());
    out.get(m).add(dir);
  };
  for (const s of spaces) add(s.machine, s.folder);
  for (const p of panes) if (byTab.has(p.tab)) add(byTab.get(p.tab).machine, p.cwd);
  return [...out].map(([m, dirs]) => ({ machine: m || null, dirs: [...dirs] }));
}

/** The space Continue / Resume / Note open a tab in: one whose folder is in the note's repo, else
 *  the shown space on that machine, else any there. */
export function spaceFor(note, spaces) {
  const here = spaces.filter((s) => (s.machine ?? null) === note.machine);
  const inside = (d) => d === note.root || String(d ?? "").startsWith(`${note.root}/`);
  return here.find((s) => inside(s.folder)) ?? here.find((s) => s.active) ?? here[0] ?? null;
}

export function age(seconds, now = Date.now() / 1000) {
  const s = Math.max(0, now - seconds);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
