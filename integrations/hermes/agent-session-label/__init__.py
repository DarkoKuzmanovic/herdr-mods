"""Report a Hermes session to the herdr-app terminal it runs in, for the herdr-mods agents-ids mod
(github.com/DarkoKuzmanovic/herdr-mods; the labels are listed in docs/labels.md there).

- Turn state by OSC 7501 (``working`` / ``done`` / ``blocked`` while an approval, clarify question
  or sudo prompt waits on the human), so Herdr's own status follows the session.
- Labels: ``agent.session`` + ``agent.app=hermes`` (resume), ``agent.doing`` + ``agent.doing.since``
  (now doing), and at each turn's end ``agent.next`` + ``agent.needs`` (the reply's ``Next:`` line,
  and whether it asks for the human) and ``agent.waiting`` (background jobs that will wake the
  session when they finish).

Hermes can run TUI sessions inside a shared gateway whose own environment has no terminal; the
terminal then comes from the session's client environment (pass HC_TERMINAL_ID and
HC_TERMINAL_SOCKET through with terminal.client_env_passthrough). Interactive platforms only;
subagents (platform ``subagent``) are not shown. Does nothing outside herdr-app and never fails a hook.
"""

from __future__ import annotations

import base64
import json
import os
import queue
import re
import subprocess
import threading
import time

_INTERACTIVE = {"cli", "tui", "desktop", "acp", "local"}  # "local": a TUI turn in a shared gateway
_lock = threading.Lock()
_labelled: dict[str, str] = {}  # terminal -> session id last written
_sessions: dict = {}  # session id -> (terminal, client environment)
_doing_last: dict[str, str] = {}
_doing_at: dict[str, float] = {}
_ends: dict[str, tuple] = {}  # terminal -> (next, needs, waiting) last written
_turns: dict[str, set] = {}  # terminal -> session ids with a turn running
_keys: dict[str, str] = {}  # session key -> session id, for agent_loop_stopped (it passes only the key)
_asks: dict[str, dict] = {}  # terminal -> pending human-input request id -> message
_state: dict[str, tuple] = {}  # terminal -> (state, message) last reported
_ttys: dict[str, str] = {}  # terminal -> its pty
_queue: queue.Queue = queue.Queue()
_worker_started = False


def _send(cmd, env):
    global _worker_started
    _queue.put((cmd, env))
    if not _worker_started:
        def work():
            while True:
                command, environment = _queue.get()
                try:
                    if command[0] == "osc":
                        _osc(*command[1:], env=environment)
                    else:
                        subprocess.run(command, env=environment, timeout=2, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, check=False)
                except Exception:
                    pass
        try:
            threading.Thread(target=work, daemon=True).start()
            _worker_started = True  # only once it runs, so a failed start retries on the next send
        except Exception:
            pass


def _env() -> dict:
    try:
        from agent.session_client_env import bound_client_env

        bound = bound_client_env()
    except Exception:
        bound = None
    env = dict(os.environ)
    if bound:
        if bound.get("PATH"):
            env["PATH"] = bound["PATH"]
        # The shared gateway may have been started in a Herdr terminal; a client's own terminal (or
        # none, outside Herdr) is the only one its session may label.
        for k in ("HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"):
            env.pop(k, None)
            if bound.get(k):
                env[k] = bound[k]
    return env


def _scan(env) -> dict:
    """`--resume`/`-r` argument -> terminal, for each local Hermes terminal."""
    found = {}
    def hc(*args):
        return json.loads(subprocess.run(["hc", *args, "--json"], env=env, capture_output=True, timeout=2).stdout)
    try:
        for t in hc("ls").get("terminals", []):
            if t.get("agent") != "hermes" or "/" in t.get("address", ""):  # "/": another machine's terminal
                continue
            argv = (hc("get", t["address"]).get("foreground") or {}).get("argv") or []
            found.update({val: t["address"] for flag, val in zip(argv, argv[1:]) if flag in ("--resume", "-r")})
    except Exception:
        pass  # no herdr-app here, or it didn't answer: keep the client's own terminal
    return found


def _resumed_in(sid, env):
    """The terminal running `hermes --resume <sid or its prefix>`. A shared gateway keeps a session's client
    env from when it was created, so a session resumed in another terminal still names the old one.
    shortcut: `/resume` inside an open TUI and `--resume latest|<title>` leave no id to match; those keep the old terminal."""
    hits = [term for arg, term in _scan(env).items() if len(arg) >= 8 and sid.startswith(arg)]
    return hits[0] if hits else None


def _label(opened=False, **kwargs) -> None:
    if kwargs.get("platform") not in _INTERACTIVE or kwargs.get("parent_session_id"):
        return
    sid = str(kwargs.get("session_id") or "")
    env = _env()
    term = sid and _resumed_in(sid, env)
    if not term and not opened:  # an open has no client env bound: HC_TERMINAL_ID would be the gateway's own
        term = (env.get("HC_TERMINAL_ID") or "").strip()
    if not sid or not term:
        return
    with _lock:
        _sessions[sid] = (term, env)
        if _labelled.get(term) == sid:
            return
        _labelled[term] = sid
        _doing_last.pop(term, None)
        _doing_at.pop(term, None)
        _send(["hc", "label", term, f"agent.session={sid}", "agent.app=hermes"], env)


def _sid(kwargs) -> str:
    """The session a hook belongs to. agent_loop_stopped runs off-turn with only a session key."""
    return str(kwargs.get("session_id") or _keys.get(str(kwargs.get("session_key") or ""), ""))


def _where(kwargs):
    """(terminal, env) of the labelled session this hook belongs to, or None."""
    with _lock:
        session = _sessions.get(_sid(kwargs))
        return session if session and _labelled.get(session[0]) == _sid(kwargs) else None


# --- turn state (OSC 7501) -------------------------------------------------------------------

_KINDS = {"approval": "permission", "clarify": "question", "sudo": "auth"}


def _osc(term: str, state: str, message: str, env=None) -> None:
    """Report to herdr-core by OSC 7501. A shared gateway has no tty of its own, so the sequence goes
    to the terminal's pty, found through `hc get` (Linux /proc; elsewhere the label still works)."""
    try:
        tty = _ttys.get(term)
        if tty is None:
            out = subprocess.run(["hc", "get", term, "--json"], capture_output=True, timeout=2, env=env).stdout
            tty = _ttys[term] = os.readlink(f"/proc/{json.loads(out)['pid']}/fd/0")
        fields = [f"state={state}", "app=hermes"]
        if state == "blocked":
            kind, _, text = message.partition(": ")
            fields += [f"kind={_KINDS.get(kind, 'question')}", "msg=" + base64.b64encode(text.encode()).decode()]
        with open(tty, "w") as f:  # one small write, so it never lands inside the TUI's own output
            f.write("\033]7501;" + ":".join(fields) + "\033\\")
    except Exception:
        _ttys.pop(term, None)  # the shell may be gone; look the pty up again next time


def _report(term, env) -> None:
    with _lock:
        asks = _asks.get(term)
        if asks:
            state = ("blocked", next(reversed(asks.values())))
        else:
            state = ("working" if _turns.get(term) else "done", "")
        if _state.get(term) == state:
            return
        _state[term] = state
    _send(["osc", term, *state], env)


# --- labels -----------------------------------------------------------------------------------

def _doing(text, kwargs) -> None:
    where = _where(kwargs)
    if not where:
        return
    term, env = where
    with _lock:
        if _doing_last.get(term) == text:
            return
        previous = _doing_last.get(term, "")
        now = time.monotonic()
        # shortcut: a rapid second tool may be hidden until the next state, add trailing updates if needed.
        if text.startswith("running:") and previous.startswith("running:") and now - _doing_at.get(term, 0) < 2:
            return
        _doing_last[term] = text
        _doing_at[term] = now
    _send(["hc", "label", term, f"agent.doing={text}", f"agent.doing.since={int(time.time())}"], env)


def _ends_labels(term, env, values) -> None:
    """agent.next / agent.needs / agent.waiting, written only when they change; empty removes."""
    with _lock:
        if _ends.get(term, ("", "", "")) == values:
            return
        _ends[term] = values
    nxt, needs, waiting = values
    _send(["hc", "label", term, f"agent.next={nxt}", f"agent.needs={needs}", f"agent.waiting={waiting}"], env)


_NEXT = re.compile(r"^[ \t>*_-]*(?:\*\*|__)?Next:(?:\*\*|__)?[ \t]*(.+)$", re.M | re.I)
_NOT_YOU = re.compile(r"\b(?:nothing|no one|nobody|no action|no input|no decision)\b[^.;]*\b(?:needs?|for|from) you\b"
                      r"|\b(?:doesn'?t|does not|don'?t) need you\b|\bwithout you\b", re.I)
_YOU = re.compile(r"\b(?:you|your|yours|me)\b", re.I)  # "me": the agent asking ("tell me which")


def next_line(reply) -> tuple:
    """(next, needs) from a reply's last `Next:` line: needs is "you" when it asks for the human."""
    found = _NEXT.findall(str(reply or ""))
    if not found:
        return "", ""
    text = " ".join(re.sub(r"\*\*|__|`", "", found[-1]).split())[:200]
    return text, ("you" if _YOU.search(text) and not _NOT_YOU.search(text) else "no")


_CMDS = {"git", "npm", "node", "python", "python3", "pytest", "cargo", "go", "make", "gh", "docker",
         "ssh", "curl", "herd", "hc", "uv", "npx", "sleep"}


def _waiting(sid) -> str:
    """Background jobs of this session that will wake it: `gh`, `make`, or `2 jobs`. Never arguments."""
    try:
        from tools.process_registry import process_registry as reg

        with reg._lock:
            procs = list(reg._running.values())
    except Exception:
        return ""
    mine = [p for p in procs if getattr(p, "parent_session_id", "") == sid and not getattr(p, "exited", False)
            and (getattr(p, "notify_on_complete", False) or getattr(p, "watch_patterns", None))]
    if len(mine) != 1:
        return f"{len(mine)} jobs" if mine else ""
    words = [os.path.basename(w) for w in str(getattr(mine[0], "command", "")).split()]
    return next((w for w in words if w in _CMDS), "a job")


# --- hooks ------------------------------------------------------------------------------------

def _interactive(kwargs) -> bool:
    return kwargs.get("platform") in _INTERACTIVE


def _pre(**kwargs):
    if not _interactive(kwargs):
        return
    _label(**kwargs)
    try:
        from gateway.session_context import get_session_env
        key = get_session_env("HERMES_SESSION_KEY")
    except Exception:
        key = ""
    if key and kwargs.get("session_id"):
        _keys[key] = str(kwargs["session_id"])
    where = _where(kwargs)
    if not where:
        return
    with _lock:
        _turns.setdefault(where[0], set()).add(str(kwargs.get("session_id") or ""))
    _report(*where)
    _ends_labels(*where, ("", "", ""))  # a new turn makes the last Next line stale
    _doing("thinking", kwargs)


def _post(**kwargs):
    if not _interactive(kwargs):
        return
    where = _where(kwargs)
    if not where:
        return
    term, env = where
    with _lock:
        _turns.get(term, set()).discard(str(kwargs.get("session_id") or ""))
        busy = bool(_turns.get(term))
    _report(term, env)
    if busy:
        return
    _doing("done", kwargs)
    _ends_labels(term, env, (*next_line(kwargs.get("assistant_response")), _waiting(_sid(kwargs))))


def _tool(**kwargs):
    name = kwargs.get("tool_name")
    if name not in {"terminal", "read_file", "write_file", "patch", "search_files", "web_search", "web_extract", "delegate_task"}:
        name = "tool"
    args = kwargs.get("args") or {}
    command = args.get("command", "") if isinstance(args, dict) else ""
    first = command.split()[0] if isinstance(command, str) and command.split() else ""
    target = f" {first}" if first in _CMDS - {"sleep", "hc", "herd"} else ""  # never arguments: they can hold secrets
    _doing(f"running: {name}{target}", kwargs)


def _ask(**kwargs):
    where = _where(kwargs)
    if not where:
        return
    kind = str(kwargs.get("kind") or "input")
    prompt = " ".join(str(kwargs.get("prompt") or "").split())[:160]
    with _lock:
        _asks.setdefault(where[0], {})[str(kwargs.get("request_id"))] = f"{kind}: {prompt}" if prompt else kind
    _report(*where)
    _doing("waiting for you", kwargs)


def _answered(**kwargs):
    where = _where(kwargs)
    if not where:
        return
    with _lock:
        _asks.get(where[0], {}).pop(str(kwargs.get("request_id")), None)
    _report(*where)
    _doing("thinking", kwargs)


def _stopped(**kwargs):
    # an interrupted turn: nothing runs and nothing waits any more in this terminal
    where = _where(kwargs)
    if not where:
        return
    with _lock:
        _turns.pop(where[0], None)
        _asks.pop(where[0], None)
    _report(*where)
    _doing("stopped", kwargs)


def register(ctx):
    ctx.register_hook("pre_llm_call", _pre)
    try:  # Hermes 0.23.1+: label a resumed tab when it opens, not at its first message
        from hermes_cli.plugins import VALID_HOOKS
    except Exception:
        VALID_HOOKS = ()
    if "on_session_open" in VALID_HOOKS:
        ctx.register_hook("on_session_open", lambda **kw: _label(opened=True, **kw))
    ctx.register_hook("pre_tool_call", _tool)
    ctx.register_hook("post_llm_call", _post)
    ctx.register_hook("on_human_input_request", _ask)
    ctx.register_hook("on_human_input_resolved", _answered)
    ctx.register_hook("agent_loop_stopped", _stopped)
