// Kuota collector JSON, kept separate from Herdr so it can be tested with Node.
export function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Invalid collector output"); }
  if (!data || !Array.isArray(data.providers)) throw new Error("Invalid collector output");
  return data.providers.filter((p) => p && typeof p.id === "string" && typeof p.state === "string");
}

const windows = (p) => Array.isArray(p.windows) ? p.windows.filter((w) => w && typeof w.usedPercent === "number" && Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100) : [];

export function busiest(providers) {
  let best = null;
  for (const p of providers) if (p.state === "ok") for (const w of windows(p)) {
    if (!best || w.usedPercent > best.percent) best = { id: p.id, percent: w.usedPercent };
  }
  return best;
}

export function resetIn(date, now = Date.now()) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return null;
  const minutes = Math.ceil((time - now) / 60000);
  if (minutes <= 0) return "now";
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  if (days) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${minutes}m`;
}

// The hover card: providers with numbers, busiest first; the rest named in one footer line.
export function card(providers, now = Date.now()) {
  const rows = providers.filter((p) => p.state === "ok" && windows(p).length)
    .map((p) => ({ id: p.id, windows: windows(p).map((w) => {
      const reset = resetIn(w.resetAt, now);
      return { label: w.label || w.id || "Usage", percent: w.usedPercent, reset: reset ? (reset === "now" ? "resets now" : `resets in ${reset}`) : "" };
    }) }))
    .sort((a, b) => Math.max(...b.windows.map((w) => w.percent)) - Math.max(...a.windows.map((w) => w.percent)));
  const login = providers.filter((p) => p.state === "auth-needed").map((p) => p.id);
  const down = providers.filter((p) => p.state !== "ok" && p.state !== "auth-needed").map((p) => p.id);
  const names = (ids) => ids.length > 3 ? `${ids.slice(0, 3).join(", ")} +${ids.length - 3}` : ids.join(", ");
  const footer = [login.length && `needs login: ${names(login)}`, down.length && `unavailable: ${names(down)}`].filter(Boolean);
  return { rows, footer };
}

// Bar color: green below 60%, yellow below 85%, red from 85%.
export const level = (percent) => (percent >= 85 ? "blocked" : percent >= 60 ? "working" : "done");

// Quota warnings: a toast when a window first reaches 85%, and again at 95%, once per reset period.
// seen maps "provider/window@resetAt" to the step already warned; returns the toast (or null) and the
// new map, which keeps only windows still reported, so a reset or a vanished window forgets its step.
export function warnings(providers, seen = {}, now = Date.now()) {
  const next = {}, fresh = [];
  for (const p of providers) if (p.state === "ok") for (const w of windows(p)) {
    const key = `${p.id}/${w.id || w.label}@${w.resetAt ?? ""}`, step = w.usedPercent >= 95 ? 95 : w.usedPercent >= 85 ? 85 : 0;
    next[key] = Math.max(step, seen[key] ?? 0);
    if (step > (seen[key] ?? 0)) fresh.push({ id: p.id, label: w.label || w.id || "Usage", percent: w.usedPercent, reset: resetIn(w.resetAt, now) });
  }
  if (!fresh.length) return { toast: null, seen: next };
  const level = fresh.some((f) => f.percent >= 95) ? "error" : "warning";
  if (fresh.length === 1) {
    const [f] = fresh;
    return { toast: { title: `${f.id} at ${f.percent}%`, body: `${f.label}${f.reset ? ` · resets ${f.reset === "now" ? "now" : `in ${f.reset}`}` : ""}`, level }, seen: next };
  }
  return { toast: { title: `${fresh.length} quotas above 85%`, body: fresh.map((f) => `${f.id} ${f.label} ${f.percent}%`).join(" · "), level }, seen: next };
}
