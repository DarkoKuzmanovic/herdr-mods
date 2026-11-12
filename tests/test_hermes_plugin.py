"""Self-check for integrations/hermes/agent-session-label: python3 -I tests/test_hermes_plugin.py"""
import importlib.util, os, sys

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "integrations", "hermes", "agent-session-label", "__init__.py")
spec = importlib.util.spec_from_file_location("hermes_asl", path)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
os.environ.pop("HC_TERMINAL_SOCKET", None)

calls, oscs = [], []
m._send = lambda cmd, env: (oscs if cmd[0] == "osc" else calls).append((cmd, env.get("HC_TERMINAL_SOCKET")))
m.time.time = lambda: 1234
m._scan = lambda env: {}  # no terminal runs `hermes --resume`
hooks = {}
m.register(type("Ctx", (), {"register_hook": lambda self, name, fn: hooks.setdefault(name, fn)})())
label = hooks["pre_llm_call"]

os.environ.pop("HC_TERMINAL_ID", None)
label(platform="tui", session_id="s1")
assert calls == []  # outside herdr-app

os.environ["HC_TERMINAL_ID"] = "t9"
label(platform="tui", session_id="s1")
label(platform="tui", session_id="s1")            # once per session
label(platform="subagent", session_id="sub", parent_session_id="s1")  # subagent: no
label(platform="telegram", session_id="s2")      # not interactive: no
assert calls == [(["hc", "label", "t9", "agent.session=s1", "agent.app=hermes"], None),
                 (["hc", "label", "t9", "agent.doing=thinking", "agent.doing.since=1234"], None)], calls
calls.clear()
hooks["pre_tool_call"](session_id="s1", tool_name="terminal", args={"command": "git status secret-token"})
hooks["pre_tool_call"](session_id="s1", tool_name="terminal", args={"command": "git status another-secret"})
hooks["pre_tool_call"](session_id="s1", tool_name="read_file", args={"path": "/secret"})  # throttled
assert calls == [(["hc", "label", "t9", "agent.doing=running: terminal git", "agent.doing.since=1234"], None)]
hooks["on_human_input_request"](session_id="s1", kind="clarify", prompt="Which one?", request_id="r1")
assert oscs[-1][0] == ["osc", "t9", "blocked", "clarify: Which one?"], oscs
hooks["on_human_input_resolved"](session_id="s1", request_id="r1")
assert oscs[-1][0] == ["osc", "t9", "working", ""], oscs
# A real subagent (platform "subagent") changes nothing in the parent's terminal.
n = len(oscs)
hooks["pre_llm_call"](platform="subagent", session_id="sub", parent_session_id="s1")
hooks["post_llm_call"](platform="subagent", session_id="sub")
assert len(oscs) == n, oscs
# /stop in the TUI: agent_loop_stopped carries only the session key the turn recorded.
m._keys["k1"] = "s1"
calls.clear()
hooks["agent_loop_stopped"](session_key="k1", platform="tui", reason="user_stop")
assert calls[-1][0][3] == "agent.doing=stopped", calls
m._waiting = lambda sid: "gh" if sid == "s1" else ""
hooks["pre_llm_call"](platform="tui", session_id="s1")
hooks["post_llm_call"](platform="tui", session_id="s1", assistant_response="Done.\n\n**Next:** your go for the `test` run.")
assert calls[-2][0][-2] == "agent.doing=done", calls
assert calls[-1][0] == ["hc", "label", "t9", "agent.next=your go for the test run.", "agent.needs=you", "agent.waiting=gh"], calls
calls.clear()
hooks["pre_llm_call"](platform="tui", session_id="s1")  # a new turn clears them
assert calls[0][0] == ["hc", "label", "t9", "agent.next=", "agent.needs=", "agent.waiting="], calls
m._waiting = lambda sid: ""

# The Next line and whether it needs the human.
nl = m.next_line
assert nl("no next line here") == ("", "")
assert nl("**Next:** I'll merge once CI is green; nothing needs you.") == ("I'll merge once CI is green; nothing needs you.", "no")
assert nl("Next: tell me which ideas go in.") == ("tell me which ideas go in.", "you")
assert nl("**Next:** a first one\n\nlater\n**Next:** reviewer runs, doesn't need you") == ("reviewer runs, doesn't need you", "no")
assert nl("- __Next:__ `make check` then release") == ("make check then release", "no")

# A shared gateway: the session's client env names the terminal.
calls.clear()
del os.environ["HC_TERMINAL_ID"]
sys.modules["agent"] = type(sys)("agent")
sys.modules["agent.session_client_env"] = mod = type(sys)("agent.session_client_env")
mod.bound_client_env = lambda: {"HC_TERMINAL_ID": "t4", "HC_TERMINAL_SOCKET": "/run/x.sock"}
label(platform="local", session_id="s3")
assert calls == [(["hc", "label", "t4", "agent.session=s3", "agent.app=hermes"], "/run/x.sock"),
                 (["hc", "label", "t4", "agent.doing=thinking", "agent.doing.since=1234"], "/run/x.sock")], calls

# A gateway started in a Herdr terminal must not label it for a client outside Herdr.
calls.clear()
os.environ["HC_TERMINAL_ID"] = "t1"
mod.bound_client_env = lambda: {"PATH": "/usr/bin"}
label(platform="local", session_id="s4")
assert calls == [], calls
# A session resumed in another terminal labels that one, not the terminal its client env names.
calls.clear()
mod.bound_client_env = lambda: {"HC_TERMINAL_ID": "t4"}
m._scan = lambda env: {"local-abcd1234": "t7", "local-ffff0000": "t8"}
label(platform="local", session_id="local-abcd1234ef")
assert calls[0][0] == ["hc", "label", "t7", "agent.session=local-abcd1234ef", "agent.app=hermes"], calls

# Hermes with on_session_open: a resumed tab is labelled when it opens, before any message.
sys.modules["hermes_cli"] = type(sys)("hermes_cli")
sys.modules["hermes_cli.plugins"] = plugins = type(sys)("hermes_cli.plugins")
plugins.VALID_HOOKS = {"pre_llm_call", "on_session_open"}
hooks.clear()
m.register(type("Ctx", (), {"register_hook": lambda self, name, fn: hooks.setdefault(name, fn)})())
calls.clear()
mod.bound_client_env = lambda: None  # an open carries no client env: only the resumed terminal counts
m._scan = lambda env: {"local-9999aaaa": "t5"}
hooks["on_session_open"](session_id="local-9999aaaabb", platform="tui", reason="resume")
assert calls == [(["hc", "label", "t5", "agent.session=local-9999aaaabb", "agent.app=hermes"], None)], calls
calls.clear()
m._scan = lambda env: {}  # a new session: the gateway's own HC_TERMINAL_ID (t1 here) is never labelled
hooks["on_session_open"](session_id="local-new00000", platform="tui", reason="create")
assert calls == [], calls
print("ok")
