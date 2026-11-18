// Pure helpers for the prompts mod (no herdr / gpui-kit imports), tested by test_logic.mjs.
// A prompt: { id, text, project } where project is "" (global) or projectKey(...).

/** The project a terminal is in: its git root (else its folder), with the machine for another one's. */
export const projectKey = (machine, root) => (root ? (machine ? `${machine}:${root}` : root) : "");

/** The project's short name for headings. */
export const projectName = (key) => String(key).split("/").filter(Boolean).pop() ?? "";

/** Stored prompts, junk dropped (localStorage is a file anyone can edit). */
export function parsePrompts(json) {
  try {
    const rows = JSON.parse(json ?? "[]");
    return Array.isArray(rows) ? rows.filter((p) => p && typeof p.id === "string" && typeof p.text === "string" && typeof p.project === "string") : [];
  } catch { return []; }
}

/** What the panel shows: this project's prompts, then the global ones, newest first in each. */
export const visible = (prompts, project) => [
  ...(project ? prompts.filter((p) => p.project === project) : []),
  ...prompts.filter((p) => p.project === ""),
].sort((a, b) => Number(a.project === "") - Number(b.project === "") || b.at - a.at);

/** Adds a prompt, or replaces the one with `id` (moving it to `project`). Empty text changes nothing. */
export function save(prompts, { id, text, project, at = Date.now() }) {
  if (!String(text).trim()) return prompts;
  const rest = prompts.filter((p) => p.id !== id);
  return [{ id: id ?? `p${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, project, at }, ...rest];
}

export const remove = (prompts, id) => prompts.filter((p) => p.id !== id);
