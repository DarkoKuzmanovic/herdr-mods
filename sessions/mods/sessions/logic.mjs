export function resumeArgv(app, id) {
  if (!/^(?!-)[\w.-]{4,128}$/.test(id ?? '')) return null;
  if (app === 'hermes' || app === 'claude') return [app, '--resume', id];
  if (app === 'codex') return [app, 'resume', id];
  if (app === 'pi' || app === 'pig' || app === 'opencode') return [app, '--session', id];
  return null;
}

export function parseRows(json) {
  try {
    const rows = JSON.parse(json);
    return Array.isArray(rows) ? rows.filter(r => r && resumeArgv(r.app, r.id) && Number.isFinite(r.timestamp)).sort((a, b) => b.timestamp - a.timestamp).slice(0, 50) : [];
  } catch { return []; }
}

export function age(timestamp, now = Date.now() / 1000) {
  const seconds = Math.max(0, now - timestamp);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
