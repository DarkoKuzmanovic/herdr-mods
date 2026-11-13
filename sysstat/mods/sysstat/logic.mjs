// Pure helpers for sysstat (no herdr imports, so `node test_logic.mjs` can load them).

/** Samples kept for the sparkline: one minute at one reading every 2 s. */
export const SAMPLES = 30;

/** /proc/stat's first line as [busy, total] jiffies, or null. */
export function cpuTimes(stat) {
  const fields = stat?.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  if (!fields || fields.length < 4 || fields.some((n) => !Number.isFinite(n))) return null;
  const total = fields.reduce((a, b) => a + b, 0);
  const idle = fields[3] + (fields[4] || 0); // idle + iowait
  return [total - idle, total];
}

/** CPU busy % between two cpuTimes readings, or null when there's no usable earlier one. */
export function cpuPercent(prev, now) {
  if (!prev || !now || now[1] <= prev[1]) return null;
  return Math.max(0, Math.min(100, Math.round((100 * (now[0] - prev[0])) / (now[1] - prev[1]))));
}

/** /proc/meminfo as { used, total } in bytes, or null. */
export function memory(meminfo) {
  const kib = (key) => Number(meminfo?.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1]);
  const total = kib("MemTotal");
  const available = kib("MemAvailable");
  if (!total || !Number.isFinite(available) || available > total) return null;
  return { used: (total - available) * 1024, total: total * 1024 };
}

/** amdgpu's sysfs readings as { busy, used, total }, or null when the files say nothing. */
export function gpu(busy, used, total) {
  const [b, u, t] = [busy, used, total].map((s) => Number(s?.trim()));
  if (!Number.isFinite(b)) return null;
  return { busy: b, used: Number.isFinite(u) ? u : null, total: t > 0 ? t : null };
}

export const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);

/** Keep the last SAMPLES values. */
export const push = (hist, v) => [...hist, v].slice(-SAMPLES);

// The card's line under the CPU graph: average and peak of the samples shown.
export const spread = (hist) => (hist.length ? { avg: Math.round(hist.reduce((a, b) => a + b, 0) / hist.length), peak: Math.max(...hist) } : null);
