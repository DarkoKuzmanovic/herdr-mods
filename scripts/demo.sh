#!/usr/bin/env bash
# Screenshots for README.md and the mods' preview.png, from a second herdr-app with its own
# herdr-core: demo repos and agents only, none of your own spaces or terminals (which a demo window
# on the shared core would show, and could close).
#
#   scripts/demo.sh start   make the demo repos, start the demo window, open spaces and agents
#   scripts/demo.sh shot    save the window to $DEMO/shot.png and crop the previews into the repo
#   scripts/demo.sh stop    close the demo window, stop its herdr-core and forget its spaces
#
# DEMO (default ~/.cache/herdr-mods-demo) holds everything. The PR badge comes from a stub `gh`
# in $DEMO/bin (the demo repos have no GitHub remote); ports, git and session ids are real.
# Fake agents report working without loading a person's agent configuration or contacting a model.
# Needs herdr-app, hc, git, python3; Pillow for the crops.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="${DEMO:-$HOME/.cache/herdr-mods-demo}"
REAL_RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
# The demo moves XDG_RUNTIME_DIR, so the display sockets are named by full path. Without
# WAYLAND_DISPLAY (a shell outside the desktop session), the first compositor socket there.
WAYLAND="${WAYLAND_DISPLAY:-$(find "$REAL_RUNTIME" -maxdepth 1 -type s -name 'wayland-*' -printf '%f\n' 2>/dev/null | sort | head -1)}"
case "$WAYLAND" in /*) ;; *) WAYLAND="$REAL_RUNTIME/${WAYLAND:-wayland-0}" ;; esac

# Crops of the maximized window's shot, as x0 y0 x1 y1 (pixels). Measured on a 3440x1440 screen
# (a 3440x1406 shot) at one zoom step; `shot` prints the shot's size, so adjust these when yours differs.
# The mouse pointer counts: resting on the window, it hovers a row or opens a tooltip in the shot.
CROP_SPACES="${CROP_SPACES:-0 56 296 290}"
CROP_AGENTS="${CROP_AGENTS:-0 690 296 950}"
CROP_SYSSTAT="${CROP_SYSSTAT:-2960 1370 3410 1406}"
CROP_USAGE="${CROP_USAGE:-2850 1370 2960 1406}"

demo_env() {
  export HERDR_APP_HOME="$DEMO/home" XDG_RUNTIME_DIR="$DEMO/run" XDG_STATE_HOME="$DEMO/state" XDG_DATA_HOME="$DEMO/share"
  export WAYLAND_DISPLAY="$WAYLAND" DISPLAY="${DISPLAY:-:0}" PATH="$DEMO/bin:$PATH"
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$REAL_RUNTIME/bus}"
  if [ "${DEMO_SESSIONS:-0}" = 1 ]; then
    export HERDR_SESSIONS_ROOT="$DEMO/fake-home"
  fi
  unset HC_TERMINAL_ID HC_TERMINAL_SOCKET
}

do_() { herdr-app "do" "$@" >/dev/null; }

# repo <dir> <commit message>...: a git repo with one commit per message, made once.
repo() {
  local dir="$1"; shift
  [ -d "$dir/.git" ] && return
  mkdir -p "$dir/src"
  git -C "$dir" init -q -b main
  local n=0 msg
  for msg in "$@"; do
    n=$((n + 1))
    echo "// $msg" >"$dir/src/part$n.js"
    git -C "$dir" add -A
    git -C "$dir" -c user.name=demo -c user.email=demo@example.com commit -qm "$msg"
  done
}

make_repos() {
  local w="$DEMO/work"
  repo "$w/acme-api" "init" "routes" "auth"
  if [ ! -d "$w/acme-api/.worktrees/search" ]; then
    git -C "$w/acme-api" worktree add -q -b feature/search "$w/acme-api/.worktrees/search"
    echo "// search" >"$w/acme-api/.worktrees/search/src/search.js"
  fi
  repo "$w/web-dashboard" "init" "charts"
  echo "// wip" >>"$w/web-dashboard/src/part1.js"; touch "$w/web-dashboard/src/new.js" "$w/web-dashboard/TODO.md"
  if [ ! -d "$DEMO/remote/docs-site.git" ]; then
    repo "$w/docs-site" "init"
    git init -q --bare "$DEMO/remote/docs-site.git"
    git -C "$w/docs-site" remote add origin "$DEMO/remote/docs-site.git"
    git -C "$w/docs-site" push -q -u origin main
    for m in "guide" "faq"; do echo "$m" >"$w/docs-site/$m.md"; git -C "$w/docs-site" add -A; git -C "$w/docs-site" -c user.name=demo -c user.email=demo@example.com commit -qm "$m"; done
  fi
  mkdir -p "$DEMO/bin"
  cat >"$DEMO/bin/gh" <<'GH'
#!/bin/sh
# Demo stub (scripts/demo.sh): one open pull request from feature/search.
[ "$1 $2" = "pr list" ] || exit 1
echo '[{"number":42,"headRefName":"feature/search","state":"OPEN","isDraft":false,"url":"https://github.com/acme/acme-api/pull/42"}]'
GH
  chmod +x "$DEMO/bin/gh"
  # Fake agents never read the person's agent configuration or contact a model.
  cat >"$DEMO/bin/pi" <<'AGENT'
#!/bin/sh
printf '\033]7501;state=working:app=pi\033\\'
while :; do sleep 60; done
AGENT
  chmod +x "$DEMO/bin/pi"
  cp "$DEMO/bin/pi" "$DEMO/bin/claude"
}

# space <name> <folder> [argv json]: a space whose first terminal runs argv (a shell by default).
space() {
  do_ space.new "{\"name\":\"$1\",\"folder\":\"$2\"${3:+,\"argv\":$3}}"
}

start() {
  mkdir -p "$DEMO"/{home,state,share,remote,run} && chmod 700 "$DEMO/run"
  make_repos
  local real_app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
  demo_env
  # The shots wear your own look (theme and fonts only), not Herdr's defaults.
  mkdir -p "$HERDR_APP_HOME/themes"
  python3 - "$real_app" "$HERDR_APP_HOME" <<'PY'
import json, os, shutil, sys
real, demo = sys.argv[1:]
try:
    mine = json.load(open(f"{real}/settings.json"))
except (OSError, ValueError):
    sys.exit(0)
path = f"{demo}/settings.json"
ours = json.load(open(path)) if os.path.exists(path) else {}
ours.update({k: v for k, v in mine.items() if k == "theme" or k.startswith(("font", "ui_font"))})
json.dump(ours, open(path, "w"), indent=2)
theme = f"{real}/themes/{mine.get('theme')}.json"
if os.path.exists(theme):
    shutil.copy(theme, f"{demo}/themes/")
PY
  if ! herdr-app status >/dev/null 2>&1; then
    setsid herdr-app >"$DEMO/app.log" 2>&1 </dev/null &
    for _ in $(seq 40); do herdr-app status >/dev/null 2>&1 && break; sleep 0.5; done
    herdr-app status >/dev/null 2>&1 || { echo "The demo window didn't start; see $DEMO/app.log" >&2; exit 1; }
  fi
  # Demo stays isolated: copy this checkout directly, never run the installer.
  mkdir -p "$HERDR_APP_HOME/mods" "$HERDR_APP_HOME/layouts"
  local m
  for m in agents-ids spaces-plus sysstat sessions usage md-open copy-on-select; do
    mkdir -p "$HERDR_APP_HOME/mods/$m"
    rsync -a --delete "$REPO/$m/mods/$m/" "$HERDR_APP_HOME/mods/$m/"
  done
  python3 - "$REPO/layout/main-plus.json" "$HERDR_APP_HOME/layouts/main-plus.json" "$REPO/scripts/demo-usage.json" <<'PY'
import json, sys
layout = json.load(open(sys.argv[1]))
status = layout['children'][1]['children'][-1]
next(b for b in status['children'] if b['id'] == 'usage')['content']['props'] = {'command': ['cat', sys.argv[3]]}
with open(sys.argv[2], 'w') as f:
    json.dump(layout, f, indent=2)
PY
  do_ layout.switch '{"name":"main-plus"}'
  do_ window.maximize
  do_ app.zoom_reset
  do_ app.zoom_in
  local w="$DEMO/work"
  if [ "${DEMO_SESSIONS:-0}" = 1 ]; then
    python3 - "$HERDR_SESSIONS_ROOT" <<'PY'
import json, sys, time
from pathlib import Path
root = Path(sys.argv[1]) / '.pi/agent/sessions/acme'
root.mkdir(parents=True, exist_ok=True)
for name, title in [('demo-1234', 'Build search for the project'), ('demo-5678', 'Review the authentication flow')]:
    (root / f'2025-01-01_{name}.jsonl').write_text('\n'.join(json.dumps(x) for x in [
        {'type': 'session', 'id': name, 'cwd': '/home/alex/acme', 'timestamp': '2025-01-01T12:00:00Z'},
        {'type': 'message', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': title}]}}]))
PY
    space acme "$w/acme-api" '["/bin/sh"]'
    do_ mod.open '{"name":"sessions"}'
    echo "Demo sessions window up."
    return
  fi
  if herdr-app ls | grep -q '"acme-api"'; then
    echo "Demo spaces already open."
  else
    space acme-api "$w/acme-api" "[\"$DEMO/bin/pi\"]"
    space search "$w/acme-api/.worktrees/search" "[\"$DEMO/bin/claude\"]"
    space web-dashboard "$w/web-dashboard" '["python3","-m","http.server","5173","--bind","127.0.0.1"]'
    space docs-site "$w/docs-site" "[\"$DEMO/bin/pi\"]"
  fi
  # A stale working example exercises the activity line without a real agent.
  local agent
  agent="$(hc ls --json | python3 -c 'import json,sys; print(next((t["address"] for t in json.load(sys.stdin)["terminals"] if t.get("cwd") == sys.argv[1]), ""))' "$w/acme-api")"
  if [ -n "$agent" ]; then
    hc label "$agent" agent.session=demo-session agent.app=pi 'agent.doing=running: npm test' "agent.doing.since=$(($(date +%s) - 2400))" >/dev/null
  fi
  # Show web-dashboard: its terminal is the demo server, nothing from your own agent setup.
  do_ space.select '{"index":3}'
  echo "Demo window up; fake agents are working. Wait ~10 s for ports and the PR badge, then: scripts/demo.sh shot"
}

shot() {
  demo_env
  herdr-app shot "$DEMO/shot.png" >/dev/null
  if [ "${DEMO_SESSIONS:-0}" = 1 ]; then
    python3 - "$DEMO/shot.png" "$REPO/sessions/preview.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1])
w, h = im.size
im.crop((max(0, w // 2 - 480), max(0, h // 2 - 420), min(w, w // 2 + 480), min(h, h // 2 + 420))).save(sys.argv[2])
print(f'shot {w}x{h}: {sys.argv[1]}')
PY
    return
  fi
  # window.maximize toggles, so start's may have restored a window saved maximized: fix it here.
  set -- $CROP_SYSSTAT
  if [ "$(python3 -c 'import sys; from PIL import Image; print(Image.open(sys.argv[1]).size[0])' "$DEMO/shot.png")" -lt "$3" ]; then
    do_ window.maximize; sleep 1
    herdr-app shot "$DEMO/shot.png" >/dev/null
  fi
  python3 - "$DEMO/shot.png" "$REPO" "$CROP_SPACES" "$CROP_AGENTS" "$CROP_SYSSTAT" "$CROP_USAGE" <<'PY'
import sys
from PIL import Image
shot, repo, *crops = sys.argv[1:]
im = Image.open(shot)
print(f"shot {im.size[0]}x{im.size[1]}: {shot}")
im.save(f"{repo}/docs/window.png")
for mod, box in zip(["spaces-plus", "agents-ids", "sysstat", "usage"], crops):
    im.crop(tuple(int(v) for v in box.split())).save(f"{repo}/{mod}/preview.png")
    print(f"  {mod}/preview.png <- {box}")
PY
}

stop() {
  demo_env
  herdr-app "do" window.close >/dev/null 2>&1 || true
  hc server stop >/dev/null 2>&1 || true
  # Without its saved spaces the next start opens them fresh, with their agents and server running;
  # without the mods' data, Recent sessions starts empty instead of piling up old demo runs.
  rm -rf "$DEMO/state" "$DEMO/home/data"
  echo "Demo stopped (repos in $DEMO kept; delete it when done)."
}

case "${1:-}" in
  start) start ;;
  shot) shot ;;
  stop) stop ;;
  *) sed -n 2,13p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
