// Pure helpers for the prompts mod (no herdr / gpui-kit imports), tested by test_logic.mjs.
// A prompt: { id, text, project } where project is "" (global) or projectKey(...).

/** The project a terminal is in: its git root (else its folder), with the machine for another one's. */
export const projectKey = (machine, root) => (root ? (machine ? `${machine}:${root}` : root) : "");

/** The machine to key a terminal's project by when the prompts live on `on` (null: this computer):
 *  none for `on`'s own terminals, this computer's name (`self`) for local ones, so both machines agree. */
export const keyMachine = (machine, on, self) => (machine === on ? null : machine ?? self);

/** The project's short name for headings. */
export const projectName = (key) => String(key).split("/").filter(Boolean).pop() ?? "";

/** Stored prompts, junk dropped (localStorage is a file anyone can edit). */
export function parsePrompts(json) {
  try {
    const rows = JSON.parse(json ?? "[]");
    return Array.isArray(rows) ? rows.filter((p) => p && typeof p.id === "string" && typeof p.text === "string" && typeof p.project === "string") : [];
  } catch { return []; }
}

/** Whether a prompt's text or project name holds the query (any case). */
export const matches = (p, query) => !query.trim() || `${p.text}\n${projectName(p.project)}`.toLowerCase().includes(query.trim().toLowerCase());

/** Prompts in a scope tab: "project" (this project's), "global", or "all". */
const inScope = (p, project, scope) => scope === "all" || p.project === (scope === "project" ? project : "");

/** What a scope tab counts, before the search. */
export const count = (prompts, project, scope) => prompts.filter((p) => inScope(p, project, scope)).length;

/** The list under headings, newest first in each: this project, Global, then other projects (most
 *  recently used first). Empty groups are left out. */
export function groups(prompts, project, scope, query = "") {
  const shown = prompts.filter((p) => inScope(p, project, scope) && matches(p, query)).sort((a, b) => b.at - a.at);
  const keys = [...new Set([project, "", ...shown.map((p) => p.project)])].filter((k) => k !== undefined);
  return keys.map((key) => ({ key, title: key ? projectName(key) : "Global", items: shown.filter((p) => p.project === key) }))
    .filter((g) => g.items.length);
}

/** Adds a prompt, or replaces the one with `id` (moving it to `project`). Empty text changes nothing. */
export function save(prompts, { id, text, project, at = Date.now() }) {
  if (!String(text).trim()) return prompts;
  const rest = prompts.filter((p) => p.id !== id);
  return [{ id: id ?? `p${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, project, at }, ...rest];
}

export const remove = (prompts, id) => prompts.filter((p) => p.id !== id);
