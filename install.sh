#!/usr/bin/env bash
# Install herdr-mods on this machine: copy the mods into herdr-app, and (unless --mods-only) link the
# agent-session-label script and the hooks that make each coding agent (Claude Code, Codex, Pi, PiG,
# OpenCode, Hermes) report its session id.
# Re-running is safe: mods are updated in place, hooks are added once, and anything else in the way
# is moved to ~/.cache/herdr-mods/backup-<time>/, never deleted.
#
#   ./install.sh               mods + agent hooks
#   ./install.sh --mods-only   only the mods
#   ./install.sh --watch       mods only, then keep copying edits from this checkout (development)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${HERDR_APP_CONFIG:-$HOME/.config/herdr-app}"
BIN="${BIN_DIR:-$HOME/.local/bin}"
MODS_ONLY=0 WATCH=0
for a in "$@"; do
  case "$a" in
    --mods-only) MODS_ONLY=1 ;;
    --watch) MODS_ONLY=1 WATCH=1 ;;
    -h|--help) sed -n 2,9p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/.cache/herdr-mods/backup-$STAMP"

# aside <path>: move whatever is at path to the backup folder (outside the target folder, so a
# moved-aside mod or extension never gets loaded as a second copy).
# The backup keeps the full path, so two files with one name (Pi's and PiG's agent-session.ts) don't collide.
aside() {
  mkdir -p "$BACKUP$(dirname "$1")"
  mv "$1" "$BACKUP$1"
  echo "  moved existing $1 to $BACKUP/"
}

# link <source> <target>: symlink source to target.
link() {
  mkdir -p "$(dirname "$2")"
  if [ -L "$2" ]; then rm "$2"; elif [ -e "$2" ]; then aside "$2"; fi
  ln -s "$1" "$2"
  echo "  $2"
}

# Each mod lives in <name>/mods/<name>/ (herdr.dev's one-folder-per-mod shape). Mods are copied, not linked: herdr-app hot-reloads a mod only when a file in its own folder
# changes, and an edit behind a symlink never reaches that folder. A marker file tells our copies apart.
copy_mods() {
  local m dst
  for m in agents-ids spaces-plus sysstat sessions usage md-open; do
    dst="$APP/mods/$m"
    if [ -L "$dst" ]; then rm "$dst"; elif [ -e "$dst" ] && [ ! -e "$dst/.herdr-mods" ]; then aside "$dst"; fi
    mkdir -p "$dst"
    # rsync writes only changed files, so herdr-app reloads only what changed; it keeps the editor type files Herdr writes
    rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude .herdr-mods "$REPO/$m/mods/$m/" "$dst/"
    touch "$dst/.herdr-mods"
  done
}

# json_hook <file> <command>: add a SessionStart hook running <command>, once.
json_hook() {
  python3 - "$@" <<'PY'
import json, os, sys
path, cmd = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) and os.path.getsize(path) else {}
starts = data.setdefault("hooks", {}).setdefault("SessionStart", [])
if any(h.get("command") == cmd for e in starts for h in e.get("hooks", [])):
    sys.exit(0)
starts.append({"hooks": [{"type": "command", "command": cmd, "timeout": 5}]})
tmp = path + ".tmp"
# The rewrite keeps the file's mode: settings can hold secrets and be 0600.
mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o644
if os.path.exists(tmp):
    os.unlink(tmp)
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
os.fchmod(fd, mode)
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
print(f"  added SessionStart hook to {path}")
PY
}

# WSL with a Windows herdr-app: the mods must go to the Windows app's folder, which only the person knows.
if [ -z "${HERDR_APP_CONFIG:-}" ] && grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  echo "WSL: mods go to $APP. For a Windows herdr-app, set HERDR_APP_CONFIG=/mnt/c/Users/<you>/.config/herdr-app (see README)." >&2
fi
[ -d "$APP" ] || { echo "No herdr-app config at $APP (start herdr-app once, or set HERDR_APP_CONFIG)" >&2; exit 1; }

echo "Mods -> $APP/mods"
copy_mods
command -v herdr-app >/dev/null && for m in agents-ids spaces-plus sysstat sessions usage md-open; do herdr-app check "$APP/mods/$m" | tail -1; done
if [ ! -e "$APP/layouts/main-plus.json" ]; then
  mkdir -p "$APP/layouts" && cp "$REPO/layout/main-plus.json" "$APP/layouts/"
  echo "  layout main-plus added: herdr-app do layout.switch '{\"name\":\"main-plus\"}'"
elif ! cmp -s "$REPO/layout/main-plus.json" "$APP/layouts/main-plus.json"; then
  echo "  kept your edited layouts/main-plus.json (the repo's copy is $REPO/layout/main-plus.json)"
fi

if [ "$WATCH" = 1 ]; then
  echo "Watching $REPO/*/mods (Ctrl+C to stop)"
  while sleep 1; do copy_mods; done
fi

if [ "$MODS_ONLY" = 1 ]; then
  echo "Done. To use the mods, switch to main-plus or put them in your own layout (README.md, Install)."
  exit 0
fi

echo "Session-id script -> $BIN"
link "$REPO/integrations/bin/agent-session-label" "$BIN/agent-session-label"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  note: $BIN is not on your PATH; Pi and OpenCode find the script through PATH" ;; esac
LABEL="$BIN/agent-session-label"

if [ -d "$HOME/.claude" ]; then
  echo "Claude Code"
  json_hook "$HOME/.claude/settings.json" "$LABEL"
fi
if [ -d "$HOME/.codex" ]; then
  echo "Codex"
  json_hook "$HOME/.codex/hooks.json" "$LABEL"
  grep -qE '^\s*hooks\s*=\s*true' "$HOME/.codex/config.toml" 2>/dev/null ||
    echo "  note: Codex runs hooks only with 'hooks = true' under [features] in ~/.codex/config.toml"
fi
for home in "$HOME/.pi" "$HOME/.pig"; do
  if [ -d "$home/agent" ]; then
    echo "$(basename "$home" | tr -d .) extension"
    link "$REPO/integrations/pi/agent-session.ts" "$home/agent/extensions/agent-session.ts"
  fi
done
if [ -d "$HOME/.config/opencode" ]; then
  echo "OpenCode plugin"
  link "$REPO/integrations/opencode/agent-session-label" "$HOME/.config/opencode/agent-session-label"
  python3 - "$HOME/.config/opencode/cli.json" <<'PY'
import json, os, sys
path = sys.argv[1]
data = json.load(open(path)) if os.path.exists(path) and os.path.getsize(path) else {"$schema": "https://opencode.ai/v2/cli.json"}
plugins = data.setdefault("plugins", [])
if "./agent-session-label" not in plugins:
    plugins.append("./agent-session-label")
    tmp = path + ".tmp"
    # The rewrite keeps the file's mode (see json_hook).
    mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o644
    if os.path.exists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    os.fchmod(fd, mode)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    print(f"  added ./agent-session-label to {path}")
PY
fi
HERMES="${HERMES_HOME:-$HOME/.hermes}"
if [ -d "$HERMES/plugins" ]; then
  echo "Hermes plugin"
  # Skip when another plugin already writes the label (two writers would race on resumed sessions).
  other="$(grep -lsF 'agent.session=' "$HERMES"/plugins/*/__init__.py | grep -v '/agent-session-label/' || true)"
  if [ -n "$other" ]; then
    echo "  skipped: $other already sets agent.session"
  else
    link "$REPO/integrations/hermes/agent-session-label" "$HERMES/plugins/agent-session-label"
    echo "  enable it once: hermes plugins enable agent-session-label"
  fi
fi
echo "Done. Restart running agents so they pick up the hooks."
